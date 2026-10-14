import {spawn} from 'node:child_process';
import {resolve} from 'node:path';
import {options} from './lib.mjs';
import './build-ui.mjs';
const args=options(),dir=resolve(args['credential-dir']??'../../work/memory-hub-private');
const child=spawn(process.execPath,['node_modules/wrangler/bin/wrangler.js','dev','--host','localhost','--port',String(args.port??8790),'--env-file',resolve(dir,'worker.env')],{stdio:'inherit'});
process.on('SIGINT',()=>child.kill('SIGINT'));process.on('SIGTERM',()=>child.kill('SIGTERM'));
child.on('exit',code=>process.exitCode=code??1);
