// The same HTTP regression suite runs against the real Node runtime with isolated
// synthetic data, never the user's production database or credentials.
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawn,spawnSync} from 'node:child_process';
import {database} from '../server/database.mjs';
const root=resolve(new URL('..',import.meta.url).pathname),dir=await mkdtemp(join(tmpdir(),'pmh-server-test-')),port=Number(process.env.TEST_PORT??8832),base='http://localhost:'+port;
let server;
try{
 for(const args of [['scripts/build-server.mjs'],['scripts/bootstrap.mjs',dir]]){const r=spawnSync(process.execPath,args,{cwd:root,stdio:'ignore'});if(r.status)throw new Error('Test initialization failed');}
 const file=join(dir,'credentials.json'),c=JSON.parse(await readFile(file,'utf8'));c.endpoint=base;await writeFile(file,JSON.stringify(c),{mode:0o600});
 const path=join(dir,'test.sqlite'),db=database(path,join(root,'migrations'));db.sqlite.exec(await readFile(join(dir,'bootstrap.sql'),'utf8'));db.close();
 server=spawn(process.execPath,['server/http.mjs'],{cwd:root,env:{...process.env,ENCRYPTION_KEY:c.encryption_key,DATABASE_PATH:path,PUBLIC_ORIGIN:base,PORT:String(port),INTERNAL_HOSTS:'localhost:'+port},stdio:'ignore'});
 let ready=false;for(let n=0;n<80;n++){try{if((await fetch(base+'/health')).ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,100));}if(!ready)throw new Error('Node test server did not start');
 const tests=['server-adapters','archive-ui','auth-bootstrap','client-access','collections','dashboard','dashboard-login-browser','import-format','integration','model-transport','memory-overview','memory-library','library-workflow','strategy','openclaw-plugin','plugin-activity','password-change','password-kdf','rag','skill'];
 const code=await new Promise((done,reject)=>{const child=spawn(process.execPath,['--test','--test-concurrency=1',...tests.map(n=>'tests/'+n+'.test.mjs')],{cwd:root,env:{...process.env,HUB_URL:base,CREDENTIAL_FILE:file},stdio:'inherit'});child.once('error',reject);child.once('exit',done);});if(code)throw new Error('Node server regressions failed');
}finally{if(server){server.kill('SIGTERM');await new Promise(r=>{server.once('exit',r);setTimeout(r,2000);});}await rm(dir,{recursive:true,force:true});}
