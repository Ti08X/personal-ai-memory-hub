import { readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
export function options(args=process.argv.slice(2)) {
 const result={};
 for(let i=0;i<args.length;i++) { if(!args[i].startsWith('--'))throw new Error('Expected named option');const key=args[i].slice(2);result[key]=args[i+1]&&!args[i+1].startsWith('--')?args[++i]:true; }
 return result;
}
export async function loadCredentials(file, client='codex') {
 if(!file)throw new Error('--credential-file is required');
 const path=resolve(file), info=await stat(path);
 if(process.platform!=='win32'&&(info.mode & 0o077))throw new Error('Credential file must be private: chmod 600');
 const config=JSON.parse(await readFile(path,'utf8'));
 if(!config.clients?.[client])throw new Error('Client credential was not found');
 return {endpoint:config.endpoint.replace(/\/$/,''),...config.clients[client]};
}
export async function request(credentials,path,{method='GET',body}={}) {
 let res;
 for(let attempt=0;attempt<3;attempt++) {
  res=await fetch(credentials.endpoint+path,{method,headers:{authorization:'Bearer '+credentials.token,...(body?{'content-type':'application/json'}:{})},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(60000)});
  if(res.status!==429||attempt===2)break;
  await res.arrayBuffer();await new Promise(resolve=>setTimeout(resolve,61000-Date.now()%60000));
 }
 const data=await res.json();
 if(!res.ok) {const error=new Error('Hub request failed: '+res.status+' '+(data.error??'unknown'));error.status=res.status;error.details=data.details;throw error;}
 return data;
}
