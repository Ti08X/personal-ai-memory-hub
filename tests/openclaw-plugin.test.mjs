import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,readdir,rm,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {configOf,Disk,Hub,MemoryEngine,HubError,hash,clean} from '../integrations/openclaw-memory/core.mjs';
import {registerMemory} from '../integrations/openclaw-memory/runtime.mjs';
import {rig} from './support/local-store.mjs';
import {build} from 'esbuild';

const key='pmh_'+'a'.repeat(64),config=()=>configOf({apiKey:key,autoArchive:true,archiveAuthorized:true,autoSummary:true,summaryAuthorized:true});
const ctx=(run='run-1',sid='session-1')=>({agentId:'main',sessionId:sid,sessionKey:'agent:main:main',runId:run,trigger:'user',inputProvenance:{kind:'external_user'},memoryAudience:{kind:'owner-private',agentId:'main'},toolAuthority:{allows:n=>n==='pmh_search',assertActive(){}}});
const prompt=(text='我准备建设记忆系统。',id='user-1')=>({currentUserMessage:text,currentUserMessageId:id,messages:[]});
const messages=(text='我准备建设记忆系统。',answer='下一步先完成自动归档。',id='user-1')=>[{id,role:'user',timestamp:'2026-10-14T12:00:00+08:00',content:text},{id:'assistant-'+id,role:'assistant',timestamp:'2026-10-14T12:01:00+08:00',content:[{type:'thinking',thinking:'private-reasoning'},{type:'text',text:answer}]}];
async function setup(fn){
 const r=rig(),dir=await mkdtemp(join(tmpdir(),'pmh-plugin-')),old=globalThis.fetch,requests=[];globalThis.fetch=r.mockFetch;
 let fail=false,loseResponse=false,ownerRef=hash('owner-a');
 const fetcher=async(url,init)=>{
  if(fail)throw new Error('simulated connection failure containing secret');
  assert.equal(init.headers.authorization,'Bearer '+key);requests.push({path:new URL(url).pathname,body:init.body?JSON.parse(init.body):undefined});const u=new URL(url),body=init.body?JSON.parse(init.body):undefined;
  try{
   let data;
   if(u.pathname==='/v1/integrations/activity')data={owner_ref:ownerRef,events:[]};
   else if(u.pathname==='/v1/handoff')data=await r.store.handoff();
   else if(u.pathname==='/v1/search')data=await r.store.search({...Object.fromEntries(u.searchParams),limit:Number(u.searchParams.get('limit')),rerank:u.searchParams.get('rerank')==='true'});
   else if(u.pathname==='/v1/conversations/import'){data=await r.store.importConversation(body);if(loseResponse){loseResponse=false;throw new Error('lost response after committed import');}}
   else if(u.pathname==='/v1/records')data=await r.store.listRecords(Object.fromEntries(u.searchParams));
   else if(u.pathname.startsWith('/v1/records/'))data=await r.store.get(u.pathname.split('/').pop());
   else if(u.pathname==='/v1/summaries/generate')data=await r.store.generateSummary(body);
   else throw new Error('unexpected endpoint');
   return Response.json(data);
  }catch(e){if(!e.status)throw e;return Response.json({error:e.code},{status:e.status});}
 };
 const disk=await new Disk(dir).init(),hub=new Hub(config(),fetcher),engine=new MemoryEngine(config(),disk,hub);
 try{await fn({r,dir,requests,disk,hub,engine,fetcher,setFail:v=>fail=v,lose:()=>loseResponse=true,setOwner:v=>ownerRef=v});}finally{globalThis.fetch=old;r.close();await rm(dir,{recursive:true,force:true});}
}

test('automatic prompt recall and capture persist only visible current-turn text, verify cloud records and summarize with evidence',()=>setup(async s=>{
 const saved=await s.r.store.save({...s.r.base,source_record_id:'personal-evidence',text:'项目规划讨论的合成原文'});await s.r.store.indexPending();await s.r.store.ragStatus();
 const p=prompt('关于项目规划，我准备整理经历。'),c=ctx(),recalled=await s.engine.recall(p,c);assert.match(recalled.prependContext,/项目规划/);assert.ok(!recalled.prependContext.includes(key));
 const count=s.requests.length;await s.engine.recall(p,c);assert.equal(s.requests.length,count,'same admission reuses context without repeating model search');
 const transcript=[{id:'old',role:'user',timestamp:'2026-10-09T00:00:00Z',content:'unauthorized-old-history'},...messages(p.currentUserMessage),{role:'tool',content:'private-tool-payload'},{role:'assistant',content:[{type:'thinking',thinking:'internal-reasoning'}]}];
 await s.engine.capture({runId:c.runId,success:true,messages:transcript},c);await s.engine.flush();
 const archived=(await s.r.store.listRecords({record_type:'message'})).records;assert.equal(archived.length,2);assert.ok(archived.every(r=>r.source_platform==='openclaw'&&r.sensitivity==='sensitive'));assert.ok(!JSON.stringify(archived).includes('private-tool-payload'));assert.ok(!JSON.stringify(archived).includes('unauthorized-old-history'));assert.ok(!JSON.stringify(archived).includes('internal-reasoning'));
 const summary=(await s.r.store.handoff()).summaries[0];assert.ok(summary);const full=await s.r.store.get(summary.id);assert.equal(full.payload.data.evidence.length,2);
 const summaryCall=s.r.calls.find(x=>x.url.endsWith('/chat/completions')),evidence=JSON.parse(summaryCall.body.messages[1].content).evidence;assert.deepEqual(evidence.map(e=>e.role).sort(),['assistant','user']);
 await s.engine.capture({runId:c.runId,success:true,messages:transcript},c);await s.engine.flush();assert.equal((await s.r.store.listRecords({record_type:'message'})).records.length,2);assert.equal(s.r.calls.filter(x=>x.url.endsWith('/chat/completions')).length,1);
 assert.equal((await s.engine.status()).pending_jobs,0);assert.equal((await stat(join(s.dir,'key'))).mode&0o777,0o600);assert.equal((await stat(s.dir)).mode&0o777,0o700);
}));
test('offline capture survives process restart, redacts credentials, and replays a lost committed import without duplicates',()=>setup(async s=>{
 s.setFail(true);const p=prompt('我的密码是abcSecret；API Key: '+key+'。准备整理记忆。'),c=ctx();await s.engine.recall(p,c);await s.engine.capture({runId:c.runId,success:true,messages:messages(p.currentUserMessage)},c);
 const jobs=await s.disk.jobs();assert.equal(jobs.length,1);const bytes=await readFile(join(s.dir,jobs[0]));assert.ok(!bytes.includes(Buffer.from('abcSecret')));assert.ok(!bytes.includes(Buffer.from(key)));const queued=await s.disk.read(jobs[0]);assert.ok(!JSON.stringify(queued).includes('abcSecret'));
 s.setFail(false);s.lose();let e=new MemoryEngine(config(),await new Disk(s.dir).init(),new Hub(config(),s.fetcher));await e.flush();assert.equal((await s.r.store.listRecords({record_type:'message'})).records.length,2);assert.equal((await e.status()).pending_jobs,1);
 e=new MemoryEngine(config(),await new Disk(s.dir).init(),new Hub(config(),s.fetcher));await e.resume();await e.flush();assert.equal((await s.r.store.listRecords({record_type:'message'})).records.length,2);assert.equal((await e.status()).pending_jobs,0);
}));
test('group/foreign-agent/system turns and denied or revoked tool authority cannot recall private context',()=>setup(async s=>{
 for(const c of [{...ctx(),memoryAudience:{kind:'conversation'}},{...ctx(),agentId:'other'},{...ctx(),trigger:'heartbeat',inputProvenance:{kind:'internal_system'}},{...ctx(),toolAuthority:{allows:()=>false}}])assert.equal(await s.engine.recall(prompt(),c),undefined);
 assert.equal(s.requests.length,0);
 let active=true;const c=ctx();c.toolAuthority.assertActive=()=>{if(!active)throw new Error('expired');};s.hub.request=async()=>{active=false;return {owner_ref:hash('owner-a')};};const result=await s.engine.recall(prompt(),c);assert.ok(!result?.prependContext.includes('related'));
}));
test('failed run captures the user first and a later successful final answer is still archived; modified messages retain conflicts',()=>setup(async s=>{
 const p=prompt(),c=ctx();await s.engine.recall(p,c);await s.engine.capture({runId:c.runId,success:false,messages:messages()},c);await s.engine.flush();assert.equal((await s.r.store.listRecords({record_type:'message'})).records.length,1);
 await s.engine.capture({runId:c.runId,success:true,messages:messages()},c);await s.engine.flush();assert.equal((await s.r.store.listRecords({record_type:'message'})).records.length,2);
 await s.engine.capture({runId:c.runId,success:true,messages:messages(p.currentUserMessage,'changed-answer')},c);await s.engine.flush();const jobs=await s.disk.jobs();assert.equal((await s.disk.read(jobs[0])).state,'conflict');await s.engine.resume();assert.equal((await s.disk.read(jobs[0])).state,'conflict');assert.ok((await s.r.store.conflicts()).conflicts.length);
}));
test('queued messages cannot be redirected to another owner after configuration changes',()=>setup(async s=>{
 const c=ctx();await s.engine.recall(prompt(),c);await s.engine.capture({runId:c.runId,success:true,messages:messages()},c);s.setOwner(hash('owner-b'));const restarted=new MemoryEngine(config(),s.disk,new Hub(config(),s.fetcher));await restarted.flush();const jobs=await s.disk.jobs();assert.equal((await s.disk.read(jobs[0])).code,'destination_changed');assert.equal((await s.r.store.listRecords({record_type:'message'})).records.length,0);
}));
test('slow network upload does not prevent a new turn from being durably queued',()=>setup(async s=>{
 const c=ctx();await s.engine.recall(prompt(),c);await s.engine.capture({runId:c.runId,success:true,messages:messages()},c);
 let release,entered;const gate=new Promise(r=>release=r),started=new Promise(r=>entered=r),original=s.hub.request.bind(s.hub);s.hub.request=async(path,body)=>{if(path==='/conversations/import'){entered();await gate;}return original(path,body);};
 const uploading=s.engine.flush();await started;
 const c2=ctx('run-2');await s.engine.recall(prompt('新的合成决定，需要保存。','user-2'),c2);await s.engine.capture({runId:c2.runId,success:true,messages:messages('新的合成决定，需要保存。','新的合成回答。','user-2')},c2);
 assert.equal((await s.disk.jobs()).length,2);release();await uploading;await s.engine.flush();assert.equal((await s.engine.status()).pending_jobs,0);
}));
test('plugin registers documented automatic hooks, policy-aware recall, owner-only status, and lifecycle retry service',()=>setup(async s=>{
 const hooks={},tools=[],commands={},services=[],warnings=[];
 const registered=registerMemory({pluginConfig:{...config(),apiKey:key},logger:{warn:x=>warnings.push(x)},on:(name,fn,options)=>hooks[name]={fn,options},registerTool:fn=>tools.push(fn),registerCommand:c=>commands[c.name]=c,registerService:c=>services.push(c)},{fetcher:s.fetcher});
 await services[0].start({stateDir:s.dir});const c=ctx();assert.equal(hooks.before_prompt_build.options.requiresToolAuthority,true);assert.ok(hooks.before_compaction&&hooks.session_end);await hooks.before_prompt_build.fn(prompt(),c);await hooks.agent_end.fn({runId:c.runId,success:true,messages:messages()},c);
 assert.match((await commands.pmh_status.handler({senderIsOwner:true})).text,/pending_jobs/);assert.match((await commands.pmh_status.handler({senderIsOwner:false})).text,/仅主人/);
 assert.equal(tools[0](c).name,'pmh_search');await assert.rejects(()=>tools[0]({...c,memoryAudience:{kind:'conversation'}}).execute('t',{query:'项目规划'}),e=>e.code==='private_session_required');await services[0].stop();assert.ok(registered.engine());assert.ok(!JSON.stringify(warnings).includes(key));
}));
test('lexical expansion finds history from natural questions while vector retrieval is unavailable',()=>setup(async s=>{
 s.r.env.RAG_ENABLED='false';await s.r.store.save({...s.r.base,source_record_id:'project-planning-history',text:'项目规划在项目的合成历史资料'});
 const result=await s.engine.recall(prompt('你知道我在项目项目规划的事情吗？'),ctx());assert.match(result.prependContext,/项目规划在项目/);assert.match(result.prependContext,/keyword_expansion/);assert.match(result.prependContext,/retrieval_not_configured/);
}));
test('lost successful summary response is recovered by evidence comparison instead of generating it twice',()=>setup(async s=>{
 const c=ctx();await s.engine.recall(prompt(),c);await s.engine.capture({runId:c.runId,success:true,messages:messages()},c);
 const original=s.hub.request.bind(s.hub);let lose=true;s.hub.request=async(path,body)=>{const result=await original(path,body);if(path==='/summaries/generate'&&lose){lose=false;throw new HubError('network_error');}return result;};
 await s.engine.flush();assert.equal((await s.engine.status()).pending_jobs,1);assert.equal(s.r.calls.filter(x=>x.url.endsWith('/chat/completions')).length,1);
 await s.engine.resume();await s.engine.flush();assert.equal((await s.engine.status()).pending_jobs,0);assert.equal(s.r.calls.filter(x=>x.url.endsWith('/chat/completions')).length,1);
}));
test('readback denial retains a blocked queue and reports no verified success, then resumes without duplicate messages',()=>setup(async s=>{
 const c=ctx();await s.engine.recall(prompt(),c);await s.engine.capture({runId:c.runId,success:true,messages:messages()},c);
 const original=s.hub.request.bind(s.hub);let deny=true;s.hub.request=(path,body)=>{if(path.startsWith('/records/')&&deny)throw new HubError('record_policy_denied',403);return original(path,body);};
 await s.engine.flush();const [id]=await s.disk.jobs();assert.equal((await s.disk.read(id)).state,'blocked');assert.equal((await s.engine.status()).state,'failed');assert.equal((await s.engine.status()).verified,0);
 deny=false;await s.engine.resume();await s.engine.flush();assert.equal((await s.engine.status()).pending_jobs,0);assert.equal((await s.r.store.listRecords({record_type:'message'})).records.length,2);
}));
test('configuration and cleaning reject credential URLs, placeholders, internal wrappers and historical heartbeat input',()=>{
 for(const baseUrl of ['http://hub.test','https://u:p@hub.test','https://hub.test?api_key=x','https://hub.test/mcp'])assert.throws(()=>configOf({baseUrl,apiKey:key}));assert.throws(()=>configOf({apiKey:'***'}));
 assert.equal(clean('<heartbeat>internal</heartbeat>'),'');assert.equal(clean('<in-app-browser-context>private</in-app-browser-context>实际请求'),'实际请求');assert.equal(clean('<think>reason</think>公开回答'),'公开回答');
});

test('OpenClaw 2026.10.3 official SDK normalizes the entry and validates manifest configuration',async t=>{
 const sdkPath=new URL('../work-v2/openclaw-plugin-reference/sdk/package/dist/plugin-sdk/plugin-entry.js',import.meta.url);
 try{await stat(sdkPath);}catch{t.skip('official SDK reference must be fetched before compatibility validation');return;}
 const sdk=await import(sdkPath.href),manifest=JSON.parse(await readFile(new URL('../integrations/openclaw-memory/openclaw.plugin.json',import.meta.url),'utf8'));
 const schema=sdk.buildJsonPluginConfigSchema(manifest.configSchema);assert.equal(schema.safeParse({apiKey:key,autoRecall:true}).success,true);assert.equal(schema.safeParse({unexpected:true}).success,false);
 const {outputFiles}=await build({entryPoints:['integrations/openclaw-memory/index.js'],bundle:true,write:false,format:'esm',platform:'node',external:['openclaw/plugin-sdk/plugin-entry']});
 const source=outputFiles[0].text.replace('"openclaw/plugin-sdk/plugin-entry"',JSON.stringify(sdkPath.href)).replace('new URL("./openclaw.plugin.json", import.meta.url)',JSON.stringify(new URL('../integrations/openclaw-memory/openclaw.plugin.json',import.meta.url).pathname));
 const entry=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));assert.equal(entry.default.id,'personal-ai-memory-hub');assert.equal(typeof entry.default.register,'function');
});
