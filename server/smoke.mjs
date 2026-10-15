// Explicit operator smoke test, never run on an interval. Only disposable,
// synthetic-owner records are written. Real owner data cannot be selected.
import assert from 'node:assert/strict';
import {randomBytes,randomUUID,createHash} from 'node:crypto';
import {database} from './database.mjs';
const db=database(process.env.DATABASE_PATH),owner='migration-smoke-'+randomUUID(),id=randomUUID(),lowId=randomUUID(),token='pmh_'+randomBytes(32).toString('hex'),lowToken='pmh_'+randomBytes(32).toString('hex');
const standard=['memory:read','memory:write','conversation:import'],all=[...standard,'sensitive:read','sensitive:write'],collections=['chats','memories','projects','accounts','knowledge'],base=process.env.SMOKE_ORIGIN??'https://pw.zgatri.com';
const add=(client,key,scopes,level)=>db.sqlite.prepare('INSERT INTO clients(id,owner_id,name,token_hash,scopes,created_at,expires_at,policy_json) VALUES(?,?,?,?,?,?,?,?)').run(client,owner,'disposable-migration-smoke',createHash('sha256').update(key).digest('hex'),JSON.stringify(scopes),new Date().toISOString(),new Date(Date.now()+120000).toISOString(),JSON.stringify({read_level:level,write_level:level,collections}));
let stage='create';
try{
 add(id,token,all,3);add(lowId,lowToken,standard,1);
 const call=async(path,method='GET',body,key=token)=>{stage=path;const r=await fetch(base+path,{method,headers:{authorization:'Bearer '+key,...(body?{'content-type':'application/json'}:{})},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(30000)});return {status:r.status,data:await r.json()};};
 const v={authorized:true,record_type:'memory',logical_key:'migration-smoke',source_platform:'migration-test',session_id:'disposable',source_kind:'test',timestamp:new Date().toISOString(),text:'合成迁移验收记录：松树和灯塔。',sensitivity:'restricted'};
 let r=await call('/v1/memories','POST',v);assert.equal(r.status,201);const record=r.data.id;
 r=await call('/v1/memories','POST',v);assert.equal(r.data.deduplicated,true);
 r=await call('/v1/records/'+record);assert.equal(r.data.payload.text,v.text);
 r=await call('/v1/records/'+record,'GET',undefined,lowToken);assert.equal(r.status,404);
 r=await call('/v1/memories','POST',{...v,text:'合成修改，必须先检查版本。'});assert.equal(r.status,409);
 r=await call('/v1/memories','POST',{...v,text:'合成更新后的验收记录。',expected_version:1});assert.equal(r.status,201);assert.equal(r.data.version,2);
 r=await call('/v1/records/'+record+'/history');assert.equal(r.data.versions.length,2);
 r=await call('/v1/search?query='+encodeURIComponent('验收记录'));assert.equal(r.status,200);assert.ok(r.data.records.some(x=>x.id===record));
 const message={id:'msg-stable-1',role:'user',timestamp:v.timestamp,content:'合成聊天归档验收。',sensitivity:'sensitive'},conversation={authorized:true,source_platform:'migration-test',session_id:'disposable-chat',title:'合成测试',completeness:'partial',messages:[message]};
 r=await call('/v1/conversations/import','POST',conversation);assert.equal(r.status,201);
 await call('/v1/conversations/import','POST',conversation);
 r=await call('/v1/conversations');assert.equal(r.data.conversations.length,1);assert.equal(r.data.conversations[0].message_records,1);
 r=await call('/v1/strategy/publish','POST',{authorized:true});assert.equal(r.status,403);
 console.log(JSON.stringify({public_https_smoke:'passed',checks:['write','read','deduplicate','L3_permission','version_conflict','version_update','history','search','conversation_import','conversation_deduplicate','agent_strategy_read_only']}));
}catch{console.error('public_smoke_failed_at:'+stage);process.exitCode=1;}
finally{
 db.sqlite.exec('BEGIN IMMEDIATE');try{for(const table of ['records','conversations','import_batches','conflicts','audit_log','rag_jobs','clients'])db.sqlite.prepare('DELETE FROM '+table+' WHERE owner_id=?').run(owner);db.sqlite.prepare('DELETE FROM rate_limits WHERE client_id IN (?,?)').run(id,lowId);db.sqlite.exec('COMMIT');}catch{db.sqlite.exec('ROLLBACK');throw new Error('Synthetic owner cleanup failed');}db.close();
}
