import {setTimeout as sleep} from 'node:timers/promises';
import {environment} from './runtime.mjs';
import app from './app.bundle.mjs';
process.umask(0o077);
const env=await environment();let stopping=false;
process.on('SIGTERM',()=>{stopping=true;});process.on('SIGINT',()=>{stopping=true;});
while(!stopping){
 try{await env.VECTOR_INDEX?.initialize();break;}catch{console.error('vector_initialization_retry');await sleep(10000);}
}
console.log('memory_background_started');
while(!stopping){
 try{await app.scheduled({},env);}catch{console.error('background_pass_failed');}
 // Sequential passes, durable SQL leases and vendor backoff. No daily quota.
 if(!stopping)await sleep(Number(process.env.WORKER_POLL_MS??10000));
}
env.DB.close();
