// Private HTTP bridge. Authentication remains at the existing HTTPS reverse proxy;
// the service token never reaches the browser, URLs, ordinary logs or error payloads.
import {readFileSync} from 'node:fs';
export function intelBridge({base=process.env.WB_INTEL_URL||'http://127.0.0.1:8901',tokenFile=process.env.WB_INTEL_TOKEN_FILE||'/opt/pw-intel/workspace-token',timeoutMs=10000}={}){
 const target=new URL(base);
 if(target.protocol!=='http:'||!['127.0.0.1','localhost','[::1]'].includes(target.hostname)||target.username||target.password||target.search||target.hash||target.pathname!=='/')throw Error('Collector bridge must use a loopback HTTP origin');
 return async(req,res,url,{json,readBody,origin})=>{
  if(!url.pathname.startsWith('/api/intel/'))return false;
  const part=url.pathname.slice('/api/intel'.length);
  const read=req.method==='GET'&&['/snapshot','/articles'].includes(part);
  const write=(req.method==='POST'&&part==='/sources')||(/^\/sources\/[a-z0-9-]{3,80}$/.test(part)&&req.method==='PATCH')||(/^\/sources\/[a-z0-9-]{3,80}\/fetch$/.test(part)&&req.method==='POST');
  if(!read&&!write){json(res,404,{error:'not_found'});return true}
  if(write&&req.headers.origin!==origin){json(res,403,{error:'origin_required'});return true}
  let token;
  try{token=readFileSync(tokenFile,'utf8').trim();if(token.length<32)throw Error()}catch{json(res,503,{error:'collector_unconfigured'});return true}
  const params=new URLSearchParams();
  if(part==='/articles')for(const key of ['q','offset','limit'])if(url.searchParams.has(key))params.set(key,url.searchParams.get(key).slice(0,200));
  let body;
  if(write){try{body=JSON.stringify(await readBody(req,16*1024))}catch{json(res,400,{error:'invalid_json'});return true}}
  try{
   const response=await fetch(new URL('/internal/workbench'+part+(params.size?'?'+params:''),target),{method:req.method,redirect:'error',signal:AbortSignal.timeout(timeoutMs),headers:{'x-workbench-token':token,'Content-Type':'application/json'},...(body?{body}:{})});
   if(response.status>=500||response.status===401){json(res,503,{error:'collector_unavailable'});return true}
   const data=await response.json();json(res,response.status,data);
  }catch{json(res,503,{error:'collector_unavailable'})}
  return true;
 };
}
