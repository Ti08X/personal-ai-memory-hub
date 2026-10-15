import {spawnSync} from 'node:child_process';
import {mkdir,writeFile,chmod,readFile,readdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {options} from './lib.mjs';
const args=options();if(!args.output)throw new Error('--output private-directory is required');
const dir=resolve(args.output);await mkdir(dir,{recursive:true,mode:0o700});await chmod(dir,0o700);
const candidates=['clients','records','record_versions','conflicts','conversations','import_batches','audit_log','record_evidence','dashboard_auth','dashboard_recovery_codes','model_usage','model_settings','memory_classifications','memory_overview_state','memory_overview_versions','strategy_state','strategy_versions'];
const metadata=spawnSync(process.execPath,['node_modules/wrangler/bin/wrangler.js','d1','execute','personal-ai-memory-hub','--remote','--json','--command',"SELECT name FROM sqlite_master WHERE type='table'; SELECT name FROM d1_migrations ORDER BY id;"],{encoding:'utf8',maxBuffer:8*1024*1024});
if(metadata.status!==0)throw new Error('Could not inspect backup schema');
const inspected=JSON.parse(metadata.stdout),present=new Set(inspected[0].results.map(x=>x.name));
const tables=candidates.filter(x=>present.has(x));
const applied=new Set(inspected[1].results.map(x=>x.name));
for(const table of tables) {
 const target=resolve(dir,table+'.sql');await writeFile(target,'',{mode:0o600});await chmod(target,0o600);
 // Wrangler prints a temporary signed download URL: capture it privately, never echo it.
 const run=spawnSync(process.execPath,['node_modules/wrangler/bin/wrangler.js','d1','export','personal-ai-memory-hub','--remote','--table',table,'--output',target],{encoding:'utf8',maxBuffer:8*1024*1024});
 const log=resolve(dir,table+'.private.log');await writeFile(log,(run.stdout??'')+(run.stderr??''),{mode:0o600});await chmod(log,0o600);
 if(run.status!==0)throw new Error('Backup failed for '+table+'. Inspect the private local log without sharing signed URLs.');
 console.log('Encrypted-table backup saved: '+table);
}
const migrations=(await readdir('migrations')).filter(x=>x.endsWith('.sql')&&applied.has(x)).sort();
if(migrations.length!==applied.size)throw new Error('An applied migration is missing locally');
const schema=await Promise.all(migrations.map(x=>readFile(resolve('migrations',x),'utf8')));
await writeFile(resolve(dir,'schema.sql'),schema.join('\n'),{mode:0o600});
await writeFile(resolve(dir,'manifest.json'),JSON.stringify({created_at:new Date().toISOString(),tables,migrations,skipped_not_present:candidates.filter(x=>!present.has(x)),omitted:['FTS virtual index (rebuild from records.search_tokens)','ephemeral rate_limits','ephemeral dashboard_sessions and authentication challenges (users log in again after restore)','rag_chunks and external vectors (rebuild from encrypted originals)','rag_jobs (enqueue all current records again after restore)'],requires_same_encryption_key:true,restore_not_automated:true},null,2)+'\n',{mode:0o600});
console.log('Backup complete. Keep the master key separately; see docs/security.md for restoration boundaries.');
