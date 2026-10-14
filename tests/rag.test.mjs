import test from 'node:test';
import assert from 'node:assert/strict';
import {rig,Models,chunks,ModelSettings,runtimeModels} from './support/local-store.mjs';
const policy=(n,collections=['memories','chats','knowledge','accounts','projects'])=>({read_level:n,write_level:n,collections});
async function withRig(fn){const r=rig(),old=globalThis.fetch;globalThis.fetch=r.mockFetch;try{await fn(r);}finally{globalThis.fetch=old;r.close();}}
test('four sensitivity levels and collections filter every read path, including metadata and raw batches',()=>withRig(async r=>{
 const ids=[];for(const [i,sensitivity] of ['public','normal','sensitive','restricted'].entries())ids.push((await r.store.save({...r.base,source_record_id:'level-'+i,text:'统一检索标记 '+i,sensitivity})).id);
 for(let n=0;n<4;n++){const s=r.as(policy(n),['memory:read','sensitive:read']);assert.equal((await s.listRecords({})).records.length,n+1);assert.equal((await s.profile()).records.length,0);assert.equal((await s.search({query:'统一检索标记'})).records.length,n+1);assert.equal((await s.exportPage('',50)).records.length,n+1);assert.equal((await s.dashboard()).totals.records,n+1);assert.equal((await s.context({})).records.length,n+1);if(n<3)await assert.rejects(()=>s.get(ids[3]),e=>e.status===404);}
 const restricted=r.as(policy(3,['knowledge']),['memory:read','sensitive:read']);assert.equal((await restricted.listRecords({})).records.length,0);assert.equal((await restricted.dashboard()).totals.records,0);await assert.rejects(()=>restricted.history(ids[0]),e=>e.status===404);
 await r.store.importConversation({authorized:true,source_platform:'test-platform',session_id:'raw-session',title:'私密标题',completeness:'partial',messages:[{id:'secret',role:'user',timestamp:r.base.timestamp,content:'私密聊天',sensitivity:'restricted'}]});await assert.rejects(()=>r.as(policy(2),['memory:read','sensitive:read']).archiveConversation('test-platform','raw-session'),e=>e.status===403);assert.equal((await r.as(policy(1)).listConversations({})).conversations.length,0);
}));
test('write ceilings, evidence sensitivity inheritance, and no AI downgrading',()=>withRig(async r=>{
 const source=await r.store.save({...r.base,source_record_id:'private-evidence',sensitivity:'sensitive'}),reader=r.as(policy(2),['memory:read','memory:write','sensitive:read','sensitive:write']);
 const summary=await reader.save({...r.base,record_type:'summary',logical_key:'handoff.test',sensitivity:'normal',evidence:[{id:source.id,version:1}]});assert.equal((await r.store.get(summary.id)).sensitivity,'sensitive');assert.equal((await r.as(policy(1)).listRecords({record_type:'summary'})).records.length,0);
 await assert.rejects(()=>reader.save({...r.base,source_record_id:'private-evidence',sensitivity:'normal',expected_version:1}),e=>e.status===403);
 const low=r.as({read_level:2,write_level:1,collections:['memories']},['memory:read','memory:write','sensitive:read']);await assert.rejects(()=>low.save({...r.base,sensitivity:'normal',record_type:'summary',evidence:[{id:source.id,version:1}]}),e=>e.status===403);
 await r.store.save({...r.base,source_record_id:'private-evidence',sensitivity:'sensitive',text:'已变化证据',expected_version:1});await assert.rejects(()=>r.store.get(summary.id),e=>e.status===404);assert.equal((await r.store.handoff()).summaries.length,0);
}));
test('RAG indexes sensitive text idempotently, rechecks stale/deleted/foreign hits before rerank',()=>withRig(async r=>{
 const a=await r.store.save({...r.base,source_record_id:'semantic-a',sensitivity:'sensitive'}),b=await r.store.save({...r.base,source_record_id:'semantic-b',sensitivity:'normal'});
 const indexed=await r.store.indexPending(3);assert.equal(indexed.results.length,2);assert.ok(indexed.results.every(x=>x.status==='submitted'));assert.equal((await r.store.ragStatus()).counts.find(c=>c.status==='indexed').count,2);assert.equal((await r.store.indexPending(3)).results.length,0);
 const low=r.as(policy(1));const found=await low.search({query:'换AI接手',mode:'hybrid'});assert.equal(found.records.length,1);assert.equal(found.records[0].id,b.id);assert.equal(found.reranked,true);const rerank=r.calls.filter(c=>c.url.endsWith('/rerank')).at(-1);assert.ok(!rerank.body.documents.some(d=>d.includes('secret')));assert.equal(rerank.body.documents.length,1);
 await r.store.save({...r.base,source_record_id:'semantic-b',text:'新版本',expected_version:1});const stale=await low.search({query:'换AI接手',mode:'semantic'});assert.equal(stale.records.length,0);
 await r.store.deleteConversation('test-platform','test-session');const deleted=await r.store.search({query:'换AI接手',mode:'semantic'});assert.equal(deleted.records.length,0);await r.store.indexPending(3);assert.equal(r.vectors.size,0);
 assert.ok(r.calls.filter(c=>c.url.endsWith('/embeddings')).every(c=>c.body.model==='BAAI/bge-m3'));assert.ok(r.calls.filter(c=>c.url.endsWith('/rerank')).every(c=>c.body.model==='BAAI/bge-reranker-v2-m3'));
}));
test('provider limits and disabled configuration preserve truthful keyword fallback',()=>withRig(async r=>{
 await r.store.save({...r.base,source_record_id:'fallback',text:'关键词回退标记'});globalThis.fetch=async()=>new Response('vendor echoes secrets here',{status:429});const result=await r.store.search({query:'关键词回退',mode:'hybrid'});assert.equal(result.search_mode,'keyword');assert.equal(result.degraded,true);assert.equal(result.reason,'model_provider_rate_limit');assert.equal(result.records.length,1);assert.ok(!JSON.stringify(result).includes('vendor echoes'));
 globalThis.fetch=r.mockFetch;r.env.VECTOR_INDEX.query=async()=>{throw new Error('private vector backend response');};const outage=await r.store.search({query:'关键词回退',mode:'hybrid'});assert.equal(outage.reason,'vector_search_unavailable');assert.equal(outage.records.length,1);
 r.env.RAG_ENABLED='false';assert.equal((await r.store.search({query:'关键词回退',mode:'hybrid'})).reason,'retrieval_not_configured');
}));
test('summary model gets only selected authorized evidence, persists source/model/version and rejects hallucinated citations',()=>withRig(async r=>{
 const evidence=await r.store.save({...r.base,source_record_id:'summary-evidence',sensitivity:'sensitive'});const result=await r.store.generateSummary({authorized:true,evidence:[{id:evidence.id,version:1}]});const record=await r.store.get(result.id);assert.equal(record.sensitivity,'sensitive');assert.equal(record.payload.data.model,'test-summary');assert.deepEqual(record.payload.data.evidence,[{id:evidence.id,version:1}]);assert.equal(record.payload.data.generated.overview[0].evidence_ids[0],evidence.id);
 await assert.rejects(()=>r.as(policy(1),['memory:read','memory:write']).generateSummary({authorized:true,evidence:[{id:evidence.id,version:1}]}),e=>e.status===404);
 globalThis.fetch=async()=>Response.json({choices:[{message:{content:JSON.stringify({overview:[{text:'伪造的总结',evidence_ids:['nonexistent']}],plans:[]})}}]});await assert.rejects(()=>r.store.generateSummary({authorized:true,evidence:[{id:evidence.id,version:1}]}),e=>e.code==='summary_evidence_invalid');
}));
test('indexing, hybrid rerank and summaries continue past old shared and per-operation daily counts',()=>withRig(async r=>{
 // Retained deployment variables and a large existing usage table must not block requests.
 r.env.MODEL_CALLS_PER_DAY='1';
 const insert=r.env.DB.sqlite.prepare('INSERT INTO model_usage VALUES(?,?,?,?,?,?)');
 for(const operation of ['embedding','query_embedding','rerank','summary'])for(let i=0;i<205;i++)insert.run(operation+'-'+i,r.full.owner_id,r.full.id,operation,100,new Date().toISOString());
 const saved=await r.store.save({...r.base,source_record_id:'no-model-quota',text:'不设调用预算的合成资料'});
 assert.equal((await r.store.indexPending(1)).results[0].status,'submitted');
 await r.store.ragStatus();
 const result=await r.store.search({query:'合成资料',mode:'hybrid',rerank:true});
 assert.equal(result.search_mode,'hybrid');assert.equal(result.reranked,true);assert.equal(result.degraded,undefined);assert.equal(result.records[0].id,saved.id);
 const summary=await r.store.generateSummary({authorized:true,evidence:[{id:saved.id,version:1}]});
 assert.equal((await r.store.get(summary.id)).payload.data.generated.overview.length,1);
 const status=await r.store.ragStatus();assert.equal(status.calls_per_day,null);assert.equal(status.application_model_limit,false);
 assert.ok(status.usage.every(item=>item.calls>205));
 assert.equal((await r.as(policy(3),['memory:read','sensitive:read']).ragStatus()).usage.length,0);
}));
test('providers reject malformed vectors/rerank indices and oversized responses; chunk offsets preserve Unicode',async()=>{
 const m=new Models({SILICONFLOW_API_KEY:'test-placeholder'},async()=>Response.json({data:[{index:0,embedding:[1,2]}]}));await assert.rejects(()=>m.embed(['测试']),e=>e.code==='invalid_embedding_response');
 const invalid=new Models({SILICONFLOW_API_KEY:'test-placeholder'},async()=>Response.json({results:[{index:0,relevance_score:1},{index:0,relevance_score:1}]}));await assert.rejects(()=>invalid.rerank('问题',['甲','乙']),e=>e.code==='invalid_rerank_response');
 const large=new Models({SILICONFLOW_API_KEY:'test-placeholder'},async()=>new Response('x'.repeat(2*1024*1024+1)));await assert.rejects(()=>large.embed(['测试']),e=>e.code==='model_response_too_large');
 assert.throws(()=>chunks('合成资料',10,10),e=>e.code==='invalid_chunk_options');
 const text='🚀𠮷中文'.repeat(900);for(const p of chunks(text))assert.equal(Array.from(text).slice(p.start,p.end).join(''),p.text);
});

test('index leases prevent concurrent cleanup on edits; failures remain retryable',()=>withRig(async r=>{
 const saved=await r.store.save({...r.base,source_record_id:'race',text:'版本一合成记录'});
 let release,entered;const enteredPromise=new Promise(done=>entered=done),block=new Promise(done=>release=done),original=r.mockFetch;
 globalThis.fetch=async(url,options)=>{if(url.endsWith('/embeddings')){entered();await block;}return original(url,options);};
 const first=r.store.indexPending(1);await enteredPromise;
 await r.store.save({...r.base,source_record_id:'race',text:'版本二合成记录',expected_version:1});
 assert.equal((await r.store.indexPending(1)).results.length,0);release();assert.equal((await first).results[0].status,'changed');
 globalThis.fetch=r.mockFetch;await r.store.indexPending(1);await r.store.ragStatus();
 const found=await r.store.search({query:'版本二',mode:'semantic'});assert.equal(found.records[0].version,2);assert.ok([...r.vectors.values()].every(v=>v.metadata.version===2));
 await r.store.save({...r.base,source_record_id:'retry',text:'重试合成记录'});globalThis.fetch=async()=>new Response('private vendor text',{status:503});const failed=await r.store.indexPending(1);assert.equal(failed.results[0].status,'failed');assert.ok(!JSON.stringify(failed).includes('private vendor'));
 globalThis.fetch=r.mockFetch;assert.equal((await r.store.indexPending(1)).results[0].status,'submitted');
}));
test('foreign-owner vector hits never reach the caller or reranker',()=>withRig(async r=>{
 const foreign=new (r.store.constructor)(r.env,{...r.full,owner_id:'owner-b'});await foreign.save({...r.base,source_record_id:'foreign',text:'其他用户的私密合成资料',sensitivity:'restricted'});await foreign.indexPending(1);await foreign.ragStatus();
 const result=await r.store.search({query:'换AI接手',mode:'semantic'});assert.equal(result.records.length,0);assert.equal(r.calls.filter(c=>c.url.endsWith('/rerank')).length,0);
}));

test('web model settings encrypt keys, require CAS, discover IDs, and never reuse keys on another endpoint',()=>withRig(async r=>{
 const settings=new ModelSettings(r.env,r.full),metadata=await settings.metadata();assert.equal(metadata.version,0);
 const body={authorized:true,expected_version:0,base_url:'https://api.example.com/v1',model:'synthetic-model',api_key:'synthetic-summary-credential',siliconflow_api_key:'synthetic-retrieval-credential',summary_enabled:true,retrieval_enabled:true};
 const saved=await settings.save(body);assert.equal(saved.version,1);assert.equal(saved.api_key_configured,true);assert.ok(!JSON.stringify(saved).includes(body.api_key));
 const ciphertext=r.env.DB.sqlite.prepare('SELECT payload_cipher FROM model_settings').get().payload_cipher;assert.ok(!ciphertext.includes(body.api_key));assert.equal((await r.store.listRecords({})).records.length,0);
 assert.equal((await runtimeModels(r.env,r.full.owner_id)).SUMMARY_API_KEY,body.api_key);
 await assert.rejects(()=>settings.save(body),e=>e.code==='model_settings_conflict');
 let sent;globalThis.fetch=async(url,options)=>{sent={url,key:options.headers.authorization};return Response.json({data:[{id:'synthetic-model'},{id:'another-model'},{id:'synthetic-model'}]});};
 assert.deepEqual((await settings.list({base_url:body.base_url})).models,['another-model','synthetic-model']);assert.equal(sent.url,'https://api.example.com/v1/models');
 await assert.rejects(()=>settings.list({base_url:'https://different.example.com/v1'}),e=>e.code==='model_key_required');
 await assert.rejects(()=>settings.save({...body,api_key:undefined,expected_version:1,base_url:'https://different.example.com/v1'}),e=>e.code==='summary_settings_incomplete');
 await assert.rejects(()=>settings.list({base_url:'https://127.0.0.1/v1',api_key:body.api_key}),e=>e.code==='invalid_model_endpoint');
 await settings.save({...body,expected_version:1,api_key:undefined,summary_enabled:false,retrieval_enabled:false});assert.equal((await runtimeModels(r.env,r.full.owner_id)).SUMMARY_API_KEY,undefined);assert.equal((await runtimeModels(r.env,r.full.owner_id)).retrievalEnabled,false);
 globalThis.fetch=async()=>Response.json({data:[{id:body.api_key}]});await assert.rejects(()=>settings.list({base_url:body.base_url}),e=>e.code==='invalid_model_response');
}));
