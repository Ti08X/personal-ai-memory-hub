import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {intelBridge} from '../intel.mjs';
const json=(res,status,data)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(data))};
const readBody=async req=>{let data='';for await(const c of req)data+=c;return JSON.parse(data||'{}')};
const listen=server=>new Promise(resolve=>server.listen(0,'127.0.0.1',()=>resolve('http://127.0.0.1:'+server.address().port)));
test('collector bridge allows only scoped routes, requires same-origin writes and keeps credentials server-side',async()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'collector-test-'));const tokenFile=path.join(dir,'token'),token='synthetic-service-token-for-test-only';writeFileSync(tokenFile,token,{mode:0o600});
 let seen=[];
 const upstream=createServer(async(req,res)=>{seen.push({url:req.url,method:req.method,token:req.headers['x-workbench-token'],body:req.method==='POST'?await readBody(req):null});json(res,200,{ok:true})});
 const base=await listen(upstream),bridge=intelBridge({base,tokenFile});
 const server=createServer(async(req,res)=>{if(!await bridge(req,res,new URL(req.url,'http://localhost'),{json,readBody,origin:'https://workspace.example.com'}))json(res,404,{error:'not_found'})});
 const url=await listen(server);
 try{
  const r=await fetch(url+'/api/intel/snapshot');assert.deepEqual(await r.json(),{ok:true});assert.equal(seen[0].token,token);assert.equal(seen[0].url,'/internal/workbench/snapshot');assert.equal(r.headers.get('x-workbench-token'),null);
  assert.equal((await fetch(url+'/api/intel/sources',{method:'POST',body:'{}'})).status,403);
  assert.equal((await fetch(url+'/api/intel/sources',{method:'POST',headers:{Origin:'https://evil.example'},body:'{}'})).status,403);
  assert.equal((await fetch(url+'/api/intel/admin/settings')).status,404);assert.equal(seen.length,1);
  await fetch(url+'/api/intel/sources',{method:'POST',headers:{Origin:'https://workspace.example.com'},body:'{"name":"Synthetic"}'});assert.equal(seen[1].body.name,'Synthetic');
  await fetch(url+'/api/intel/articles?q=hello&url=http://evil.example');assert.equal(seen[2].url,'/internal/workbench/articles?q=hello');
  writeFileSync(tokenFile,'');const missing=await fetch(url+'/api/intel/snapshot');assert.equal(missing.status,503);assert.ok(!(await missing.text()).includes(token));
 }finally{server.closeAllConnections();upstream.closeAllConnections();await Promise.all([new Promise(r=>server.close(r)),new Promise(r=>upstream.close(r))]);rmSync(dir,{recursive:true,force:true})}
});
test('bridge rejects external services and never exposes transport errors',async()=>{
 assert.throws(()=>intelBridge({base:'https://external.example'}));assert.throws(()=>intelBridge({base:'http://user:secret@127.0.0.1'}));
 const dir=mkdtempSync(path.join(tmpdir(),'collector-timeout-'));const file=path.join(dir,'token');writeFileSync(file,'synthetic-unavailable-service-token');
 const upstream=createServer((_req,_res)=>{});const base=await listen(upstream);const bridge=intelBridge({base,tokenFile:file,timeoutMs:50});
 const server=createServer(async(req,res)=>{await bridge(req,res,new URL(req.url,'http://localhost'),{json,readBody,origin:'https://workspace.example.com'})});const url=await listen(server);
 try{const r=await fetch(url+'/api/intel/snapshot');assert.equal(r.status,503);assert.deepEqual(await r.json(),{error:'collector_unavailable'})}finally{server.closeAllConnections();upstream.closeAllConnections();await Promise.all([new Promise(r=>server.close(r)),new Promise(r=>upstream.close(r))]);rmSync(dir,{recursive:true,force:true})}
});
