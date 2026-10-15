// Read-only production verification. Never print credentials or private record text.
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fetch as undiciFetch,ProxyAgent} from 'undici';
import {Client,StreamableHTTPClientTransport} from '@modelcontextprotocol/client';
import {options,loadCredentials} from './lib.mjs';
const args=options(),base=String(args.url??'https://pw.zgatri.com'),dispatcher=args.proxy?new ProxyAgent(args.proxy):undefined;
const fetcher=(url,init={})=>undiciFetch(url,{...init,...(dispatcher?{dispatcher}:{}),signal:init.signal??AbortSignal.timeout(30000)});
const checks={checked_at:new Date().toISOString(),url:base,mode:'read_only',clients:[]};
const digest=v=>createHash('sha256').update(v).digest('hex');
let stage='health';
try{
 const health=await fetcher(base+'/health');assert.equal(health.status,200);const info=await health.json();assert.equal(info.version,'0.4.0');checks.service_version=info.version;
 stage='account_status';const auth=await fetcher(base+'/ui/auth/status');assert.equal(auth.status,200);assert.equal((await auth.json()).configured,true);checks.existing_account_configured=true;
 stage='unauthenticated_access';
 assert.equal((await fetcher(base+'/v1/handoff')).status,401);
 assert.equal((await fetcher(base+'/v1/integrations/activity')).status,401);
 assert.equal((await fetcher(base+'/ui/api/model-settings')).status,401);
 checks.unauthenticated_access_denied=true;
 checks.assets=[];
 for(const file of ['index.html','app.js','style.css','launch.js','collections.js','import-format.js','client-access.js','auth-bootstrap.js','overview-ui.js','strategy-ui.js','openclaw-quickstart.md','memory-hub-client.py','memory-skill-setup.md','personal-ai-memory-hub-skill.zip','personal-ai-memory-hub-skill.sha256','openclaw-memory-setup.md','openclaw-personal-memory-hub.tgz','openclaw-personal-memory-hub.sha256']){
  stage='asset:'+file;
  const path=file==='index.html'?'/dashboard':'/'+file;
  const remote=await fetcher(base+path);assert.equal(remote.status,200);
  assert.equal(digest(Buffer.from(await remote.arrayBuffer())),digest(await readFile(new URL('../public/'+file,import.meta.url))));
  checks.assets.push({file,identical_to_local:true});
 }
 for(const clientName of ['codex','antigravity']){
  stage='credentials:'+clientName;
  const credentials=await loadCredentials(args['credential-dir']+'/'+clientName+'.json',clientName);
  const api=async path=>{stage='read:'+clientName+':'+path.split('?')[0];const r=await fetcher(base+path,{headers:{authorization:'Bearer '+credentials.token}});assert.equal(r.status,200,'read-only endpoint failed: '+path);return r.json();};
  const strategy=await api('/v1/strategy');assert.equal(strategy.agent_writable,false);assert.equal(strategy.priority,'highest_personal_planning');
  const denied=await fetcher(base+'/v1/strategy/publish',{method:'POST',headers:{authorization:'Bearer '+credentials.token,'content-type':'application/json'},body:JSON.stringify({authorized:true})});assert.equal(denied.status,403);
  const rag=await api('/v1/rag/status'),handoff=await api('/v1/handoff'),dashboard=await api('/v1/dashboard'),activity=await api('/v1/integrations/activity?limit=1');
  assert.equal(Object.keys(handoff)[0],'strategy');assert.equal(handoff.strategy.agent_writable,false);
  assert.equal(rag.application_model_limit,false);assert.equal(rag.calls_per_day,null);
  assert.match(activity.owner_ref,/^[a-f0-9]{64}$/);assert.equal(activity.scope,'this_client');assert.ok(Array.isArray(activity.events));
  const search=await api('/v1/search?query='+encodeURIComponent('记忆')+'&mode=keyword&rerank=false');
  assert.ok(Array.isArray(search.records));assert.match(search.search_mode,/Exact substring/);
  assert.equal((await fetcher(base+'/ui/api/model-settings',{headers:{authorization:'Bearer '+credentials.token}})).status,401);
  stage='mcp:'+clientName;const client=new Client({name:'deployment-read-only-check',version:'1'});
  await client.connect(new StreamableHTTPClientTransport(new URL(base+'/mcp'),{fetch:fetcher,authProvider:{token:async()=>credentials.token},requestInit:{redirect:'error'}}));
  let names;try{
   names=(await client.listTools()).tools.map(t=>t.name).sort();assert.equal(names.length,12);assert.ok(names.includes('get_strategy'));assert.ok(names.includes('get_overview'));
   const result=await client.callTool({name:'get_handoff',arguments:{}});assert.ok(!result.isError);
  }finally{await client.close();}
  checks.clients.push({client:clientName,rest_reads:'passed',mcp_handoff:'passed',strategy:{status:strategy.status,agent_write_denied:true,priority:strategy.priority},mcp_tools:names,visible_records:dashboard.totals.records,handoff_counts:{summaries:handoff.summaries.length,projects:handoff.projects.length,tasks:handoff.tasks.length},retrieval:{enabled:rag.enabled,configured:rag.configured,summary_configured:rag.summary_configured,application_model_limit:rag.application_model_limit,calls_per_day:rag.calls_per_day},automatic_memory_status:{accessible:true,scope:activity.scope,reported_events:activity.events.length},keyword_search:'passed',model_settings_bearer_denied:true});
 }
 checks.actual_model_calls='not_requested_read_only_verification';
 await writeFile(args.output??'docs/v2-live-verification.json',JSON.stringify(checks,null,2)+'\n');
 console.log(JSON.stringify(checks,null,2));
}catch{
 console.error('Read-only deployment verification failed at '+stage+'; no private response or credentials printed.');process.exitCode=1;
}finally{if(dispatcher)await dispatcher.close();}
