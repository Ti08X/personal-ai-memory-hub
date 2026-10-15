import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {readFile,readdir} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
const root=new URL('..',import.meta.url).pathname;
test('real local Workflows binding runs resumable encrypted library stages and stops after authorization revocation',{timeout:60000},async()=>{
 const source=`export {MemoryLibraryWorkflow} from './src/library-workflow';import {Store} from './src/store';import {MemoryLibrary} from './src/memory-library';
 const principal={id:'workflow-client',owner_id:'workflow-owner',scopes:['admin','memory:read','memory:write','sensitive:read','sensitive:write'],policy:{read_level:3,write_level:3,collections:['chats','memories','projects','accounts','knowledge']}};
 export default {async fetch(req,env){const path=new URL(req.url).pathname,library=new MemoryLibrary(new Store(env,principal));
 if(path==='/seed'){await env.DB.prepare('INSERT INTO clients(id,owner_id,name,token_hash,scopes,created_at,expires_at,policy_json) VALUES(?,?,?,?,?,?,?,?)').bind(principal.id,principal.owner_id,'synthetic','not-a-secret',JSON.stringify(principal.scopes),new Date().toISOString(),'2999-01-01T00:00:00Z',JSON.stringify(principal.policy)).run();await new Store(env,principal).save({authorized:true,source_platform:'synthetic',source_kind:'test',source_record_id:'one',text:'个人合成偏好：清晰说明。',timestamp:'2026-10-15T00:00:00Z'});await library.configure({authorized:true,enabled:true,expected_revision:0});return Response.json({ok:true});}
 if(path==='/start'){const instance=await env.LIBRARY_WORKFLOW.create({id:'library-test',params:{owner:principal.owner_id,client:principal.id}});return Response.json(await instance.status());}
 if(path==='/workflow')return Response.json(await (await env.LIBRARY_WORKFLOW.get('library-test')).status());
 if(path==='/status')return Response.json(await library.status());return new Response('missing',{status:404});}};`;
 const compiled=await build({stdin:{contents:source,resolveDir:root,sourcefile:'synthetic-workflow-test.ts'},bundle:true,write:false,format:'esm',platform:'browser',target:'es2022',external:['cloudflare:workers','cloudflare:workflows']});
 let vendorCalls=0;
 const mf=new Miniflare(convertV4MiniflareOptions({modules:true,script:compiled.outputFiles[0].text,compatibilityDate:'2026-10-10',compatibilityFlags:['nodejs_compat'],d1Databases:['DB'],workflows:{LIBRARY_WORKFLOW:{name:'synthetic-library',className:'MemoryLibraryWorkflow'}},bindings:{ENCRYPTION_KEY:Buffer.alloc(32,21).toString('base64'),SUMMARY_BASE_URL:'https://synthetic-model.test/v1',SUMMARY_API_KEY:'synthetic-placeholder',SUMMARY_MODEL:'test'},outboundService:async request=>{vendorCalls++;const input=JSON.parse((await request.json()).messages[1].content),output=input.evidence?{entries:input.evidence.map(e=>({id:e.id,categories:['personal'],tags:['合成'],facts:[{section:'personal',text:'合成偏好',status:'confirmed',project:''}]}))}:{brief:'合成偏好',personal:[{text:'合成偏好',status:'confirmed',project:'',evidence_ids:[input.entries[0].id]}],projects:[],mainline:[],next_actions:[]};return Response.json({choices:[{message:{content:JSON.stringify(output)}}]});}}));
 try{
  const db=await mf.getD1Database('DB');
  for(const filename of (await readdir(root+'/migrations')).filter(f=>f.endsWith('.sql')).sort()){const parsed=spawnSync('python3',['-c',"import sys,sqlite3,json\na=[];p=''\nfor c in sys.stdin.read():\n p+=c\n if c==';' and sqlite3.complete_statement(p):a.append(p);p=''\nprint(json.dumps(a))"],{input:await readFile(root+'/migrations/'+filename,'utf8'),encoding:'utf8'});assert.equal(parsed.status,0);for(const sql of JSON.parse(parsed.stdout))await db.prepare(sql).run();}
  const call=async path=>{const response=await mf.dispatchFetch('http://localhost'+path);assert.equal(response.status,200);return response.json();};
  await call('/seed');await call('/start');let workflow;
  for(let i=0;i<100;i++){workflow=await call('/workflow');if(['complete','errored'].includes(workflow.status))break;await new Promise(done=>setTimeout(done,100));}
  assert.equal(workflow.status,'complete',JSON.stringify(workflow));assert.equal((await call('/status')).counts.organized,1);assert.ok(vendorCalls>=5);assert.ok(!JSON.stringify(workflow.output).includes('个人合成偏好'));assert.ok(workflow.output.rounds.length>=4);
  await db.prepare('UPDATE clients SET revoked_at=?').bind(new Date().toISOString()).run();
  // A new workflow must not reuse the cached authorization from the finished one.
  const before=vendorCalls;const bindings=await mf.getBindings();const next=await bindings.LIBRARY_WORKFLOW.create({id:'revoked-test',params:{owner:'workflow-owner',client:'workflow-client'}});
  let revoked;for(let i=0;i<50;i++){revoked=await next.status();if(revoked.status==='errored')break;await new Promise(done=>setTimeout(done,100));}
  // Retrying a denied stage is governed by durable retry delays; no vendor calls can occur.
  assert.equal(vendorCalls,before);assert.equal(revoked.status,'errored');
 }finally{await mf.dispose();}
});
