import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID} from 'node:crypto';
import {configOf,Disk,Hub,MemoryEngine,hash} from '../integrations/openclaw-memory/core.mjs';
const base=process.env.HUB_URL??'http://localhost:8910';
const credentials=JSON.parse(await readFile(process.env.CREDENTIAL_FILE,'utf8'));
const admin=credentials.clients.admin.token;
const call=async(path,token=admin,body)=>{const response=await fetch(base+path,{method:body?'POST':'GET',headers:{authorization:'Bearer '+token,...(body?{'content-type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});return {status:response.status,data:await response.json()};};
const event=(id='event')=>({authorized:true,event_id:hash(id),timestamp:new Date().toISOString(),plugin_version:'0.1.0',phase:'archive',state:'success',code:'none',session_ref:hash('session'),counts:{archived:2,verified:2}});

test('activity metadata requires authorization, rejects content/keys, deduplicates and keeps client/owner boundaries',async()=>{
 const suffix=randomUUID();const client=(await call('/v1/clients',admin,{name:'plugin-'+suffix,scopes:['memory:read','memory:write'],expires_days:1})).data;
 try{
  assert.equal((await call('/v1/integrations/activity',credentials.clients.reader.token,event(suffix))).status,403);
  assert.equal((await call('/v1/integrations/activity',client.token,{...event(suffix),text:'no raw chat in telemetry'})).status,400);
  const saved=await call('/v1/integrations/activity',client.token,event(suffix));assert.equal(saved.status,201);
  const duplicate=await call('/v1/integrations/activity',client.token,event(suffix));assert.equal(duplicate.status,201);assert.equal(duplicate.data.deduplicated,true);
  assert.equal((await call('/v1/integrations/activity',client.token,{...event(suffix),state:'failed'})).status,409);
  const own=(await call('/v1/integrations/activity',client.token)).data;assert.match(own.owner_ref,/^[a-f0-9]{64}$/);assert.equal(own.events.length,1);assert.equal(own.events[0].client_id,client.id);
  const other=(await call('/v1/integrations/activity',credentials.clients.codex.token)).data;assert.equal(other.events.some(e=>e.client_id===client.id),false);
  const foreign=(await call('/v1/integrations/activity',credentials.clients.outsider.token)).data;assert.notEqual(foreign.owner_ref,own.owner_ref);assert.equal(foreign.events.some(e=>e.client_id===client.id),false);
  assert.equal((await call('/v1/integrations/activity')).data.events.some(e=>e.client_id===client.id),true);
 }finally{const r=await fetch(base+'/v1/clients/'+client.id,{method:'DELETE',headers:{authorization:'Bearer '+admin,'content-type':'application/json'},body:JSON.stringify({authorized:true})});assert.equal(r.status,200);}
});
test('plugin automatic flow runs against real isolated Worker HTTP, uploads verified messages and reports activity',async()=>{
 const suffix=randomUUID(),minted=await call('/v1/clients',admin,{name:'automatic-http-'+suffix,scopes:['memory:read','memory:write','conversation:import','sensitive:read','sensitive:write'],expires_days:1,policy:{read_level:2,write_level:2,collections:['chats','memories','projects','accounts','knowledge']}});assert.equal(minted.status,201);const client=minted.data;
 const dir=await mkdtemp(join(tmpdir(),'pmh-auto-http-'));
 try{
  const conf=configOf({apiKey:client.token,baseUrl:'https://hub.test/v1',autoArchive:true,archiveAuthorized:true}),hub=new Hub(conf,(url,init)=>fetch(base+new URL(url).pathname+new URL(url).search,init)),engine=new MemoryEngine(conf,await new Disk(dir).init(),hub);
  const ctx={agentId:'main',sessionId:suffix,sessionKey:'agent:main:main',runId:'run-'+suffix,inputProvenance:{kind:'external_user'},memoryAudience:{kind:'owner-private',agentId:'main'},toolAuthority:{allows:()=>true,assertActive(){}}},query='合成自动归档 HTTP 验收资料';
  const result=await engine.recall({currentUserMessage:query,currentUserMessageId:'user-'+suffix,messages:[]},ctx);assert.match(result.prependContext,/Personal AI Memory Hub/);
  const messages=[{id:'user-'+suffix,role:'user',timestamp:new Date().toISOString(),content:query},{id:'assistant-'+suffix,role:'assistant',timestamp:new Date().toISOString(),content:'合成助手回答，准备核对来源。'}];
  await engine.capture({runId:ctx.runId,success:true,messages},ctx);await engine.flush();assert.equal((await engine.status()).pending_jobs,0);
  const events=(await call('/v1/integrations/activity',client.token)).data.events;assert.ok(events.some(e=>e.phase==='archive'&&e.state==='success'&&e.counts.verified===2));
  const records=(await call('/v1/records?source_platform=openclaw&session_id='+encodeURIComponent('oc_'+hash(['main',suffix])),client.token)).data.records;assert.equal(records.length,2);assert.ok(records.some(r=>r.payload.text===query));
  await engine.capture({runId:ctx.runId,success:true,messages},ctx);await engine.flush();assert.equal((await call('/v1/records?source_platform=openclaw&session_id='+encodeURIComponent('oc_'+hash(['main',suffix])),client.token)).data.records.length,2);
 }finally{await rm(dir,{recursive:true,force:true});await fetch(base+'/v1/clients/'+client.id,{method:'DELETE',headers:{authorization:'Bearer '+admin,'content-type':'application/json'},body:JSON.stringify({authorized:true})});}
});
