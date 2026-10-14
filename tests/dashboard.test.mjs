import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
const config=JSON.parse(await readFile(process.env.CREDENTIAL_FILE??new URL('../../../work/memory-hub-private/credentials.json',import.meta.url),'utf8'));
const base=process.env.HUB_URL??'http://localhost:8790',sid='dashboard-test-'+randomUUID(),timestamp=new Date().toISOString();
const managed=[];
async function call(path,{client='admin',method='GET',body,cookie,csrf,origin,token}={}){
 let r;for(let a=0;a<3;a++){r=await fetch(base+path,{method,headers:{...(cookie?{cookie}:{authorization:'Bearer '+(token??config.clients[client].token)}),...(body?{'content-type':'application/json'}:{}),...(origin?{origin}:{}),...(csrf?{'x-csrf-token':csrf}:{})},body:body?JSON.stringify(body):undefined});if(r.status!==429||a===2)break;await r.arrayBuffer();await new Promise(resolve=>setTimeout(resolve,61000-Date.now()%60000));}
 return {status:r.status,headers:r.headers,data:r.headers.get('content-type')?.includes('application/json')?await r.json():await r.text()};
}
async function login(client='admin',token){const r=await call('/ui/session',{method:'POST',origin:base,client,token});assert.equal(r.status,200);return {cookie:r.headers.get('set-cookie').split(';')[0],csrf:r.data.csrf};}
after(async()=>{await call('/v1/conversations',{method:'DELETE',body:{authorized:true,source_platform:'dashboard-test',session_id:sid}});for(const id of managed)await call('/v1/clients/'+id,{method:'DELETE',body:{authorized:true}});});
test('dashboard shell is public, private endpoints require a session and restrictive security headers',async()=>{
 const shell=await call('/dashboard');assert.equal(shell.status,200);assert.match(shell.data,/我的记忆空间/);assert.ok(shell.headers.get('content-security-policy').includes("frame-ancestors 'none'"));assert.equal(shell.headers.get('cache-control'),'no-store');
 const anon=await fetch(base+'/ui/api/dashboard');assert.equal(anon.status,401);
 assert.equal((await call('/ui/session',{method:'POST'})).status,403);
 assert.equal((await call('/ui/session',{method:'POST',origin:'https://evil.invalid'})).status,403);
 assert.equal((await call('/ui/session',{method:'POST',origin:base,token:'not-a-valid-token'})).status,401);
 const js=await call('/app.js');assert.equal(js.status,200);assert.ok(!js.data.includes('localStorage'));assert.ok(!js.data.includes('innerHTML'));
 for(const path of ['/client-access.js','/openclaw-quickstart.md','/memory-hub-client.py'])assert.equal((await call(path)).status,200);
 for(const path of ['/memory-skill-setup.md','/personal-ai-memory-hub-skill.zip','/personal-ai-memory-hub-skill.sha256','/openclaw-memory-setup.md','/openclaw-personal-memory-hub.tgz','/openclaw-personal-memory-hub.sha256'])assert.equal((await call(path)).status,200);
});
test('cookie sessions enforce CSRF, tamper detection, logout and client scope',async()=>{
 const r=await call('/ui/session',{method:'POST',origin:base});assert.match(r.headers.get('set-cookie'),/HttpOnly; SameSite=Strict; Max-Age=1800/);if(base.startsWith('https:'))assert.match(r.headers.get('set-cookie'),/__Host-pmh_session=.*Secure/);
 const s={cookie:r.headers.get('set-cookie').split(';')[0],csrf:r.data.csrf};
 assert.equal((await call('/ui/session',s)).status,200);assert.equal((await call('/ui/api/dashboard',s)).status,200);
 assert.equal((await call('/ui/api/memories',{...s,csrf:undefined,method:'POST',origin:base,body:{}})).status,403);
 assert.equal((await call('/ui/api/memories',{...s,method:'POST',origin:'https://evil.invalid',body:{}})).status,403);
 assert.equal((await call('/ui/session',{cookie:s.cookie+'x'})).status,401);
 const readonly=await login('reader');assert.equal((await call('/ui/api/clients',readonly)).status,403);
 const out=await call('/ui/session',{...s,method:'DELETE',origin:base});assert.equal(out.status,200);assert.match(out.headers.get('set-cookie'),/Max-Age=0/);
 assert.equal((await call('/ui/session',s)).status,401);
});
test('session revocation is immediate and cookies cannot authenticate REST or MCP',async()=>{
 const c=await call('/v1/clients',{method:'POST',body:{name:sid,scopes:['memory:read'],expires_days:1}});managed.push(c.data.id);const s=await login('admin',c.data.token);
 assert.equal((await call('/v1/profile',s)).status,401);assert.equal((await call('/mcp',s)).status,401);
 await call('/v1/clients/'+c.data.id,{method:'DELETE',body:{authorized:true}});assert.equal((await call('/ui/api/dashboard',s)).status,401);
});
test('dashboard aggregates, paged conversations, dates, provenance and sensitive scope agree',async()=>{
 const body={authorized:true,source_platform:'dashboard-test',session_id:sid,title:'<script>private-title</script>',completeness:'partial',messages:[{id:'one',role:'user',timestamp:'2025-01-11T00:01:00+08:00',content:'私密界面测试原文',sensitivity:'sensitive'},{id:'two',role:'assistant',timestamp:'2025-01-12T00:01:00+08:00',content:'普通界面测试原文'}]};
 assert.equal((await call('/v1/conversations/import',{method:'POST',body})).status,201);
 const s=await login(),normal=await login('reader');
 const page=await call('/ui/api/records?source_platform=dashboard-test&session_id='+sid+'&limit=1&order=asc',s);assert.equal(page.data.records.length,1);assert.equal(page.data.records[0].source_record_id,'one');assert.equal(page.data.next_cursor,1);
 const second=await call('/ui/api/records?source_platform=dashboard-test&session_id='+sid+'&limit=1&order=asc&cursor=1',s);assert.equal(second.data.records[0].source_record_id,'two');assert.equal(second.data.next_cursor,null);
 const since=encodeURIComponent('2025-01-12T00:00:00+08:00');assert.equal((await call('/ui/api/records?source_platform=dashboard-test&session_id='+sid+'&since='+since,s)).data.records.length,1);
 const list=await call('/ui/api/conversations?source_platform=dashboard-test',s);assert.equal(list.data.conversations[0].title,'dashboard-test · '+sid);assert.equal(list.data.conversations[0].message_records,2);
 const hidden=await call('/ui/api/conversations?source_platform=dashboard-test',normal);assert.equal(hidden.data.conversations[0].message_records,1);assert.ok(!hidden.data.conversations[0].title.includes('private-title'));
 assert.equal((await call('/ui/api/records?source_platform=dashboard-test&session_id='+sid,normal)).data.records.length,1);
 const stats=await call('/ui/api/dashboard',s);assert.ok(stats.data.platforms.find(p=>p.source_platform==='dashboard-test').message_records>=2);
 assert.equal((await call('/ui/api/dashboard',normal)).data.scope_limited,true);
 if(!process.env.HUB_URL){const other=await login('outsider');assert.ok(!(await call('/ui/api/dashboard',other)).data.platforms.some(p=>p.source_platform==='dashboard-test'));assert.equal((await call('/ui/api/conversations?source_platform=dashboard-test',other)).data.conversations.length,0);}
});
test('a pending candidate already matching the current version closes without another revision',async()=>{
 const original={authorized:true,record_type:'memory',source_platform:'dashboard-test',session_id:sid,source_record_id:'same-content',source_kind:'test',timestamp,text:'初始内容'};
 await call('/v1/memories',{method:'POST',body:original});const next={...original,text:'候选内容'};
 const proposed=await call('/v1/memories',{method:'POST',body:next});assert.equal(proposed.status,409);const cid=proposed.data.details.conflict_id,id=proposed.data.details.id;
 assert.equal((await call('/v1/memories',{method:'POST',body:{...next,expected_version:1}})).data.version,2);
 const closed=await call('/v1/memories',{method:'POST',body:{...next,expected_version:2,conflict_id:cid}});assert.equal(closed.data.deduplicated,true);assert.equal(closed.data.version,2);
 assert.ok(!(await call('/v1/conflicts')).data.conflicts.some(c=>c.id===cid));assert.equal((await call('/v1/records/'+id+'/history')).data.versions.length,2);
});
test('message conflict adoption and rejection preserve history with version guards',async()=>{
 const original={authorized:true,source_platform:'dashboard-test',session_id:sid,title:'test',completeness:'partial',messages:[{id:'conflict',role:'user',timestamp,content:'旧的测试内容'}]};
 const a=await call('/v1/conversations/import',{method:'POST',body:original});const id=a.data.messages[0].id;
 const changed={...original,messages:[{...original.messages[0],content:'新的测试内容'}]};
 const b=await call('/v1/conversations/import',{method:'POST',body:changed});assert.equal(b.data.conflicts,1);const conflict=b.data.messages[0].details.conflict_id;
 const s=await login();const adopted=await call('/ui/api/conversations/import',{...s,method:'POST',origin:base,body:{...changed,messages:[{...changed.messages[0],expected_version:1,conflict_id:conflict}]}});assert.equal(adopted.data.conflicts,0);assert.equal(adopted.data.messages[0].version,2);
 assert.ok(!(await call('/v1/conflicts')).data.conflicts.some(c=>c.id===conflict));assert.equal((await call('/v1/records/'+id+'/history')).data.versions.length,2);
 const third=await call('/v1/conversations/import',{method:'POST',body:{...original,messages:[{...original.messages[0],content:'第三个候选'}]}});const cid=third.data.messages[0].details.conflict_id;
 assert.equal((await call('/ui/api/conflicts/'+cid+'/dismiss',{...s,method:'POST',origin:base,body:{authorized:true,expected_version:1}})).status,409);
 assert.equal((await call('/ui/api/conflicts/'+cid+'/dismiss',{...s,method:'POST',origin:base,body:{authorized:true,expected_version:2}})).status,200);
 assert.equal((await call('/v1/records/'+id)).data.payload.text,'新的测试内容');
});
test('account and knowledge collections preserve isolation, private search, citations and versions',async()=>{
 const account={authorized:true,record_type:'profile',logical_key:'accounts.test.'+sid,source_platform:'dashboard-test',session_id:sid,source_kind:'test',timestamp,title:'合成社交账号',text:'数字身份测试 '+sid,data:{category:'social_account',platform:'X',url:'https://example.invalid/profile',status:'active'},sensitivity:'sensitive'};
 const a=await call('/v1/memories',{method:'POST',body:account});assert.equal(a.status,201);assert.equal((await call('/v1/memories',{method:'POST',body:account})).data.deduplicated,true);
 const doc={...account,record_type:'memory',logical_key:'knowledge.test.'+sid+'.0',source_record_id:'document-0',title:'合成知识文本',text:'跨平台引用测试 '+sid,data:{category:'knowledge_document',document_id:sid,filename:'test.md',chunk_index:0,chunk_count:1,line_start:1,line_end:2}};
 const k=await call('/v1/memories',{method:'POST',body:doc});assert.equal(k.status,201);
 const filter='&source_platform=dashboard-test&session_id='+sid;
 const accounts=await call('/v1/records?collection=accounts'+filter);assert.deepEqual(accounts.data.records.map(r=>r.id),[a.data.id]);
 const docs=await call('/v1/records?collection=knowledge'+filter);assert.deepEqual(docs.data.records.map(r=>r.id),[k.data.id]);assert.equal(docs.data.records[0].citation.version,1);assert.equal(docs.data.records[0].citation.source_record_id,'document-0');
 assert.ok(!(await call('/v1/records?collection=memories'+filter)).data.records.some(r=>[a.data.id,k.data.id].includes(r.id)));
 assert.equal((await call('/v1/records?collection=knowledge'+filter,{client:'reader'})).data.records.length,0);
 const q=encodeURIComponent(sid),search=await call('/v1/search?collection=knowledge&query='+q);assert.ok(search.data.records.some(r=>r.id===k.data.id));assert.ok(!search.data.records.some(r=>r.id===a.data.id));assert.equal((await call('/v1/search?collection=accounts&query='+q,{client:'reader'})).data.records.length,0);
 if(!process.env.HUB_URL)assert.equal((await call('/v1/records?collection=accounts'+filter,{client:'outsider'})).data.records.length,0);
 const updated=await call('/v1/memories',{method:'POST',body:{...account,text:'更新后的数字身份 '+sid,expected_version:1}});assert.equal(updated.data.version,2);assert.equal((await call('/v1/records/'+a.data.id+'/history')).data.versions.length,2);
 assert.equal((await call('/v1/records?collection=unknown')).status,400);
});
