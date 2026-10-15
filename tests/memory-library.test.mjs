import test from 'node:test';
import assert from 'node:assert/strict';
import {rig,Store,MemoryLibrary,calendarKeys,libraryPrincipal} from './support/local-store.mjs';
function mock(calls,override){return async(_url,options)=>{const input=JSON.parse(JSON.parse(options.body).messages[1].content);calls.push(input);let output;
 if(input.evidence)output={entries:input.evidence.map(e=>({id:e.id,categories:e.text.includes('个人')?['personal','learning']:['development'],tags:['合成标签'],facts:[{section:e.text.includes('个人')?'personal':'projects',text:e.text,status:'confirmed',project:e.text.includes('个人')?'':'合成项目'}]}))};
 else{output=structuredClone(input.previous);for(const e of input.entries)for(const f of e.facts)if(f.section==='personal')output.personal.push({text:f.text,status:f.status,project:'',evidence_ids:[e.id]});else {output.projects.push({name:f.project,goal:'合成目标',status:'in_progress',current_step:f.text,next_step:'验收测试',blockers:'',evidence_ids:[e.id]});output.mainline.push({text:'继续项目',status:'in_progress',project:f.project,evidence_ids:[e.id]});output.next_actions.push({text:'验收测试',status:'planned',project:f.project,evidence_ids:[e.id]});}output.brief=output.personal.length||output.projects.length?'合成概要，有原文出处。':'';}
 if(override)output=await override(input,output);return Response.json({choices:[{message:{content:JSON.stringify(output)}}]});};}
async function setup(fn){const r=rig(),before=globalThis.fetch;r.calls=[];r.env.DB.sqlite.prepare('INSERT INTO clients(id,owner_id,name,token_hash,scopes,created_at,expires_at,policy_json) VALUES(?,?,?,?,?,?,?,?)').run(r.full.id,r.full.owner_id,'synthetic', 'synthetic-not-a-token',JSON.stringify(r.full.scopes),new Date().toISOString(),'2999-01-01T00:00:00Z',JSON.stringify(r.full.policy));r.library=new MemoryLibrary(r.store);globalThis.fetch=mock(r.calls);try{await fn(r);}finally{globalThis.fetch=before;r.close();}}
const enable=r=>r.library.configure({authorized:true,enabled:true,expected_revision:0});
async function drain(r){for(let i=0;i<40;i++){const res=await r.library.process();if(res.extraction.status==='idle'&&res.summaries.status==='idle')return;}throw new Error('Synthetic library failed to finish');}
test('Shanghai day, Monday week and month indexes respect midnight and year boundaries',()=>{assert.deepEqual(calendarKeys('2026-10-14T16:00:00Z'),{day:'2026-10-15',week:'2026-10-12',month:'2026-10'});assert.deepEqual(calendarKeys('2026-12-31T16:00:00Z'),{day:'2027-01-01',week:'2026-12-28',month:'2027-01'});});
test('summary visibility checks seek labels by owner and record; scheduler seeks active jobs by status',()=>{
 const r=rig();try{const library=new MemoryLibrary(r.store),sql='EXPLAIN QUERY PLAN SELECT s.id FROM library_scopes s WHERE s.owner_id=? AND '+library.scopeFilter(),plan=r.env.DB.sqlite.prepare(sql).all(r.full.owner_id).map(x=>x.detail);
  assert.ok(plan.some(x=>x.includes('SEARCH ll')&&x.includes('owner_id=? AND record_id=?')),plan.join('\n'));assert.ok(!plan.some(x=>x.includes('SCAN ll')));
  const jobs=r.env.DB.sqlite.prepare("EXPLAIN QUERY PLAN SELECT DISTINCT owner_id FROM rag_jobs WHERE status IN ('pending','failed','processing') LIMIT 10").all().map(x=>x.detail);assert.ok(jobs.some(x=>x.includes('rag_jobs_status_owner')&&x.includes('status=?')),jobs.join('\n'));
 }finally{r.close();}
});
test('multi-category encrypted tags, scope summaries, indexed handoff and unchanged work reuse',()=>setup(async r=>{
 const a=await r.store.save({...r.base,source_record_id:'person',text:'个人学习偏好：清晰中文。',timestamp:'2026-10-14T16:10:00Z'});await r.store.save({...r.base,record_type:'project',source_record_id:'project',text:'合成开发项目正在验收。',timestamp:'2026-10-14T16:12:00Z'});await enable(r);await drain(r);
 const labels=await r.library.labels(a.id);assert.deepEqual(labels.categories,['personal','learning']);assert.deepEqual(labels.labels.tags,['合成标签']);
 assert.equal((await r.library.find({kind:'tag',name:'合成标签'})).records.length,2);
 assert.equal((await r.library.list({kind:'day'})).summaries[0].key,'2026-10-15');
 const project=(await r.library.list({kind:'project'})).summaries[0],summary=await r.library.read(project.id);assert.equal(summary.status,'ready');assert.equal(summary.overview.projects.length,1);assert.ok(Object.keys(summary.evidence_index).length);
 assert.ok((await r.store.handoff()).library.summaries.length);assert.equal((await r.store.overview({detail:'full'})).overview.personal[0].text,'个人学习偏好：清晰中文。');
 const n=r.calls.length;await r.library.process();assert.equal(r.calls.length,n);assert.equal((await r.library.status()).counts.organized,2);
 const all=r.env.DB.sqlite.prepare('SELECT * FROM library_label_keys').all();assert.ok(!JSON.stringify(all).includes('合成标签'));assert.ok(!r.env.DB.sqlite.prepare('SELECT payload_cipher FROM library_labels').get().payload_cipher.includes('合成标签'));
}));
test('append increments only affected scopes; edits and deletion suppress stale summaries',()=>setup(async r=>{
 const first={...r.base,source_record_id:'one',text:'个人偏好旧版。',timestamp:'2026-10-01T00:00:00Z'};const a=await r.store.save(first);await enable(r);await drain(r);const day=(await r.library.list({kind:'day'})).summaries[0];const before=r.calls.length;
 await r.store.save({...r.base,source_record_id:'two',text:'个人偏好新补充。',timestamp:'2026-10-01T01:00:00Z'});await drain(r);assert.equal(r.calls.slice(before).filter(c=>c.evidence).length,1);assert.ok(r.calls.slice(before).filter(c=>c.entries).every(c=>c.entries.length===1));
 await r.store.save({...first,text:'个人偏好修订版。',expected_version:1});await assert.rejects(r.library.read(day.id),e=>e.code==='summary_not_found');await drain(r);const newSummary=await r.library.read(day.id);assert.ok(!JSON.stringify(newSummary.overview).includes('旧版'));assert.equal(newSummary.evidence_index[a.id].version,2);
 r.env.DB.sqlite.prepare('DELETE FROM records WHERE id=?').run(a.id);const hidden=await r.library.read(day.id);assert.equal(hidden.overview,null);assert.equal(hidden.status,'pending');await drain(r);assert.ok(!JSON.stringify((await r.library.read(day.id)).overview).includes('修订版'));
}));
test('manual taxonomy preserves text, CAS and correction across extraction; hashed tag lookup is case normalized',()=>setup(async r=>{
 const a=await r.store.save({...r.base,source_record_id:'manual',text:'合成开发与学习资料。'});
 const changed=await r.library.taxonomy({authorized:true,id:a.id,version:1,expected_revision:0,expected_classification_revision:0,categories:['learning','development'],tags:['Example Tag'],projects:['自定项目']});assert.equal(changed.revision,1);
 await assert.rejects(r.library.taxonomy({authorized:true,id:a.id,version:1,expected_revision:0,expected_classification_revision:0,categories:['other'],tags:[],projects:[]}),e=>e.code==='classification_conflict');await enable(r);await drain(r);
 assert.deepEqual((await r.library.labels(a.id)).labels,{tags:['Example Tag'],projects:['自定项目']});assert.deepEqual((await r.library.labels(a.id)).categories,['learning','development']);assert.equal((await r.store.get(a.id)).version,1);assert.equal((await r.library.find({kind:'tag',name:'example tag'})).records[0].id,a.id);
}));
test('derived summaries, labels, counts and receipts obey sensitivity, collections and owner isolation',()=>setup(async r=>{
 const a=await r.store.save({...r.base,source_record_id:'normal',text:'合成开发公开进度。'});await r.store.save({...r.base,source_record_id:'secret',text:'合成开发高敏感进度。',sensitivity:'restricted'});await enable(r);await drain(r);
 const low=new MemoryLibrary(r.as({read_level:1,write_level:1,collections:['memories']}));assert.equal((await low.status()).counts.total,1);assert.equal((await low.list({kind:'project'})).summaries.length,0);assert.equal((await low.insights()).imports.length,0);assert.equal((await low.find({kind:'tag',name:'合成标签'})).records.length,1);
 const id=(await r.library.list({kind:'project'})).summaries[0].id;await assert.rejects(low.read(id),e=>e.code==='summary_not_found');const other=new MemoryLibrary(new Store(r.env,{...r.full,owner_id:'another'}));assert.equal((await other.status()).counts.total,0);assert.equal((await other.list()).summaries.length,0);assert.equal((await other.find({kind:'tag',name:'合成标签'})).records.length,0);
 await assert.rejects(low.configure({authorized:true,enabled:true,expected_revision:0}));assert.equal((await r.store.get(a.id)).payload.text,'合成开发公开进度。');
}));
test('failed model work keeps source and progress, retry resumes, pause and revocation block commits',()=>setup(async r=>{
 await r.store.save({...r.base,source_record_id:'fail',text:'个人合成信息。'});await enable(r);globalThis.fetch=async()=>Response.json({error:'synthetic'},{status:503});const failed=await r.library.extract();assert.equal(failed.failed,1);assert.equal((await r.library.status()).failures.length,1);assert.equal((await r.library.extract()).status,'idle');
 await r.library.retry({authorized:true});globalThis.fetch=mock(r.calls);await drain(r);assert.equal((await r.library.status()).failures.length,0);
 await r.library.configure({authorized:true,enabled:false,expected_revision:1});const n=r.calls.length;await assert.rejects(r.library.process(),e=>e.code==='library_disabled');assert.equal(r.calls.length,n);
 await r.library.configure({authorized:true,enabled:true,expected_revision:2});await r.store.save({...r.base,source_record_id:'later',text:'个人新资料。'});globalThis.fetch=mock(r.calls,async(input,result)=>{if(input.evidence)r.env.DB.sqlite.prepare('UPDATE clients SET revoked_at=? WHERE id=?').run(new Date().toISOString(),r.full.id);return result;});assert.equal((await r.library.extract()).failed,1);assert.equal((await r.library.status()).counts.organized,1);await assert.rejects(libraryPrincipal(r.env,r.full.owner_id,r.full.id),e=>e.code==='library_authorization_expired');
}));
test('import receipts separate saved, duplicates and conflicts without storing plaintext',()=>setup(async r=>{
 const input={authorized:true,source_platform:'synthetic-openclaw',session_id:'session-test',completeness:'full',messages:[{id:'m1',role:'user',timestamp:'2026-10-01T00:00:00Z',content:'合成聊天内容。'}]};await r.store.importConversation(input);await r.store.importConversation(input);await r.store.importConversation({...input,messages:[{...input.messages[0],content:'不同的合成版本。'}]});
 const receipts=(await r.library.insights()).imports;assert.equal(receipts.length,3);assert.equal(receipts.reduce((n,r)=>n+r.saved,0),1);assert.equal(receipts.reduce((n,r)=>n+r.duplicates,0),1);assert.equal(receipts.reduce((n,r)=>n+r.conflicts,0),1);assert.ok(!JSON.stringify(receipts).includes('合成聊天内容'));
}));
test('source mutation or owner pause during model processing cannot publish a stale summary',()=>setup(async r=>{
 const input={...r.base,source_record_id:'race',text:'个人合成旧内容。'};const a=await r.store.save(input);await enable(r);await r.library.extract();
 let changed=false;globalThis.fetch=mock(r.calls,async(input,result)=>{if(input.entries&&!changed){changed=true;await r.store.save({...r.base,source_record_id:'race',expected_version:1,text:'个人合成新内容。'});}return result;});
 assert.equal((await r.library.summarize()).status,'failed');assert.ok((await r.library.list()).summaries.every(s=>s.status!=='ready'));globalThis.fetch=mock(r.calls);await drain(r);
 const month=(await r.library.list({kind:'month'})).summaries[0];assert.ok(JSON.stringify((await r.library.read(month.id)).overview).includes('新内容'));
 await r.store.save({...r.base,source_record_id:'race',expected_version:2,text:'个人合成第三版。'});globalThis.fetch=mock(r.calls,async(input,result)=>{if(input.evidence)await r.library.configure({authorized:true,enabled:false,expected_revision:1});return result;});
 assert.equal((await r.library.extract()).failed,1);assert.equal((await r.store.get(a.id)).classification?.source_version!==3,true);assert.ok((await r.library.list()).summaries.every(s=>s.status!=='ready'));
}));
test('invalid scope citations fail without discarding successful extraction, and retry reuses it',()=>setup(async r=>{
 await r.store.save({...r.base,source_record_id:'citation',text:'个人合成明确陈述。'});await enable(r);await r.library.extract();
 globalThis.fetch=mock(r.calls,(input,result)=>{if(input.entries)result.personal[0].evidence_ids=['foreign-source'];return result;});const failed=await r.library.summarize();assert.equal(failed.error_code,'summary_evidence_invalid');assert.equal((await r.library.status()).counts.organized,1);
 const extracted=r.calls.filter(c=>c.evidence).length;await r.library.retry({authorized:true});globalThis.fetch=mock(r.calls);await drain(r);assert.equal(r.calls.filter(c=>c.evidence).length,extracted);assert.ok((await r.library.list()).summaries.every(s=>s.status==='ready'));
}));

test('legacy digests without tags are upgraded once and do not silently bypass new taxonomy extraction',()=>setup(async r=>{
 const a=await r.store.save({...r.base,source_record_id:'legacy',text:'个人合成学习偏好。'}),digest={id:a.id,categories:['personal'],facts:[{section:'personal',text:'个人合成学习偏好。',status:'confirmed',project:''}]};
 const cipher=await r.store.vault.seal(digest,r.full.owner_id+':digest:'+a.id+':1');r.env.DB.sqlite.prepare('INSERT INTO memory_classifications VALUES(?,?,?,1,?,?,?,?)').run(r.full.owner_id,a.id,1,JSON.stringify(['personal']),cipher,'model',new Date().toISOString());
 await enable(r);await drain(r);assert.deepEqual((await r.library.labels(a.id)).labels.tags,['合成标签']);assert.equal(r.calls.filter(c=>c.evidence).length,1);const count=r.calls.length;await r.library.process();assert.equal(r.calls.length,count);assert.equal((await r.store.get(a.id)).version,1);
}));

test('archive cards read existing conversation summaries, distinguish partial coverage, and respect message date filters',()=>setup(async r=>{
 const input={authorized:true,source_platform:'synthetic-chat',session_id:'archive-session',title:'合成会话',completeness:'partial',messages:[
  {id:'before',role:'user',timestamp:'2026-10-14T15:59:59.999Z',content:'个人合成学习情况。',sensitivity:'normal'},
  {id:'after',role:'assistant',timestamp:'2026-10-14T16:00:00.000Z',content:'合成开发建议。',sensitivity:'normal'}]};
 await r.store.importConversation(input);
 assert.equal((await r.store.listConversations({include_summary:'true'})).conversations[0].summary.status,'pending');
 assert.equal((await r.store.listConversations({})).conversations[0].summary,undefined);
 await enable(r);await drain(r);const calls=r.calls.length;
 const page=await r.store.listConversations({include_summary:'true',source_platform:'synthetic-chat',since:'2026-10-15T00:00:00+08:00',until:'2026-10-15T23:59:59.999+08:00'}),c=page.conversations[0];
 assert.equal(c.message_records,1);assert.equal(c.conversation_message_records,2);assert.equal(c.summary.total,2);assert.equal(c.summary.covered,2);assert.equal(c.summary.status,'ready');assert.ok(c.summary.brief);assert.equal(r.calls.length,calls);
 const messages=await r.store.listRecords({record_type:'message',source_platform:'synthetic-chat',session_id:'archive-session',since:'2026-10-15T00:00:00+08:00',until:'2026-10-15T23:59:59.999+08:00'});assert.equal(messages.records.length,1);assert.equal(messages.records[0].source_record_id,'after');
 await r.store.importConversation({...input,messages:[{id:'new',role:'user',timestamp:'2026-10-15T03:00:00Z',content:'个人新补充。',sensitivity:'normal'}]});
 const partial=(await r.store.listConversations({include_summary:'true'})).conversations[0].summary;assert.equal(partial.status,'partial');assert.equal(partial.covered,2);assert.equal(partial.total,3);assert.ok(partial.brief);
 await r.library.extract();const waiting=(await r.store.listConversations({include_summary:'true'})).conversations[0].summary;assert.equal(waiting.status,'pending');assert.equal(waiting.brief,null);await drain(r);
 const final=(await r.store.listConversations({include_summary:'true'})).conversations[0].summary;assert.equal(final.status,'ready');assert.equal(final.covered,3);
}));

test('conversation briefs cannot expose hidden members or edited evidence through archive cards',()=>setup(async r=>{
 const input={authorized:true,source_platform:'synthetic-chat',session_id:'private-session',title:'合成混合等级会话',completeness:'partial',messages:[{id:'public',role:'user',timestamp:'2026-10-01T00:00:00Z',content:'个人普通合成内容。',sensitivity:'normal'},{id:'private',role:'user',timestamp:'2026-10-01T01:00:00Z',content:'个人高敏感合成内容。',sensitivity:'restricted'}]};
 await r.store.importConversation(input);await enable(r);await drain(r);
 const low=r.as({read_level:1,write_level:0,collections:['chats']});const visible=(await low.listConversations({include_summary:'true'})).conversations[0];assert.equal(visible.message_records,1);assert.equal(visible.summary.brief,null);
 await r.store.importConversation({...input,messages:[{...input.messages[0],content:'个人普通合成内容修订。',expected_version:1}]});
 const edited=(await r.store.listConversations({include_summary:'true'})).conversations[0].summary;assert.equal(edited.brief,null);assert.equal(edited.status,'pending');
}));
