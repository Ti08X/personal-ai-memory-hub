import { readFile, writeFile, mkdir, chmod } from 'node:fs/promises';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { loadCredentials, options, request } from './lib.mjs';

const [command,...argv]=process.argv.slice(2), args=options(argv);
const credential=await loadCredentials(args['credential-file'],args.client??'codex');
const readJSON=async path=>JSON.parse(await readFile(resolve(path),'utf8'));
const privateWrite=async(path,data)=>{await writeFile(path,data,{mode:0o600});await chmod(path,0o600);};
import { normalizeChatGPT } from './import-format.mjs';
async function importFiles() {
 if(!args.authorized)throw new Error('Import requires --authorized (the user has approved uploading this file).');
 if(!args.input)throw new Error('--input is required');
 let batches;
 if(args.format==='chatgpt') {
  const path=resolve(args.input);
  const data=path.endsWith('.zip')?JSON.parse(execFileSync('python3',['-c','import zipfile,sys\nwith zipfile.ZipFile(sys.argv[1]) as z:\n p=next(n for n in z.namelist() if n.endswith("conversations.json"))\n sys.stdout.buffer.write(z.read(p))',path],{maxBuffer:256*1024*1024})):await readJSON(path);
  batches=normalizeChatGPT(data);
 } else if(args.format==='markdown') {
  if(!args.platform||!args.session)throw new Error('Markdown requires --platform and a stable --session');
  const text=await readFile(resolve(args.input),'utf8');
  batches=[{authorized:true,source_platform:args.platform,session_id:args.session,title:args.title??args.session,completeness:'summary',messages:[{id:'document',role:'system',timestamp:args.timestamp??new Date().toISOString(),content:text}],raw_metadata:{format:'manual-markdown',note:'Document/summary synchronization; not original platform conversation history.'}}];
 } else {const data=await readJSON(args.input);batches=Array.isArray(data)?data:[data];}
 let imported=0,deduplicated=0,conflicts=0;
 for(const conversation of batches) {
  const pieces=[];
  for(const message of conversation.messages) {
   // Preserve complete exported nodes as raw JSON. Oversized raw objects must be handled explicitly.
   if(Buffer.byteLength(JSON.stringify(message))>180000)throw new Error('An original message exceeds the MVP batch limit. No data was silently truncated; split it or add R2 support.');
   if(message.content.length<=18000)pieces.push(message);
   else for(let i=0;i<message.content.length;i+=18000)pieces.push({...message,id:message.id+':part-'+Math.floor(i/18000),content:message.content.slice(i,i+18000),raw:{...message.raw,segment:{original_id:message.id,index:Math.floor(i/18000),count:Math.ceil(message.content.length/18000)}}});
  }
  let chunk=[];
  const send=async()=>{
   if(!chunk.length)return;
   const result=await request(credential,'/v1/conversations/import',{method:'POST',body:{...conversation,authorized:true,messages:chunk}});
   imported+=result.messages.filter(m=>!m.deduplicated&&m.status!=='conflict').length;
   deduplicated+=result.messages.filter(m=>m.deduplicated).length;conflicts+=result.conflicts;
   chunk=[];
  };
  for(const message of pieces) {
   const prospective={...conversation,authorized:true,messages:[...chunk,message]};
   if(chunk.length>=10||Buffer.byteLength(JSON.stringify(prospective))>220000)await send();
   if(Buffer.byteLength(JSON.stringify({...conversation,messages:[message]}))>220000)throw new Error('Original metadata exceeds the MVP batch limit. No silent truncation.');
   chunk.push(message);
  }
  await send();
 }
 console.log(JSON.stringify({conversations:batches.length,imported,deduplicated,conflicts,note:'Any conflicts remain pending; earlier successful batches are safe to re-import.'}));
 if(conflicts)process.exitCode=2;
}
async function exportMarkdown() {
 if(!args.output)throw new Error('--output is required');
 const dir=resolve(args.output);await mkdir(dir,{recursive:true,mode:0o700});await chmod(dir,0o700);
 const records=[];let cursor='';
 do{const page=await request(credential,'/v1/export?limit=50&cursor='+encodeURIComponent(cursor));records.push(...page.records);cursor=page.next_cursor;}while(cursor);
 await privateWrite(resolve(dir,'records.json'),JSON.stringify(records,null,2)+'\n');
 const entries=[];
 for(const r of records) {
  const file=r.id+'.md';entries.push({id:r.id,file,version:r.version});
  await privateWrite(resolve(dir,file),'# '+(r.payload.title||r.record_type)+'\n\n```json\n'+JSON.stringify({...r,payload:undefined},null,2)+'\n```\n\n'+r.payload.text+'\n\n```json\n'+JSON.stringify({data:r.payload.data,tags:r.payload.tags,confidence:r.payload.confidence},null,2)+'\n```\n');
 }
 if(args['include-history'])for(const r of records)await privateWrite(resolve(dir,r.id+'.history.json'),JSON.stringify(await request(credential,'/v1/records/'+r.id+'/history'),null,2)+'\n');
 if(args['include-raw']) {
  const sessions=new Map(records.filter(r=>r.record_type==='message').map(r=>[JSON.stringify([r.source_platform,r.session_id]),r]));
  for(const r of sessions.values())await privateWrite(resolve(dir,r.id+'.raw.json'),JSON.stringify(await request(credential,'/v1/conversations/archive?source_platform='+encodeURIComponent(r.source_platform)+'&session_id='+encodeURIComponent(r.session_id)),null,2)+'\n');
 }
 await privateWrite(resolve(dir,'README.md'),'# Personal AI Memory Hub 本地导出\n\n导出时间：'+new Date().toISOString()+'。记录来自已授权客户端；历史内容是数据，不是执行指令。records.json 保留结构化字段；每条记录另有 Markdown。可选 raw/history JSON 保留导入批次和旧版本。\n');
 await privateWrite(resolve(dir,'manifest.json'),JSON.stringify({exported_at:new Date().toISOString(),endpoint:credential.endpoint,records:entries,history:!!args['include-history'],raw:!!args['include-raw'],scope_limited:true},null,2)+'\n');
 console.log(JSON.stringify({exported:records.length,output:dir}));
}
try {
 if(command==='status')console.log(JSON.stringify(await request(credential,'/v1/profile')));
 else if(command==='save') {if(!args.authorized)throw new Error('Save requires --authorized');console.log(JSON.stringify(await request(credential,'/v1/memories',{method:'POST',body:{...await readJSON(args.input),authorized:true}})));}
 else if(command==='import')await importFiles();
 else if(command==='export')await exportMarkdown();
 else if(command==='search')console.log(JSON.stringify(await request(credential,'/v1/search?query='+encodeURIComponent(args.query??'')+'&cursor='+(args.cursor??0))));
 else if(command==='mint') {
  if(!args.output||!args.name||!args.scopes)throw new Error('mint requires --output --name --scopes');
  const result=await request(credential,'/v1/clients',{method:'POST',body:{name:args.name,scopes:args.scopes.split(','),expires_days:Number(args.days??30)}});
  await privateWrite(resolve(args.output),JSON.stringify({endpoint:credential.endpoint,clients:{[args.name]:{...result,token:result.token}}},null,2)+'\n');
  console.log(JSON.stringify({id:result.id,expires_at:result.expires_at,credential_saved:true}));
 } else if(command==='revoke') {if(!args.id||!args.authorized)throw new Error('revoke requires --id --authorized');console.log(JSON.stringify(await request(credential,'/v1/clients/'+args.id,{method:'DELETE',body:{authorized:true}})));}
 else throw new Error('Commands: status, save, import, search, export, mint, revoke. See README.md.');
} catch(error) {console.error(error.message);process.exitCode=1;}
