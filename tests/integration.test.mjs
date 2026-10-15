import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { fileURLToPath } from 'node:url';

const credentialFile=process.env.CREDENTIAL_FILE??fileURLToPath(new URL('../../../work/memory-hub-private/credentials.json',import.meta.url));
const config=JSON.parse(await readFile(credentialFile,'utf8'));
const base=process.env.HUB_URL??'http://localhost:8790';
const session='integration-'+randomUUID(), stamp=new Date().toISOString();
const memory={authorized:true,source_platform:'integration-test',session_id:session,source_record_id:'memory-1',source_kind:'test',timestamp:stamp,text:'这是跨平台记忆测试：今天做了云端上下文系统。'};
let recordId,profileId,conflictId;
async function api(path,{client='admin',method='GET',body,token,headers={}}={}) {
 let res;
 for(let attempt=0;attempt<2;attempt++){
  res=await fetch(base+path,{method,headers:{authorization:'Bearer '+(token??config.clients[client].token),...(body?{'content-type':'application/json'}:{}),...headers},body:body?JSON.stringify(body):undefined});
  if(res.status!==429||attempt===1)break;
  await res.arrayBuffer();await new Promise(resolve=>setTimeout(resolve,61000-Date.now()%60000));
 }
 return {status:res.status,headers:res.headers,data:await res.json()};
}
after(async()=>{for(const client of ['admin','outsider'])await api('/v1/conversations',{client,method:'DELETE',body:{authorized:true,source_platform:'integration-test',session_id:session}}).catch(()=>{});});
test('health, invalid authentication and origin restrictions',async()=>{
 assert.equal((await fetch(base+'/health')).status,200);
 assert.equal((await api('/v1/profile',{token:'invalid-token'})).status,401);
 assert.equal((await api('/v1/profile',{headers:{Origin:'https://untrusted.example'}})).status,403);
 assert.equal((await api('/v1/profile')).headers.get('cache-control'),'no-store');
});
test('scoped writes, authorization assertion and credential rejection',async()=>{
 assert.equal((await api('/v1/memories',{client:'reader',method:'POST',body:memory})).status,403);
 assert.equal((await api('/v1/memories',{method:'POST',body:{...memory,authorized:false}})).status,400);
 for(const text of ['pmh_'+'a'.repeat(64),'https://example.invalid/?X-Amz-Signature='+'b'.repeat(64)])assert.equal((await api('/v1/memories',{method:'POST',body:{...memory,text}})).status,422);
 const wide=Array.from({length:17000},(_,i)=>String.fromCharCode(0x4e00+i)).join('');
 assert.equal((await api('/v1/memories',{method:'POST',body:{...memory,source_record_id:'wide-index-test',data:{wide}}})).status,413);
 const sensitiveString='sk-'+'exampleCredential'.repeat(3);
 assert.equal((await api('/v1/memories',{method:'POST',body:{...memory,text:sensitiveString}})).status,422);
});
test('idempotent save and Chinese exact-substring full-text search',async()=>{
 const a=await api('/v1/memories',{client:'codex',method:'POST',body:memory});assert.equal(a.status,201);recordId=a.data.id;
 const b=await api('/v1/memories',{client:'antigravity',method:'POST',body:memory});assert.equal(b.data.id,recordId);assert.equal(b.data.deduplicated,true);
 const found=await api('/v1/search?query='+encodeURIComponent('云端上下文系统'),{client:'antigravity'});
 assert.equal(found.status,200);assert.ok(found.data.records.some(r=>r.id===recordId));
 assert.equal((await api('/v1/search?query='+encodeURIComponent('云'))).status,400);
});
test('owner isolation and versioned conflict resolution',async()=>{
 assert.equal((await api('/v1/records/'+recordId,{client:'outsider'})).status,404);
 const other=await api('/v1/memories',{client:'outsider',method:'POST',body:memory});assert.equal(other.status,201);assert.notEqual(other.data.id,recordId);
 const changed={...memory,text:'这是跨平台记忆测试：已验证中文检索与冲突处理。'};
 const conflict=await api('/v1/memories',{client:'antigravity',method:'POST',body:changed});assert.equal(conflict.status,409);assert.equal(conflict.data.details.current_version,1);conflictId=conflict.data.details.conflict_id;
 const pending=await api('/v1/conflicts');assert.ok(pending.data.conflicts.some(c=>c.id===conflictId));
 const resolved=await api('/v1/memories',{client:'antigravity',method:'POST',body:{...changed,expected_version:1,conflict_id:conflictId}});assert.equal(resolved.data.version,2);
 const history=await api('/v1/records/'+recordId+'/history');assert.equal(history.status,200,history.data.error);assert.equal(history.data.versions.length,2);assert.equal(history.data.versions[0].payload.text,memory.text);
 assert.ok(!(await api('/v1/conflicts')).data.conflicts.some(c=>c.id===conflictId));
 assert.equal((await api('/v1/records/'+recordId)).data.source_platform,'integration-test');
});
test('structured profile and recent context preserve provenance',async()=>{
 const p=await api('/v1/memories',{method:'POST',body:{...memory,record_type:'profile',source_record_id:undefined,logical_key:session+'.goal',text:'测试画像',data:{goal:'Personal AI Memory Hub'}}});profileId=p.data.id;
 const profile=await api('/v1/profile');assert.equal(profile.data.fields[session+'.goal'].goal,'Personal AI Memory Hub');
 const ctx=await api('/v1/context?session_id='+session);assert.ok(ctx.data.records.some(r=>r.id===profileId));
 assert.ok(ctx.data.records.every(r=>r.session_id===session&&r.source_timestamp&&r.source_kind));
});
test('incremental raw conversation import preserves original fields',async()=>{
 const payload={authorized:true,source_platform:'integration-test',session_id:session,title:'合成会话归档',completeness:'full',raw_metadata:{branch:'original',attachment_refs:['test-reference-no-binary']},messages:[{id:'u1',role:'user',timestamp:stamp,content:'完整原始对话归档测试',raw:{extra_field:'保留原始字段'}},{id:'a1',role:'assistant',timestamp:stamp,content:'收到，这是合成数据。'}]};
 const a=await api('/v1/conversations/import',{client:'codex',method:'POST',body:payload});assert.equal(a.status,201);assert.equal(a.data.messages.length,2);
 const b=await api('/v1/conversations/import',{client:'antigravity',method:'POST',body:payload});assert.equal(b.data.batch_id,a.data.batch_id);assert.ok(b.data.messages.every(m=>m.deduplicated));
 const more=await api('/v1/conversations/import',{client:'codex',method:'POST',body:{...payload,completeness:'partial',messages:[{id:'u2',role:'user',timestamp:stamp,content:'增量消息'}]}});assert.equal(more.status,201);
 const archive=await api('/v1/conversations/archive?source_platform=integration-test&session_id='+session);assert.equal(archive.data.batches.length,2);
 assert.equal(archive.data.batches.find(b=>b.id===a.data.batch_id).payload.messages[0].raw.extra_field,'保留原始字段');
 assert.equal((await api('/v1/conversations/archive?source_platform=integration-test&session_id='+session,{client:'reader'})).status,403);
 const search=await api('/v1/search?record_type=message&query='+encodeURIComponent('完整原始对话'));assert.equal(search.status,200,search.data.error);assert.ok(search.data.records.some(r=>r.source_record_id==='u1'&&r.session_id===session));
 const changed=await api('/v1/conversations/import',{method:'POST',body:{...payload,messages:[{...payload.messages[0],content:'已编辑的归档测试'}]}});assert.equal(changed.data.conflicts,1);
});
test('sensitive information requires separate scopes throughout search/context/history',async()=>{
 const s=await api('/v1/memories',{method:'POST',body:{...memory,source_record_id:'secret',sensitivity:'sensitive',text:'合成敏感信息测试标记'}});assert.equal(s.status,201);
 assert.equal((await api('/v1/records/'+s.data.id,{client:'reader'})).status,404);
 assert.equal((await api('/v1/memories',{client:'codex',method:'POST',body:{...memory,sensitivity:'sensitive'}})).status,403);
 const found=await api('/v1/search?query='+encodeURIComponent('合成敏感信息测试标记'),{client:'reader'});assert.equal(found.data.records.length,0);
 assert.ok(!(await api('/v1/context?session_id='+session,{client:'reader'})).data.records.some(r=>r.id===s.data.id));
 // A later normal version must not expose its earlier sensitive history.
 const normal=await api('/v1/memories',{method:'POST',body:{...memory,source_record_id:'secret',text:'公开的合成信息',expected_version:1}});assert.equal(normal.data.version,2);
 const history=await api('/v1/records/'+s.data.id+'/history',{client:'reader'});assert.deepEqual(history.data.versions.map(v=>v.version),[2]);
});
test('client minting and revocation never grant cross-owner or unscoped writes',async()=>{
 assert.equal((await api('/v1/clients/'+config.clients.outsider.id,{method:'DELETE',body:{authorized:true}})).status,404);
 const minted=await api('/v1/clients',{method:'POST',body:{name:session,scopes:['memory:read'],expires_days:1}});assert.equal(minted.status,201);
 try{assert.equal((await api('/v1/profile',{token:minted.data.token})).status,200);assert.equal((await api('/v1/memories',{token:minted.data.token,method:'POST',body:memory})).status,403);}
 finally{await api('/v1/clients/'+minted.data.id,{method:'DELETE',body:{authorized:true}});}
 assert.equal((await api('/v1/profile',{token:minted.data.token})).status,401);
});
test('V2 HTTP endpoints, scoped policies, expiry renewal and honest disabled RAG',async()=>{
 const account=await api('/v1/social-accounts',{method:'POST',body:{...memory,record_type:'profile',logical_key:'accounts.'+session,text:'合成社交账号资料',data:{url:'https://example.com/synthetic',purpose:'test'}}});assert.equal(account.status,201);
 const project=await api('/v1/projects',{method:'POST',body:{...memory,source_record_id:'project',record_type:'project',text:'合成主线计划'}});assert.equal(project.status,201);
 assert.ok((await api('/v1/projects')).data.records.some(r=>r.id===project.data.id));
 assert.ok((await api('/v1/handoff')).data.projects.some(r=>r.id===project.data.id));
 const limited=await api('/v1/clients',{method:'POST',body:{name:session+'-limited',scopes:['memory:read','admin'],expires_days:1,policy:{read_level:1,write_level:1,collections:['projects']}}});assert.equal(limited.status,201);
 try{
  assert.equal((await api('/v1/social-accounts',{token:limited.data.token})).data.records.length,0);
  const escalate=await api('/v1/clients',{token:limited.data.token,method:'POST',body:{name:'attempt',scopes:['memory:read'],policy:{read_level:2,write_level:1,collections:['projects']}}});assert.equal(escalate.status,403);
  const renew=await api('/v1/clients/'+limited.data.id+'/renew',{method:'POST',body:{authorized:true,expires_days:30}});assert.equal(renew.status,200);assert.ok(Date.parse(renew.data.expires_at)>Date.parse(limited.data.expires_at));
  const short=await api('/v1/clients/'+limited.data.id+'/renew',{method:'POST',body:{authorized:true,expires_days:1}});assert.equal(short.data.expires_at,renew.data.expires_at);
 }finally{await api('/v1/clients/'+limited.data.id,{method:'DELETE',body:{authorized:true}});}
 const fallback=await api('/v1/search?mode=hybrid&query='+encodeURIComponent('合成主线'));assert.equal(fallback.data.degraded,true);assert.equal(fallback.data.reason,'retrieval_not_configured');
 assert.equal((await api('/v1/rag/status')).data.configured,false);
 assert.equal((await api('/v1/rag/index',{method:'POST',body:{authorized:true}})).status,503);
 assert.equal((await api('/v1/summaries/generate',{method:'POST',body:{authorized:true,evidence:[{id:project.data.id,version:1}]}})).data.error,'summary_not_configured');
});
test('real Streamable HTTP MCP discovers overview tools and invokes the core tools',async()=>{
 const client=new Client({name:'integration-suite',version:'1'});
 await client.connect(new StreamableHTTPClientTransport(new URL(base+'/mcp'),{authProvider:{token:async()=>config.clients.codex.token}}));
 try {
  const list=await client.listTools();assert.deepEqual(list.tools.map(t=>t.name).sort(),['get_strategy','get_profile','get_context','search_memory','save_memory','import_conversation','get_handoff','get_overview','classify_memory','list_memory_summaries','get_memory_summary','find_memory_by_label','set_memory_labels','list_social_accounts','save_social_account','generate_summary'].sort());
  for(const [name,args] of [['get_profile',{}],['get_context',{session_id:session}],['search_memory',{query:'冲突处理'}],['save_memory',{...memory,source_record_id:'mcp-message',text:'MCP远程写入测试'}],['import_conversation',{authorized:true,source_platform:'integration-test',session_id:session,title:'',completeness:'partial',messages:[{id:'mcp-import',role:'user',timestamp:stamp,content:'远程MCP导入'}]}]]) {
   const result=await client.callTool({name,arguments:args});assert.ok(!result.isError,JSON.stringify(result));
  }
 }finally{await client.close();}
});
test('overview and topic classification REST share source version guards, scopes and dashboard counts',async()=>{
 const source=await api('/v1/memories',{method:'POST',body:{...memory,source_record_id:'categorized-source',text:'合成个人情况与开发进度测试'}});assert.equal(source.status,201);
 const body={authorized:true,id:source.data.id,version:1,expected_revision:0,categories:['personal','development']};
 assert.equal((await api('/v1/classifications',{method:'POST',body})).status,200);
 assert.equal((await api('/v1/classifications',{method:'POST',body})).status,409);
 const read=await api('/v1/records/'+source.data.id);assert.equal(read.data.version,1);assert.deepEqual(read.data.classification.categories,['personal','development']);
 assert.ok((await api('/v1/records?category=development')).data.records.some(r=>r.id===source.data.id));
 assert.ok((await api('/v1/search?query='+encodeURIComponent('开发进度')+'&category=personal')).data.records.some(r=>r.id===source.data.id));
 const overview=await api('/v1/overview?detail=full&section=projects');assert.equal(overview.status,200);assert.ok(overview.data.counts.classified>=1);assert.ok(overview.data.index.sections.some(s=>s.section==='projects'));
 assert.ok((await api('/v1/handoff')).data.overview);
 assert.equal((await api('/v1/classifications',{client:'reader',method:'POST',body:{...body,expected_revision:1}})).status,403);
 assert.equal((await api('/v1/overview/process',{method:'POST',body:{authorized:true}})).status,403);
});
test('standard stdio bridge forwards discovery and tool results to cloud HTTP',async(t)=>{
 // Use the actual private credential endpoint; local run defaults to localhost.
 if(config.endpoint!==base){t.skip('Credential endpoint differs from test target');return;}
 const client=new Client({name:'stdio-integration',version:'1'});
 await client.connect(new StdioClientTransport({command:process.execPath,args:[fileURLToPath(new URL('../scripts/mcp-bridge.mjs',import.meta.url)),'--credential-file',credentialFile,'--client','antigravity'],stderr:'pipe'}));
 try{assert.equal((await client.listTools()).tools.length,16);assert.ok(!(await client.callTool({name:'get_profile',arguments:{}})).isError);assert.ok(!(await client.callTool({name:'get_overview',arguments:{}})).isError);}finally{await client.close();}
});
test('paginated export and destructive cleanup update FTS atomically',async()=>{
 const exported=await api('/v1/export?limit=1');assert.equal(exported.data.records.length,1);assert.ok(exported.data.next_cursor);
 assert.equal((await api('/v1/conversations',{method:'DELETE',client:'codex',body:{authorized:true,source_platform:'integration-test',session_id:session}})).status,403);
 assert.equal((await api('/v1/conversations',{method:'DELETE',body:{authorized:true,source_platform:'integration-test',session_id:session}})).status,200);
 const search=await api('/v1/search?query='+encodeURIComponent('云端上下文系统'));assert.ok(!search.data.records.some(r=>r.session_id===session));
 assert.equal((await api('/v1/records/'+recordId)).status,404);
});

test('strategy API is read-only for Bearer clients including admin and requires owner dashboard identity',async()=>{
 const read=await api('/v1/strategy');assert.equal(read.status,200);assert.equal(read.data.agent_writable,false);
 for(const path of ['/v1/strategy','/v1/strategy/draft','/v1/strategy/publish','/v1/strategy/history']){
  assert.equal((await api(path,{method:'POST',body:{authorized:true}})).status,403);
  assert.equal((await api(path,{method:'DELETE',body:{authorized:true}})).status,403);
 }
 assert.equal((await api('/ui/api/strategy/draft',{method:'POST',body:{authorized:true}})).status,401);
 assert.equal((await api('/v1/strategy/history')).status,404);
 assert.equal((await api('/v1/memories',{method:'POST',body:{...memory,logical_key:'strategy.current'}})).status,403);
 const start=await api('/ui/session',{method:'POST',headers:{origin:base},body:{}});assert.equal(start.status,200);const cookie=start.headers.get('set-cookie').split(';')[0];
 const blocked=await fetch(base+'/ui/api/strategy',{headers:{cookie}});assert.equal(blocked.status,403);assert.equal((await blocked.json()).error,'strategy_owner_dashboard_only');
});

test('library REST routes expose shared taxonomy, exact label lookup, pagination and source revision conflicts',async()=>{
 const saved=await api('/v1/memories',{method:'POST',body:{...memory,source_record_id:'library-labeled',text:'合成项目归属与多标签接口验证。'}});assert.equal(saved.status,201);const id=saved.data.id;
 const labels=await api('/v1/library/labels/'+id);assert.equal(labels.status,200);assert.equal(labels.data.revision,0);
 const body={authorized:true,id,version:1,expected_revision:0,expected_classification_revision:0,categories:['development','learning'],tags:['集成测试'],projects:['合成项目']};
 const changed=await api('/v1/library/labels',{method:'POST',body});assert.equal(changed.status,200);assert.deepEqual(changed.data.labels.tags,['集成测试']);assert.equal((await api('/v1/library/labels',{method:'POST',body})).status,409);
 const found=await api('/v1/library/records?kind=tag&name='+encodeURIComponent('集成测试'));assert.equal(found.data.records[0].id,id);assert.equal((await api('/v1/records/'+id)).data.version,1);
 const status=await api('/v1/library/status');assert.equal(status.data.application_model_limit,false);
 assert.equal((await api('/v1/library/control',{method:'POST',client:'codex',body:{authorized:true,enabled:false,expected_revision:0}})).status,403);
 assert.equal((await api('/v1/library/summaries?kind=week&limit=1')).status,200);
});
