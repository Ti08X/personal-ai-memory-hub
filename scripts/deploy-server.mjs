// Routine update: no production data, secret, TLS, DNS or credential replacement.
import {spawnSync} from 'node:child_process';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {options} from './lib.mjs';
const args=options(),host=String(args.host??process.env.PMH_SSH_HOST??''),user=String(args.user??'ubuntu'),key=String(args['ssh-key']??process.env.PMH_SSH_KEY??'');
if(!/^[a-zA-Z0-9.-]+$/.test(host)||!key||!/^[a-zA-Z_][a-zA-Z0-9_-]*$/.test(user))throw new Error('Provide --host and --ssh-key (or PMH_SSH_HOST / PMH_SSH_KEY)');
const root=resolve(new URL('..',import.meta.url).pathname),dir=await mkdtemp(join(tmpdir(),'pmh-deploy-')),file=join(dir,'release.tgz');
const ssh=['-o','BatchMode=yes','-o','IdentitiesOnly=yes','-o','StrictHostKeyChecking=yes','-i',resolve(key)],remote=user+'@'+host;
const run=(cmd,argv,env=process.env)=>{const r=spawnSync(cmd,argv,{cwd:root,env,stdio:'inherit'});if(r.status!==0)throw new Error('Server update stopped: '+cmd);};
try{
 run(process.execPath,['node_modules/typescript/bin/tsc','--noEmit']);run(process.execPath,['scripts/build-ui.mjs']);run(process.execPath,['scripts/build-server.mjs']);
 run('tar',['-czf',file,'package.json','package-lock.json','.dockerignore','server','public','migrations'],{...process.env,COPYFILE_DISABLE:'1'});
 run('ssh',[...ssh,remote,'sudo systemctl start personal-memory-backup.service']);
 run('scp',[...ssh,file,remote+':/opt/personal-memory-hub/release.tgz']);
 // Keep the previous image. Reverting code must never restore an old database.
 run('ssh',[...ssh,remote,'set -e; cd /opt/personal-memory-hub; sudo docker image tag personal-memory-hub:server-v1 personal-memory-hub:previous; tar xzf release.tgz; sudo docker compose -f server/compose.yaml build api; sudo docker compose -f server/compose.yaml up -d api worker; curl --retry 8 --retry-connrefused --retry-delay 1 --fail --silent http://127.0.0.1:8830/health']);
 console.log('Server code updated. Run authenticated live verification against the public URL.');
}finally{await rm(dir,{recursive:true,force:true});}
