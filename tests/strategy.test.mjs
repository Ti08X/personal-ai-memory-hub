import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {rig,Store} from './support/local-store.mjs';
const bundle=await build({entryPoints:['src/strategy.ts'],bundle:true,write:false,format:'esm',platform:'node',target:'node22'});
const {Strategy}=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
const document={vision:'合成总战略：建立可回溯的个人工作系统。',principles:'先核实证据，再行动。',sensitivity:'sensitive',goals:[{id:'main',kind:'strategy',title:'合成长期方向',status:'active'},{id:'stage',parent_id:'main',kind:'stage',title:'合成阶段一',status:'active'},{id:'month',parent_id:'stage',kind:'month',period:'2026-10',title:'月度目标',status:'active',success_criteria:'有明确验收结果',current_state:'本人确认进度',next_step:'本人确认下一步'}]};
const save=(s,doc=document,expected_version=0)=>s.saveDraft({authorized:true,expected_version,document:doc});
const publish=(s,draft=1,published=0)=>s.publish({authorized:true,expected_draft_version:draft,expected_published_version:published});
test('owner draft is encrypted and private; only explicit publication enters strategy-first handoff',async()=>{
 const r=rig();try{const s=new Strategy(r.store);assert.equal((await r.store.strategy()).status,'not_published');await save(s);assert.equal((await r.store.strategy()).document,null);const row=r.env.DB.sqlite.prepare('SELECT * FROM strategy_state').get();assert.ok(!row.draft_cipher.includes('合成总战略'));assert.equal(row.published_version,0);
 await publish(s);const handoff=await r.store.handoff();assert.equal(Object.keys(handoff)[0],'strategy');assert.equal(handoff.strategy.version,1);assert.equal(handoff.strategy.agent_writable,false);assert.equal(handoff.strategy.priority,'highest_personal_planning');assert.deepEqual(handoff.strategy.read_order.slice(0,3),['strategy','stage','month']);assert.equal(handoff.strategy.document.vision,document.vision);assert.deepEqual((await r.store.strategy({detail:'full'})).document.goals.map(g=>g.kind),['strategy','stage','month']);
 await save(s,{...document,vision:'新的未发布方向'},1);assert.equal((await r.store.strategy()).document.vision,document.vision);
 await publish(s,2,1);assert.equal((await r.store.strategy()).version,2);assert.equal((await s.history({version:1})).document.vision,document.vision);assert.equal((await s.history()).versions.length,2);
 }finally{r.close();}
});
test('strategy respects owner, sensitivity and project collection; L3 alone does not grant editor access',async()=>{
 const r=rig();try{const s=new Strategy(r.store);await save(s);await publish(s);const low=r.as({read_level:1,write_level:1,collections:['projects']});assert.equal((await low.strategy()).status,'scope_restricted');assert.equal((await low.strategy()).document,null);
 const noProjects=r.as({read_level:3,write_level:3,collections:['memories']},['memory:read','sensitive:read']);assert.equal((await noProjects.strategy()).status,'scope_restricted');
 const ai=r.as(r.full.policy,['memory:read','memory:write','sensitive:read','sensitive:write']);assert.equal((await ai.strategy()).status,'published');await assert.rejects(new Strategy(ai).saveDraft({authorized:true,expected_version:1,document}),e=>e.status===403);
 const outsider=new Store(r.env,{...r.full,owner_id:'other-owner'});assert.equal((await outsider.strategy()).status,'not_published');await assert.rejects(new Strategy(outsider).history({version:1}),e=>e.status===404);
 }finally{r.close();}
});
test('strategy validates hierarchy, dates, periods and draft/publication conflicts',async()=>{
 const r=rig();try{const s=new Strategy(r.store);for(const goals of [[{id:'bad',kind:'month',title:'bad',period:'2026-10'}],[{id:'root',kind:'strategy',title:'root',parent_id:'root'}],[{id:'a',kind:'strategy',title:'a'},{id:'a',kind:'strategy',title:'b'}],[...document.goals.slice(0,2),{...document.goals[2],period:'2027-13'}],[...document.goals.slice(0,2),{...document.goals[2],parent_id:'main'}],[...document.goals,{id:'quarter',parent_id:'stage',kind:'quarter',title:'removed',period:'2026-Q4'}],[{id:'bad',kind:'strategy',title:'bad',starts_on:'2026-02-30'}]])await assert.rejects(save(s,{...document,goals}));
 await save(s);await assert.rejects(save(s),e=>e.code==='strategy_draft_conflict');await assert.rejects(publish(s,2),e=>e.code==='strategy_publish_conflict');await publish(s);await assert.rejects(publish(s),e=>e.code==='strategy_publish_conflict');assert.equal((await s.history()).versions.length,1);
 }finally{r.close();}
});
test('agent generic record writes cannot impersonate authoritative strategy and models cannot change published goals',async()=>{
 const r=rig();try{const s=new Strategy(r.store);await save(s);await publish(s);
 await assert.rejects(r.store.save({...r.base,logical_key:'strategy.current',record_type:'project'}),e=>e.code==='strategy_owner_managed');
 await r.store.save({...r.base,record_type:'project',logical_key:'suggestion',text:'讨论一个可能的新目标，尚未确认。'});const handoff=await r.store.handoff();assert.equal(handoff.strategy.document.vision,document.vision);assert.equal((await r.store.overview()).strategy.version,1);
 await assert.rejects(save(s,{...document,vision:'sk-'+'a'.repeat(40)},1),e=>e.status===422);
 }finally{r.close();}
});
