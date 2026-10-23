import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createServer} from 'node:net';
import {spawn} from 'node:child_process';

test('workbench current schema, ideas, metadata and validation use isolated synthetic storage',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'workspace-api-test-'));
 const probe=createServer();await new Promise(r=>probe.listen(0,'127.0.0.1',r));const port=probe.address().port;await new Promise(r=>probe.close(r));
 const origin='http://127.0.0.1:'+port;
 const child=spawn(process.execPath,[resolve(dirname(fileURLToPath(import.meta.url)),'../server.mjs')],{env:{...process.env,PORT:String(port),PUBLIC_ORIGIN:origin,WB_DB_PATH:join(dir,'synthetic.sqlite'),WB_KEY_PATH:join(dir,'.synthetic-key')},stdio:'ignore'});
 try {
  let ready=false;for(let n=0;n<60;n++){try{if((await fetch(origin+'/api/health')).ok){ready=true;break}}catch{}await new Promise(r=>setTimeout(r,50))}assert.ok(ready,'isolated API started');
  const request=(path,body,method='POST')=>fetch(origin+path,{method,headers:{'Content-Type':'application/json',Origin:origin},body:JSON.stringify(body)});
  await t.test('fresh schema supports the fields used by current UI',async()=>{const r=await fetch(origin+'/api/items');assert.equal(r.status,200);assert.deepEqual((await r.json()).items,[])});
  let id;
  await t.test('idea create, metadata read and update',async()=>{const r=await request('/api/items',{name:'Synthetic idea',category:'idea',note:'Synthetic content only',mechanism:'Example mechanism',potential:'Example potential',status:'planned'});assert.equal(r.status,201);const item=await r.json();id=item.id;assert.equal(item.mechanism,'Example mechanism');assert.equal(item.thumb,'');const u=await request('/api/items/'+id,{name:'Updated synthetic idea'},'PATCH');assert.equal(u.status,200);assert.equal((await u.json()).name,'Updated synthetic idea')});
  await t.test('credential list masks synthetic secret values',async()=>{const secret='synthetic-value-for-local-test-only';const r=await request('/api/creds',{name:'Synthetic credential',kind:'api',token:secret});assert.equal(r.status,201);const list=await fetch(origin+'/api/creds');const text=await list.text();assert.ok(!text.includes(secret));assert.equal(JSON.parse(text).creds.length,1)});
  await t.test('live telemetry and redacted activity are actual and bounded',async()=>{const system=await (await fetch(origin+'/api/system')).json();assert.ok(Number.isFinite(system.memory.total)&&system.memory.total>0);assert.ok(system.memory.percent>=0&&system.memory.percent<=100);assert.ok(Array.isArray(system.history));const sec=await (await fetch(origin+'/api/security')).json();assert.equal(sec.keyFileMode,'600');assert.equal(sec.score,null);const tls=await (await fetch(origin+'/api/tls')).json();assert.equal(tls.available,false);assert.ok(!JSON.stringify(sec).includes('synthetic-value-for-local-test-only'));const activity=await (await fetch(origin+'/api/activity')).json();assert.ok(activity.items.length>0);assert.ok(activity.items.every(x=>['items','credentials'].includes(x.resource)));assert.ok(!JSON.stringify(activity).includes('Synthetic idea'));});
  await t.test('foreign Origin cannot mutate workspace',async()=>{const r=await fetch(origin+'/api/items',{method:'POST',headers:{Origin:'https://other.example','Content-Type':'application/json'},body:JSON.stringify({name:'Rejected foreign request',category:'site'})});assert.equal(r.status,403)});
  await t.test('invalid category rejected and synthetic item removable',async()=>{const r=await request('/api/items',{name:'Rejected sample',category:'invalid'});assert.equal(r.status,400);assert.equal((await fetch(origin+'/api/items/'+id,{method:'DELETE'})).status,200)});
 } finally {child.kill('SIGTERM');await new Promise(r=>{child.once('exit',r);setTimeout(r,1000)});await rm(dir,{recursive:true,force:true})}
});
