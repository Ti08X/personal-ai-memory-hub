import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { readFile, writeFile, mkdir, chmod } from 'node:fs/promises';
import { resolve } from 'node:path';

// Secrets never go to stdout. Run once per installation; preserve this file for recovery.
const dir = resolve(process.argv[2] ?? '../../work/memory-hub-private');
await mkdir(dir, { recursive: true, mode: 0o700 });
await chmod(dir, 0o700);
const file = resolve(dir, 'credentials.json');
let credentials;
try { credentials = JSON.parse(await readFile(file, 'utf8')); }
catch (e) {
 if (e.code !== 'ENOENT') throw e;
 const standard = ['memory:read', 'memory:write', 'conversation:import'];
 const permissions = { admin: [...standard, 'sensitive:read', 'sensitive:write', 'admin'], codex: standard, antigravity: standard, reader: ['memory:read'], outsider: [...standard, 'admin'] };
 const created_at = new Date().toISOString();
 credentials = { endpoint: 'http://localhost:8790', encryption_key: randomBytes(32).toString('base64'), clients: {} };
 for (const [name, scopes] of Object.entries(permissions)) credentials.clients[name] = {
  id: randomUUID(), owner_id: name === 'outsider' ? 'integration-test-other-owner' : 'personal-owner',
  token: 'pmh_' + randomBytes(32).toString('hex'), scopes, created_at,
  expires_at: new Date(Date.now() + 90 * 86400000).toISOString()
 };
 await writeFile(file, JSON.stringify(credentials, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
}
const quote = value => "'" + String(value).replaceAll("'", "''") + "'";
const sql = Object.entries(credentials.clients).map(([name,c]) => {
 const hash = createHash('sha256').update(c.token).digest('hex');
 return 'INSERT OR IGNORE INTO clients(id,owner_id,name,token_hash,scopes,created_at,expires_at) VALUES(' + [c.id,c.owner_id,name,hash,JSON.stringify(c.scopes),c.created_at,c.expires_at].map(quote).join(',') + ');';
}).join('\n');
await writeFile(resolve(dir,'bootstrap.sql'), sql + '\n', {mode:0o600});
await writeFile(resolve(dir,'worker-secrets.json'), JSON.stringify({ENCRYPTION_KEY:credentials.encryption_key}), {mode:0o600});
await writeFile(resolve(dir,'worker.env'), 'ENCRYPTION_KEY=' + credentials.encryption_key + '\n', {mode:0o600});
console.log('Bootstrap files are ready. Secrets remain in the private directory. Existing credentials were preserved.');
