import {createServer} from 'node:http';
import {Readable} from 'node:stream';
import {environment} from './runtime.mjs';
import app from './app.bundle.mjs';
process.umask(0o077);
const origin=new URL(process.env.PUBLIC_ORIGIN??'http://localhost:8830');
if(origin.pathname!=='/'||origin.search||origin.hash||origin.username||origin.password)throw new Error('PUBLIC_ORIGIN must be an origin');
const env=await environment();
const server=createServer(async(req,res)=>{
 try{
  const allowedHosts=new Set([origin.host,...(process.env.INTERNAL_HOSTS??'127.0.0.1:8830,localhost:8830').split(',')]);
  if(!allowedHosts.has(req.headers.host)){res.writeHead(421);res.end();return;}
  const url=new URL(req.url??'/',origin);if(url.origin!==origin.origin){res.writeHead(400);res.end();return;}
  const parts=[];let length=0;
  for await(const chunk of req){length+=chunk.length;if(length>262144){res.writeHead(413,{'content-type':'application/json','connection':'close'});res.end('{"error":"payload_too_large"}');return;}parts.push(chunk);}
  const headers=new Headers();for(const [k,v] of Object.entries(req.headers)){if(v!==undefined&&k!=='host')headers.set(k,Array.isArray(v)?v.join(','):v);}
  // Only loopback is exposed. The reverse proxy always overwrites this header.
  headers.set('cf-connecting-ip',req.headers['x-real-ip']??req.socket.remoteAddress??'unknown');
  const request=new Request(url,{method:req.method,headers,...(parts.length?{body:Buffer.concat(parts)}:{})});
  const result=await app.fetch(request,env),out=Object.fromEntries(result.headers);
  const cookies=result.headers.getSetCookie();if(cookies.length)out['set-cookie']=cookies;
  res.writeHead(result.status,out);
  if(result.body){const stream=Readable.fromWeb(result.body);stream.on('error',()=>res.destroy());res.on('close',()=>stream.destroy());stream.pipe(res);}else res.end();
 }catch{if(!res.headersSent)res.writeHead(500,{'content-type':'application/json','cache-control':'no-store'});res.end('{"error":"server_unavailable"}');console.error('server_request_failed');}
});
server.requestTimeout=120000;server.headersTimeout=15000;server.keepAliveTimeout=5000;
server.listen(Number(process.env.PORT??8830),'127.0.0.1',()=>console.log('memory_hub_listening'));
let shutting=false;function stop(){if(shutting)return;shutting=true;server.close(()=>{env.DB.close();process.exit(0);});setTimeout(()=>process.exit(1),15000).unref();}
process.on('SIGTERM',stop);process.on('SIGINT',stop);
