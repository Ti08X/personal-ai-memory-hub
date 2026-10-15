import test from 'node:test';
import assert from 'node:assert/strict';
import {rig,Store} from './support/local-store.mjs';

function modelMock(calls,override){
 return async(_url,options)=>{
  const body=JSON.parse(options.body),input=JSON.parse(body.messages[1].content);calls.push(input);
  let content;
  if(input.evidence){content={entries:input.evidence.map(e=>({id:e.id,categories:[e.text.includes('个人')?'personal':'development'],facts:[{section:e.text.includes('个人')?'personal':'projects',text:e.text,status:e.text.includes('个人')?'confirmed':'in_progress',project:e.text.includes('个人')?'':'合成项目'}]}))};}
  else{content=structuredClone(input.previous);const refs=input.entries.map(e=>e.id);for(const e of input.entries)for(const f of e.facts){if(f.section==='personal')content.personal.push({text:f.text,status:f.status,project:'',evidence_ids:[e.id]});else{content.projects.push({name:f.project,goal:'测试目标',status:f.status,current_step:f.text,next_step:'根据已有证据继续测试',blockers:'',evidence_ids:[e.id]});content.mainline.push({text:'测试主线',status:'in_progress',project:f.project,evidence_ids:[e.id]});content.next_actions.push({text:'继续验证',status:'planned',project:f.project,evidence_ids:[e.id]});}}content.brief=content.personal.length||content.projects.length?'有原文依据的合成个人与项目交接。':'';assert.ok(refs.length);}
  if(override)content=await override(input,content);
  return Response.json({choices:[{message:{content:JSON.stringify(content)}}]});
 };
}
async function withRig(fn){const r=rig(),old=globalThis.fetch;r.overviewCalls=[];globalThis.fetch=modelMock(r.overviewCalls);try{await fn(r);}finally{globalThis.fetch=old;r.close();}}
const enable=r=>r.store.refreshOverview({authorized:true,enabled:true,expected_version:0});

test('classifies original sources, produces detailed handoff with citations, and does not repeat unchanged model work',()=>withRig(async r=>{
 const personal=await r.store.save({...r.base,source_record_id:'personal',source_kind:'direct_user',text:'个人偏好：清晰中文说明。',timestamp:'2026-01-01T00:00:00Z'});
 const project=await r.store.save({...r.base,record_type:'project',source_record_id:'project',text:'合成开发项目已完成基础接口，接下来测试检索。',sensitivity:'sensitive'});
 assert.equal((await r.store.overview()).counts.unclassified,2);await enable(r);
 assert.equal((await r.store.processOverview()).merged,2);
 const overview=await r.store.overview({detail:'full'});assert.equal(overview.status,'ready');assert.equal(overview.coverage.included_sources,2);assert.equal(overview.overview.personal.length,1);assert.equal(overview.overview.projects.length,1);
 assert.deepEqual(overview.overview.personal[0].evidence_ids,[personal.id]);assert.deepEqual(overview.overview.projects[0].evidence_ids,[project.id]);
 const dashboard=await r.store.dashboard();assert.equal(dashboard.additions.today,2);assert.equal(dashboard.classification.personal,1);assert.equal(dashboard.classification.development,1);
 assert.equal((await r.store.listRecords({category:'development'})).records[0].id,project.id);
 assert.equal((await r.store.search({query:'中文',category:'personal'})).records[0].id,personal.id);
 assert.equal((await r.store.search({query:'中文',category:'development'})).records.length,0);
 assert.equal((await r.store.get(personal.id)).version,1);
 assert.equal((await r.store.handoff()).overview.overview.detail_available,true);
 assert.equal((await r.store.overview({detail:'full',section:'projects'})).overview.items[0].name,'合成项目');
 const count=r.overviewCalls.length;assert.equal((await r.store.processOverview()).status,'idle');assert.equal(r.overviewCalls.length,count);
 assert.equal((await r.store.overviewHistory()).versions.length,1);
 const ciphertext=r.env.DB.sqlite.prepare('SELECT payload_cipher FROM memory_classifications').get().payload_cipher;assert.ok(!ciphertext.includes('中文'));
}));

test('overview, classification counts and search preserve sensitivity, collections and owner isolation',()=>withRig(async r=>{
 const normal=await r.store.save({...r.base,source_record_id:'normal',text:'个人普通信息。'});
 const secret=await r.store.save({...r.base,source_record_id:'secret',text:'开发项目私密信息。',sensitivity:'restricted'});await enable(r);await r.store.processOverview();
 const low=r.as({read_level:1,write_level:1,collections:['memories']});const data=await low.overview({detail:'full'});
 assert.equal(data.counts.total_sources,1);assert.equal(data.counts.personal,1);assert.equal(data.counts.development,0);assert.equal(data.overview,null);assert.equal(data.status,'stale_or_scope_restricted');
 assert.deepEqual((await low.listRecords({category:'personal'})).records.map(x=>x.id),[normal.id]);assert.equal((await low.search({query:'私密',category:'development'})).records.length,0);
 await assert.rejects(low.classifyMemory({authorized:true,id:secret.id,version:1,expected_revision:1,categories:['personal']}));
 const other=new Store(r.env,{...r.full,owner_id:'other-owner',id:'other-client'});assert.equal((await other.overview()).counts.total_sources,0);assert.equal((await other.overview()).overview,null);
}));

test('source edits invalidate the overview and rebuild from current evidence without reclassifying unchanged records',()=>withRig(async r=>{
 const a=await r.store.save({...r.base,source_record_id:'a',text:'个人偏好旧版。'});await r.store.save({...r.base,source_record_id:'b',text:'合成开发项目进度。'});await enable(r);await r.store.processOverview();
 await r.store.save({...r.base,source_record_id:'a',expected_version:1,text:'个人偏好更新为新版本。'});
 assert.equal((await r.store.overview()).status,'stale_or_scope_restricted');assert.equal((await r.store.overview()).overview,null);
 const result=await r.store.processOverview();assert.equal(result.classified,1);assert.equal(result.merged,2);
 const data=await r.store.overview({detail:'full'});assert.ok(data.overview.personal[0].text.includes('新版本'));assert.equal(data.version,2);assert.equal((await r.store.get(a.id)).classification.revision,2);
 assert.equal(r.overviewCalls.filter(c=>c.evidence).at(-1).evidence.length,1);
 assert.equal((await r.store.overviewHistory()).versions.length,2);
 const historical=await r.store.overviewHistory({version:1});assert.equal(historical.historical,true);assert.ok(historical.overview.personal[0].text.includes('旧版'));assert.equal(historical.evidence_index[a.id].version,1);
}));

test('manual topic changes use revision guards, preserve raw records and refresh the overview',()=>withRig(async r=>{
 const a=await r.store.save({...r.base,source_record_id:'a',text:'开发技术与个人生活的合成材料。'});await enable(r);await r.store.processOverview();
 await r.store.classifyMemory({authorized:true,id:a.id,version:1,expected_revision:1,categories:['personal','development']});
 await assert.rejects(r.store.classifyMemory({authorized:true,id:a.id,version:1,expected_revision:1,categories:['other']}),e=>e.code==='classification_conflict');
 assert.equal((await r.store.get(a.id)).version,1);assert.equal((await r.store.overview()).overview,null);
 const result=await r.store.processOverview();assert.equal(result.classified,0);assert.equal(result.merged,1);
 assert.equal((await r.store.dashboard()).classification.development,1);
 assert.deepEqual(r.overviewCalls.at(-1).entries[0].categories,['personal','development']);
}));

test('invalid summary references are rejected; successful extraction is retained for retry rather than repeated',()=>withRig(async r=>{
 await r.store.save({...r.base,source_record_id:'a',text:'个人明确陈述。'});await enable(r);
 globalThis.fetch=modelMock(r.overviewCalls,(input,content)=>{if(!input.evidence)content.personal[0].evidence_ids=['not-an-input-source'];return content;});
 await assert.rejects(r.store.processOverview(),e=>e.code==='summary_evidence_invalid');
 assert.equal((await r.store.overview()).overview,null);assert.equal((await r.store.overview()).counts.digested,1);assert.equal((await r.store.overview()).organization_error,'summary_evidence_invalid');
 globalThis.fetch=modelMock(r.overviewCalls);const retry=await r.store.processOverview();assert.equal(retry.classified,0);assert.equal(retry.merged,1);assert.equal(r.overviewCalls.filter(c=>c.evidence).length,1);
}));

test('pipeline leases prevent duplicate processing and pausing prevents model calls',()=>withRig(async r=>{
 await r.store.save({...r.base,source_record_id:'a',text:'个人合成信息。'});await enable(r);
 r.env.DB.sqlite.prepare('UPDATE memory_overview_state SET lease_until=?').run(new Date(Date.now()+60000).toISOString());assert.equal((await r.store.processOverview()).status,'busy');assert.equal(r.overviewCalls.length,0);
 await r.store.refreshOverview({authorized:true,enabled:false,expected_version:1});await assert.rejects(r.store.processOverview(),e=>e.code==='overview_organization_disabled');assert.equal(r.overviewCalls.length,0);
}));

test('assistant discussion may be a personal topic but cannot create a personal fact',()=>withRig(async r=>{
 await r.store.importConversation({authorized:true,source_platform:'synthetic',session_id:'s',completeness:'partial',messages:[{id:'a',role:'assistant',timestamp:new Date().toISOString(),content:'个人经历可能是在某个城市上学。'}]});await enable(r);await r.store.processOverview();
 const o=await r.store.overview({detail:'full'});assert.equal(o.counts.personal,1);assert.equal(o.overview.personal.length,0);assert.equal(o.overview.brief,'');
}));

test('requeue legacy quota failures only touches authorized current sources and preserves real failures',()=>withRig(async r=>{
 const visible=await r.store.save({...r.base,source_record_id:'visible',text:'可见开发资料。'}),privateRecord=await r.store.save({...r.base,source_record_id:'private',text:'私密资料。',sensitivity:'restricted'});
 r.env.DB.sqlite.prepare("UPDATE rag_jobs SET status='failed',error_code='model_daily_limit'").run();
 const limited=r.as({read_level:1,write_level:1,collections:['memories']},['memory:read','admin']);assert.equal((await limited.retryIndexFailures({authorized:true,reason:'legacy_quota'})).requeued,1);
 assert.equal(r.env.DB.sqlite.prepare('SELECT status FROM rag_jobs WHERE record_id=?').get(privateRecord.id).status,'failed');assert.equal((await r.store.get(visible.id)).version,1);
 r.env.DB.sqlite.prepare("UPDATE rag_jobs SET error_code='model_provider_rate_limit' WHERE record_id=?").run(privateRecord.id);assert.equal((await r.store.retryIndexFailures({authorized:true,reason:'legacy_quota'})).requeued,0);assert.equal((await r.store.retryIndexFailures({authorized:true,reason:'all'})).requeued,1);
}));

test('evidence changed during model processing cannot publish a stale summary',()=>withRig(async r=>{
 await r.store.save({...r.base,source_record_id:'a',text:'个人旧资料。'});await enable(r);
 globalThis.fetch=modelMock(r.overviewCalls,async(input,content)=>{if(!input.evidence)await r.store.save({...r.base,source_record_id:'a',expected_version:1,text:'个人资料并发更新。'});return content;});
 await assert.rejects(r.store.processOverview(),e=>e.code==='evidence_version_changed');assert.equal((await r.store.overview()).overview,null);assert.equal((await r.store.overviewHistory()).versions.length,0);
}));

test('derived summaries are not double-counted as unclassified raw sources or sent back through extraction',()=>withRig(async r=>{
 const source=await r.store.save({...r.base,source_record_id:'raw',text:'个人原始陈述。'});
 const derived=await r.store.save({...r.base,record_type:'summary',logical_key:'test.derived',source_kind:'assistant_summary',text:'个人派生概要。',evidence:[{id:source.id,version:1}]});
 assert.equal((await r.store.dashboard()).totals.records,2);assert.equal((await r.store.overview()).counts.total_sources,1);
 assert.deepEqual((await r.store.listRecords({category:'unclassified'})).records.map(x=>x.id),[source.id]);
 await assert.rejects(r.store.classifyMemory({authorized:true,id:derived.id,version:1,expected_revision:0,categories:['personal']}),e=>e.code==='classification_derived_record');
 await enable(r);await r.store.processOverview();assert.equal((await r.store.overview()).status,'ready');assert.equal((await r.store.listRecords({category:'unclassified'})).records.length,0);
 assert.equal((await r.store.handoff()).context.records.length,0);assert.equal(r.overviewCalls[0].evidence.length,1);
 assert.deepEqual((await r.store.overview({detail:'full'})).evidence_index[source.id],{id:source.id,version:1});
}));

test('evidence-based project updates are eligible inputs and deleted evidence hides old overview snapshots',()=>withRig(async r=>{
 const source=await r.store.save({...r.base,source_record_id:'raw',text:'合成开发原文。'});
 await r.store.save({...r.base,record_type:'project',logical_key:'test.project',source_kind:'assistant_summary',text:'开发项目目前进入检索验收阶段。',evidence:[{id:source.id,version:1}]});
 assert.equal((await r.store.overview()).counts.total_sources,2);await enable(r);await r.store.processOverview();assert.equal((await r.store.overview()).coverage.included_sources,2);
 r.env.DB.sqlite.prepare('DELETE FROM records WHERE id=?').run(source.id);
 assert.equal((await r.store.overview()).overview,null);
 await assert.rejects(r.store.overviewHistory({version:1}),e=>e.code==='overview_history_source_unavailable');
}));

test('overview accepts a complete JSON code block and text content parts without accepting prose or truncated output',()=>withRig(async r=>{
 await r.store.save({...r.base,source_record_id:'json-format',text:'个人说明。'});await enable(r);
 const mock=modelMock(r.overviewCalls);globalThis.fetch=async(...args)=>{const value=await (await mock(...args)).json();value.choices[0].message.content='```json\n'+value.choices[0].message.content+'\n```';return Response.json(value);};
 await r.store.processOverview();assert.equal((await r.store.overview()).status,'ready');
 await r.store.save({...r.base,source_record_id:'json-format',expected_version:1,text:'个人说明更新。'});
 globalThis.fetch=async(...args)=>{const value=await (await mock(...args)).json();value.choices[0].finish_reason='length';return Response.json(value);};
 await assert.rejects(r.store.processOverview(),e=>e.code==='summary_response_truncated');
 globalThis.fetch=async(...args)=>{const value=await (await mock(...args)).json();value.choices[0].message.content='extra explanation '+value.choices[0].message.content;return Response.json(value);};
 await assert.rejects(r.store.processOverview(),e=>e.code==='summary_json_invalid');
 globalThis.fetch=async(...args)=>{const value=await (await mock(...args)).json();value.choices[0].message.content=[{type:'text',text:value.choices[0].message.content}];return Response.json(value);};await r.store.processOverview();assert.equal((await r.store.overview()).status,'ready');
}));
