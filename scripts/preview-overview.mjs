// Isolated, synthetic preview. No production database, credentials or vendor calls.
import {readFile,readdir} from 'node:fs/promises';
import {randomBytes,createHash,createHmac} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {build} from 'esbuild';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
const root=new URL('..',import.meta.url).pathname,port=Number(process.env.PREVIEW_PORT??8812),base='http://127.0.0.1:'+port;
const token='pmh_'+randomBytes(32).toString('hex');
const compiled=await build({stdin:{contents:`
 import worker from './src/index';
 import {createSessionFor} from './src/dashboard-auth';
 import {authorizeClient} from './src/core';
 export default {async fetch(request,env,ctx){
  const url=new URL(request.url);
  if(url.pathname==='/preview/start'){
   const row=await env.DB.prepare('SELECT c.* FROM clients c JOIN dashboard_auth a ON a.client_id=c.id AND a.owner_id=c.owner_id').first();
   if(!row)return new Response('Preview initializing',{status:503});
   const principal=await authorizeClient(env,row);
   const session=await createSessionFor(new Request(url.origin+'/preview/start',{headers:{origin:url.origin}}),env,principal);
   return new Response(null,{status:303,headers:{location:'/dashboard','set-cookie':session.cookie,'cache-control':'no-store'}});
  }
  const response=await worker.fetch(request,env,ctx);
  if(url.pathname==='/ui/api/dashboard'&&response.ok){const data=await response.json();return Response.json({...data,demo:true},{headers:response.headers});}
  return response;
 }};`,resolveDir:root,sourcefile:'isolated-preview.ts'},bundle:true,write:false,format:'esm',platform:'browser',target:'es2022'});
const mf=new Miniflare(convertV4MiniflareOptions({host:'127.0.0.1',port,modules:true,script:compiled.outputFiles[0].text,compatibilityDate:'2026-10-10',compatibilityFlags:['nodejs_compat'],d1Databases:['DB'],bindings:{ENCRYPTION_KEY:randomBytes(32).toString('base64'),PREVIEW_TOKEN:token,RAG_ENABLED:'false',SUMMARY_API_KEY:'synthetic-preview-provider',SUMMARY_BASE_URL:'https://preview-model.test/v1',SUMMARY_MODEL:'synthetic-preview-model'},serviceBindings:{ASSETS:async request=>{
 const path=new URL(request.url).pathname;try{const data=await readFile(root+'/public'+path),type=path.endsWith('.js')?'text/javascript':path.endsWith('.css')?'text/css':path.endsWith('.html')?'text/html':'application/octet-stream';return new Response(data,{headers:{'content-type':type+'; charset=utf-8'}});}catch{return new Response('Not found',{status:404});}
 }},outboundService:async request=>{
 const body=await request.json(),input=JSON.parse(body.messages[1].content);let result;
 if(input.evidence){result={entries:input.evidence.map(e=>({id:e.id,categories:[e.record_type==='profile'?'personal':'development'],facts:[{section:e.record_type==='profile'?'personal':'projects',text:e.text,status:e.record_type==='profile'?'confirmed':'in_progress',project:e.record_type==='profile'?'':e.text.includes('内容工具')?'示例：内容工具':'示例：记忆中心'}]}))};}
 else{
  result={brief:'【示例资料】偏好清晰中文和可回溯记录。目前推进记忆中心与内容工具两个项目：基础接口已完成，正在完善分类、交接概要与检索验证；接下来核验项目进度和来源引用。',personal:[],projects:[],mainline:[],next_actions:[]};
  for(const entry of input.entries)for(const fact of entry.facts){if(fact.section==='personal')result.personal.push({text:fact.text,status:'confirmed',project:'',evidence_ids:[entry.id]});else{result.projects.push({name:fact.project,goal:'示例：让新 AI 能快速了解资料并继续工作',status:'in_progress',current_step:fact.text,next_step:'示例：核验检索效果、检查概要引用并确认下一步',blockers:'',evidence_ids:[entry.id]});result.mainline.push({text:'示例：完成项目交接与来源验证',status:'in_progress',project:fact.project,evidence_ids:[entry.id]});result.next_actions.push({text:'示例：验收本地新版，再决定上线',status:'planned',project:fact.project,evidence_ids:[entry.id]});}}
 }
 return Response.json({choices:[{message:{content:JSON.stringify(result)}}]});
 }}));
try{
 const DB=await mf.getD1Database('DB');
 for(const file of (await readdir(root+'/migrations')).filter(f=>f.endsWith('.sql')).sort()){
  const parsed=spawnSync('python3',['-c',"import sys,sqlite3,json\nparts=[];pending=''\nfor char in sys.stdin.read():\n pending+=char\n if char==';' and sqlite3.complete_statement(pending):\n  parts.append(pending);pending=''\nprint(json.dumps(parts))"],{input:await readFile(root+'/migrations/'+file,'utf8'),encoding:'utf8'});
  if(parsed.status!==0)throw new Error('Preview migration parsing failed');
  for(const statement of JSON.parse(parsed.stdout))await DB.prepare(statement).run();
 }
 const scopes=['memory:read','memory:write','conversation:import','sensitive:read','sensitive:write','admin'],policy={read_level:3,write_level:3,collections:['chats','memories','accounts','knowledge','projects']};
 await DB.prepare('INSERT INTO clients(id,owner_id,name,token_hash,scopes,created_at,expires_at,policy_json) VALUES(?,?,?,?,?,?,?,?)').bind('preview-admin','preview-owner','synthetic-preview',createHash('sha256').update(token).digest('hex'),JSON.stringify(scopes),new Date().toISOString(),'2999-12-31T00:00:00Z',JSON.stringify(policy)).run();
 const call=async(path,data)=>{const response=await mf.dispatchFetch(base+'/v1'+path,{method:data?'POST':'GET',headers:{authorization:'Bearer '+token,'content-type':'application/json'},...(data?{body:JSON.stringify(data)}:{})});const value=await response.json();if(!response.ok)throw new Error('Preview setup failed: '+value.error);return value;};
 for(const [key,record_type,text] of [['profile-language','profile','示例个人信息：偏好中文说明、图表和原文出处。'],['profile-handoff','profile','示例个人偏好：新 AI 先阅读概览，再按索引查细节。'],['memory-project','project','示例记忆中心：已完成基础读写，正在完善分类、详细概要与向量检索。'],['content-project','project','示例内容工具：已完成资料归档，正在整理近期内容计划。']])await call('/memories',{authorized:true,record_type,logical_key:key,source_platform:'synthetic-preview',source_kind:'test',timestamp:new Date().toISOString(),title:text.split('：')[0],text,sensitivity:'sensitive'});
 await call('/overview/refresh',{authorized:true,enabled:true,expected_version:0});await call('/overview/process',{authorized:true});
 const overview=await call('/overview?detail=full');if(overview.status!=='ready')throw new Error('Preview overview not ready');
 // Enroll a synthetic owner. Production owner-session and CSRF guards remain unchanged.
 const postAuth=async(path,data)=>{const response=await mf.dispatchFetch(base+'/ui/auth/'+path,{method:'POST',headers:{origin:base,authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify(data)});const value=await response.json();if(!response.ok)throw new Error('Synthetic enrollment failed');return value;};
 const {secret}=await postAuth('setup/start',{username:'synthetic-owner',password:randomBytes(24).toString('base64url')});
 let bits=0,value=0,bytes=[];for(const c of secret){value=(value<<5)|'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'.indexOf(c);bits+=5;if(bits>=8){bytes.push((value>>>(bits-8))&255);bits-=8;}}
 const counter=Buffer.alloc(8);counter.writeBigUInt64BE(BigInt(Math.floor(Date.now()/30000)-1));const hash=createHmac('sha1',Buffer.from(bytes)).update(counter).digest(),offset=hash.at(-1)&15,code=String((hash.readUInt32BE(offset)&0x7fffffff)%1000000).padStart(6,'0');await postAuth('setup/confirm',{code});
 const start=await mf.dispatchFetch(base+'/preview/start',{redirect:'manual'}),cookie=start.headers.get('set-cookie')?.split(';')[0],identity=await (await mf.dispatchFetch(base+'/ui/session',{headers:{cookie}})).json();
 if(!cookie)throw new Error('Synthetic preview session failed: '+start.status);
 const ownerCall=async(path,data)=>{const response=await mf.dispatchFetch(base+'/ui/api/strategy/'+path,{method:'POST',headers:{origin:base,cookie,'x-csrf-token':identity.csrf,'content-type':'application/json'},body:JSON.stringify(data)});if(!response.ok)throw new Error('Synthetic strategy setup failed');};
 const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 await ownerCall('draft',{authorized:true,expected_version:0,document:{vision:'【示例战略】让个人资料、工作方向与执行进度形成可回溯的长期系统。',principles:'示例：先核实来源，再逐步完成；仅用于演示，不是你的真实目标。',sensitivity:'sensitive',goals:[{id:'vision',kind:'strategy',title:'示例：建立长期可持续的个人工作系统',status:'active',success_criteria:'示例：方向清晰、资料可查、任务可接续'},{id:'stage',kind:'stage',parent_id:'vision',title:'示例：完成资料与目标的基础闭环',status:'active',current_state:'示例：基础记忆接口可用，目标管理正在验收',next_step:'示例：确认目标结构和验收标准',progress:45},{id:'month',kind:'month',parent_id:'stage',period:today.slice(0,7),title:'示例：完成本月目标拆解',status:'active',next_step:'示例：由本人确认正式战略内容',progress:20}]}});
 await ownerCall('publish',{authorized:true,expected_draft_version:1,expected_published_version:0});
 await mf.ready;
 console.log(JSON.stringify({preview:base+'/preview/start',synthetic_only:true,real_model_calls:false,real_database_access:false}));
 process.on('SIGTERM',()=>mf.dispose().then(()=>process.exit(0)));
 process.on('SIGINT',()=>mf.dispose().then(()=>process.exit(0)));
 await new Promise(()=>{});
}catch(error){await mf.dispose();throw error;}
