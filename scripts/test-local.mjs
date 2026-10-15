// Isolated regression suite: never reads an existing user's credential directory.
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawn} from 'node:child_process';
import {localTestConfig} from './local-test-config.mjs';
const project=resolve(new URL('..',import.meta.url).pathname),dir=await mkdtemp(join(tmpdir(),'pmh-v2-test-')),state=join(dir,'state'),port=Number(process.env.TEST_PORT??8910),base='http://localhost:'+port;
const wrangler=join(project,'node_modules/wrangler/bin/wrangler.js');let server;
function run(args,label,inherit=false,env=process.env){return new Promise((done,reject)=>{const child=spawn(process.execPath,args,{cwd:project,env,stdio:inherit?'inherit':'ignore'});child.once('error',()=>reject(new Error(label+' could not start')));child.once('exit',code=>code===0?done():reject(new Error(label+' failed (exit '+code+')')));});}
try{
 const localConfig=await localTestConfig(dir);
 await run(['scripts/bootstrap.mjs',dir],'temporary bootstrap');
 const file=join(dir,'credentials.json'),config=JSON.parse(await readFile(file,'utf8'));config.endpoint=base;await writeFile(file,JSON.stringify(config),{mode:0o600});
 await run([wrangler,'--config',localConfig,'d1','migrations','apply','personal-ai-memory-hub','--local','--persist-to',state],'isolated migrations');
 await run([wrangler,'--config',localConfig,'d1','execute','personal-ai-memory-hub','--local','--persist-to',state,'--file',join(dir,'bootstrap.sql'),'--yes'],'temporary test clients');
 server=spawn(process.execPath,[wrangler,'--config',localConfig,'dev','--host','localhost','--port',String(port),'--persist-to',state,'--env-file',join(dir,'worker.env')],{cwd:project,stdio:'ignore'});
 let ready=false;for(let n=0;n<80;n++){try{if((await fetch(base+'/health')).ok){ready=true;break;}}catch{}await new Promise(done=>setTimeout(done,250));}
 if(!ready)throw new Error('isolated Worker did not become ready');
 await run(['--test','--test-concurrency=1',...['auth-bootstrap','client-access','collections','dashboard','dashboard-login-browser','import-format','integration','model-transport','memory-overview','strategy','openclaw-plugin','plugin-activity','password-change','password-kdf','rag','skill'].map(s=>'tests/'+s+'.test.mjs')],'local suite',true,{...process.env,HUB_URL:base,CREDENTIAL_FILE:file});
}finally{
 if(server){server.kill('SIGTERM');await new Promise(done=>{server.once('exit',done);setTimeout(done,3000);});}
 await rm(dir,{recursive:true,force:true});
}
