// Offline validation only; no personal payloads, password material or model keys
// are emitted. Run before background processing changes the copied snapshot.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {Vault} from './core.bundle.mjs';
const db=new DatabaseSync(process.env.DATABASE_PATH,{readOnly:true}),vault=new Vault(process.env.ENCRYPTION_KEY),manifest=JSON.parse(readFileSync(process.argv[2],'utf8'));
assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check,'ok');assert.equal(db.prepare('PRAGMA foreign_key_check').all().length,0);
const sortedJson=value=>JSON.stringify(value);
// Python manifests use Unicode JSON with compact separators; object columns are
// all SQLite scalars. Preserve SELECT column order to compare full ciphertext rows.
for(const [table,count] of Object.entries(manifest.counts)){
 if(!/^[a-z_]+$/.test(table))throw new Error('Invalid backup table');
 const stmt=db.prepare('SELECT * FROM '+table);stmt.setReturnArrays(true);const rows=stmt.all();assert.equal(rows.length,count);
 const digest=createHash('sha256').update(rows.map(sortedJson).sort().join('\n')).digest('hex');assert.equal(digest,manifest.table_sha256[table],'Restored table differs: '+table);
}
let verified=0;
async function check(table,column,aad){for(const row of db.prepare('SELECT * FROM '+table).all()){if(row[column]){await vault.open(row[column],aad(row));verified++;}}}
await check('records','payload_cipher',r=>r.owner_id+':'+r.id);
await check('record_versions','payload_cipher',r=>r.owner_id+':'+r.record_id);
await check('conflicts','payload_cipher',r=>r.owner_id+':'+r.record_id);
await check('conversations','title_cipher',r=>r.owner_id+':'+r.id);
await check('import_batches','payload_cipher',r=>r.owner_id+':'+r.id);
await check('dashboard_auth','totp_cipher',()=> 'dashboard-totp-v1');
await check('model_settings','payload_cipher',r=>r.owner_id+':model-settings');
await check('memory_classifications','payload_cipher',r=>r.owner_id+':digest:'+r.record_id+':'+r.source_version);
await check('memory_overview_state','payload_cipher',r=>r.owner_id+':overview:'+r.revision);
await check('memory_overview_versions','payload_cipher',r=>r.owner_id+':overview:'+r.revision);
await check('strategy_state','draft_cipher',r=>r.owner_id+':strategy:draft:'+r.draft_version);
await check('strategy_state','published_cipher',r=>r.owner_id+':strategy:published:'+r.published_version);
await check('strategy_versions','payload_cipher',r=>r.owner_id+':strategy:published:'+r.version);
await check('library_labels','payload_cipher',r=>r.owner_id+':labels:'+r.record_id);
await check('library_scopes','title_cipher',r=>r.owner_id+':scope-title:'+r.id);
await check('library_scopes','payload_cipher',r=>r.owner_id+':scope:'+r.id+':'+r.revision);
await check('library_scopes','work_cipher',r=>r.owner_id+':scope-work:'+r.id);
const owners=new Map(db.prepare('SELECT id,owner_id FROM library_scopes').all().map(r=>[r.id,r.owner_id]));
await check('library_summary_versions','payload_cipher',r=>owners.get(r.scope_id)+':scope:'+r.scope_id+':'+r.revision);
console.log(JSON.stringify({migration:'verified',integrity:'ok',tables_compared:Object.keys(manifest.counts).length,encrypted_payloads_verified:verified,counts:manifest.counts}));db.close();
