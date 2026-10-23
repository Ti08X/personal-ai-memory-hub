// Workbench API — 项目清单 + 链接凭据 + 项目上下文生成
// systemd: pw-workbench.service

import { createServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import crypto from 'node:crypto';
import {telemetry} from './telemetry.mjs';
import {intelBridge} from './intel.mjs';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const PORT = Number(process.env.PORT || 8890);
const DB_PATH = process.env.WB_DB_PATH || '/opt/pw-workbench/data/workbench.sqlite';
const KEY_PATH = process.env.WB_KEY_PATH || '/opt/pw-workbench/data/.credkey';
const ALLOWED_ORIGIN = process.env.PUBLIC_ORIGIN || 'http://localhost:8898';

/* ---------- 加密 ---------- */
function loadKey() {
  if (!existsSync(KEY_PATH)) {
    const k = crypto.randomBytes(32);
    writeFileSync(KEY_PATH, k.toString('base64'), { mode: 0o600 });
    return k;
  }
  return Buffer.from(readFileSync(KEY_PATH, 'utf8').trim(), 'base64');
}
const KEY_BUF = loadKey();
const AAD = Buffer.from('pw-workbench:cred');

function enc(plain) {
  if (!plain) return null;
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', KEY_BUF, iv);
  c.setAAD(AAD);
  const out = Buffer.concat([c.update(String(plain), 'utf8'), c.final()]);
  return [iv.toString('base64'), out.toString('base64'), c.getAuthTag().toString('base64')].join('.');
}

function dec(blob) {
  if (!blob) return '';
  try {
    const [iv, data, tag] = blob.split('.');
    const d = crypto.createDecipheriv('aes-256-gcm', KEY_BUF, Buffer.from(iv, 'base64'));
    d.setAAD(AAD);
    d.setAuthTag(Buffer.from(tag, 'base64'));
    return Buffer.concat([d.update(Buffer.from(data, 'base64')), d.final()]).toString('utf8');
  } catch { return ''; }
}

/* ---------- DB ---------- */
const db = new DatabaseSync(DB_PATH);

db.exec(`
CREATE TABLE IF NOT EXISTS items (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, category TEXT NOT NULL DEFAULT 'site',
  url TEXT NOT NULL DEFAULT '', admin_url TEXT NOT NULL DEFAULT '',
  username TEXT NOT NULL DEFAULT '', password_enc TEXT,
  note TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'active',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_items_cat ON items(category, sort_order);

CREATE TABLE IF NOT EXISTS creds (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'other',
  scope TEXT NOT NULL DEFAULT '', username TEXT NOT NULL DEFAULT '',
  password_enc TEXT, token_enc TEXT,
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS item_creds (
  item_id TEXT NOT NULL, cred_id TEXT NOT NULL,
  PRIMARY KEY (item_id, cred_id)
);
`);

/* ---------- 迁移：补充上下文相关字段 ---------- */
function addCol(table, col, def) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map(r => r.name);
  if (!cols.includes(col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`);
}
addCol('items', 'repo_url', "TEXT NOT NULL DEFAULT ''");
addCol('items', 'deploy_path', "TEXT NOT NULL DEFAULT ''");
addCol('items', 'stack', "TEXT NOT NULL DEFAULT ''");
addCol('items', 'mechanism', "TEXT NOT NULL DEFAULT ''");
addCol('items', 'potential', "TEXT NOT NULL DEFAULT ''");
addCol('items', 'thumb', "TEXT NOT NULL DEFAULT ''");

const str = (v, max = 500) => String(v ?? '').trim().slice(0, max);
const CATS = new Set(['site', 'infra', 'tool', 'idea']);
const STATUSES = new Set(['active', 'planned', 'internal', 'offline']);
const KINDS = new Set(['cloudflare', 'github', 'ssh', 'api', 'db', 'other']);

/* ---------- 响应 ---------- */
function json(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function readBody(req, limit = 128 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', c => {
      size += c.length;
      if (size > limit) { reject(new Error('payload too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); }
      catch { reject(new Error('invalid json')); }
    });
    req.on('error', reject);
  });
}

/* ---------- items ---------- */
const ITEM_COLS = 'id,name,category,url,admin_url,username,password_enc,note,status,sort_order,repo_url,deploy_path,stack,mechanism,potential,thumb,created_at,updated_at';

function itemOut(r, withSecret = false) {
  const creds = db.prepare(`SELECT c.id, c.name, c.kind FROM item_creds ic
    JOIN creds c ON c.id = ic.cred_id WHERE ic.item_id = ? ORDER BY c.name`).all(r.id);
  return {
    id: r.id, name: r.name, category: r.category,
    url: r.url, adminUrl: r.admin_url,
    username: r.username,
    password: withSecret ? dec(r.password_enc) : (r.password_enc ? '••••••••' : ''),
    hasPassword: !!r.password_enc,
    note: r.note, status: r.status, sortOrder: r.sort_order,
    repoUrl: r.repo_url, deployPath: r.deploy_path, stack: r.stack,
    mechanism: r.mechanism, potential: r.potential, thumb: r.thumb || '',
    credIds: creds.map(c => c.id),
    credRefs: creds,
    createdAt: r.created_at, updatedAt: r.updated_at,
  };
}

function validateItem(b, forUpdate = false) {
  const out = {};
  if (!forUpdate || b.name !== undefined) {
    out.name = str(b.name, 80);
    if (!out.name) throw new Error('名称必填');
  }
  if (!forUpdate || b.category !== undefined) {
    out.category = str(b.category, 16);
    if (!CATS.has(out.category)) throw new Error('分类无效');
  }
  if (b.url !== undefined) {
    out.url = str(b.url, 500);
    if (out.url && !/^(https?:\/\/|\/)/.test(out.url)) throw new Error('访问路径需以 http(s):// 或 / 开头');
  }
  if (b.adminUrl !== undefined) {
    out.adminUrl = str(b.adminUrl, 500);
    if (out.adminUrl && !/^(https?:\/\/|\/)/.test(out.adminUrl)) throw new Error('管理路径格式无效');
  }
  if (b.repoUrl !== undefined) out.repoUrl = str(b.repoUrl, 500);
  if (b.deployPath !== undefined) out.deployPath = str(b.deployPath, 300);
  if (b.stack !== undefined) out.stack = str(b.stack, 200);
  if (b.mechanism !== undefined) out.mechanism = String(b.mechanism ?? '').slice(0, 2000);
  if (b.potential !== undefined) out.potential = String(b.potential ?? '').slice(0, 1000);
  if (b.username !== undefined) out.username = str(b.username, 120);
  if (b.note !== undefined) out.note = String(b.note ?? '').slice(0, 3000);
  if (b.status !== undefined) {
    out.status = str(b.status, 16);
    if (!STATUSES.has(out.status)) throw new Error('状态无效');
  }
  if (b.sortOrder !== undefined) out.sortOrder = Number.isFinite(+b.sortOrder) ? Math.trunc(+b.sortOrder) : 0;
  if (b.password !== undefined) {
    const p = String(b.password ?? '');
    out.passwordEnc = p ? enc(p) : null;
  }
  if (b.credIds !== undefined && Array.isArray(b.credIds)) {
    out.credIds = b.credIds.filter(x => typeof x === 'string').slice(0, 20);
  }
  return out;
}

function setItemCreds(itemId, credIds) {
  db.prepare('DELETE FROM item_creds WHERE item_id = ?').run(itemId);
  const ins = db.prepare('INSERT OR IGNORE INTO item_creds (item_id, cred_id) VALUES (?, ?)');
  for (const cid of credIds) {
    if (db.prepare('SELECT id FROM creds WHERE id = ?').get(cid)) ins.run(itemId, cid);
  }
}

/* ---------- creds ---------- */
const CRED_COLS = 'id,name,kind,scope,username,password_enc,token_enc,note,created_at,updated_at';

function credOut(r, withSecret = false) {
  return {
    id: r.id, name: r.name, kind: r.kind, scope: r.scope,
    username: r.username,
    password: withSecret ? dec(r.password_enc) : (r.password_enc ? '••••••••' : ''),
    token: withSecret ? dec(r.token_enc) : (r.token_enc ? '••••••••' : ''),
    hasPassword: !!r.password_enc,
    hasToken: !!r.token_enc,
    note: r.note,
    createdAt: r.created_at, updatedAt: r.updated_at,
  };
}

function validateCred(b, forUpdate = false) {
  const out = {};
  if (!forUpdate || b.name !== undefined) {
    out.name = str(b.name, 80);
    if (!out.name) throw new Error('名称必填');
  }
  if (!forUpdate || b.kind !== undefined) {
    out.kind = str(b.kind, 16);
    if (!KINDS.has(out.kind)) throw new Error('类型无效');
  }
  if (b.scope !== undefined) out.scope = str(b.scope, 200);
  if (b.username !== undefined) out.username = str(b.username, 200);
  if (b.note !== undefined) out.note = String(b.note ?? '').slice(0, 3000);
  if (b.password !== undefined) {
    const p = String(b.password ?? '');
    out.passwordEnc = p ? enc(p) : null;
  }
  if (b.token !== undefined) {
    const t = String(b.token ?? '');
    out.tokenEnc = t ? enc(t) : null;
  }
  return out;
}

/* ---------- 上下文生成 ---------- */
const STATUS_CN = { active: '运行中', planned: '规划中', internal: '内网', offline: '已下线' };
const CAT_CN = { site: '项目', infra: '运维', tool: '工具' };
const KIND_CN = { cloudflare: 'Cloudflare', github: 'GitHub', ssh: 'SSH 服务器', api: 'API Key', db: '数据库', other: '其他' };

function buildContext(itemId) {
  const r = db.prepare(`SELECT ${ITEM_COLS} FROM items WHERE id = ?`).get(itemId);
  if (!r) return null;
  const it = itemOut(r, true);

  const lines = [];
  lines.push(`# 项目接手上下文：${it.name}`);
  lines.push('');
  lines.push(`> 由 Personal Workspace 自动生成于 ${new Date().toISOString()}`);
  lines.push('');

  lines.push('## 一、基本信息');
  lines.push('');
  lines.push(`- 项目名称：${it.name}`);
  lines.push(`- 分类：${CAT_CN[it.category] || it.category}`);
  lines.push(`- 当前状态：${STATUS_CN[it.status] || it.status}`);
  if (it.stack) lines.push(`- 技术栈：${it.stack}`);
  lines.push('');

  lines.push('## 二、访问入口');
  lines.push('');
  if (it.url) lines.push(`- 落地页：${it.url}`);
  if (it.adminUrl) lines.push(`- 管理台：${it.adminUrl}`);
  if (it.repoUrl) lines.push(`- 代码仓库：${it.repoUrl}`);
  if (it.deployPath) lines.push(`- 部署路径：${it.deployPath}`);
  if (!it.url && !it.adminUrl && !it.repoUrl && !it.deployPath) lines.push('- （未配置）');
  lines.push('');

  if (it.note) {
    lines.push('## 三、项目说明');
    lines.push('');
    lines.push(it.note);
    lines.push('');
  }

  const creds = db.prepare(`SELECT ${CRED_COLS} FROM creds c
    JOIN item_creds ic ON ic.cred_id = c.id
    WHERE ic.item_id = ? ORDER BY c.kind, c.name`).all(itemId);

  if (creds.length) {
    lines.push('## 四、访问凭据');
    lines.push('');
    lines.push('> 以下凭据仅用于本项目，请勿外传。');
    lines.push('');
    for (const c of creds) {
      const full = credOut(c, true);
      lines.push(`### ${full.name}（${KIND_CN[full.kind] || full.kind}）`);
      lines.push('');
      if (full.scope) lines.push(`- 适用范围：${full.scope}`);
      if (full.username) lines.push(`- 账号：${full.username}`);
      if (full.password) lines.push(`- 密码：${full.password}`);
      if (full.token) lines.push(`- Token / Key：${full.token}`);
      if (full.note) lines.push(`- 备注：${full.note.replace(/\n/g, ' / ')}`);
      lines.push('');
    }
  } else if (it.username || it.hasPassword) {
    lines.push('## 四、访问凭据');
    lines.push('');
    if (it.username) lines.push(`- 账号：${it.username}`);
    if (it.password) lines.push(`- 密码：${it.password}`);
    lines.push('');
  }

  lines.push('## 五、接手须知');
  lines.push('');
  lines.push('- 以上信息为项目当前快照，如有变更以实际环境为准。');
  lines.push('- 修改代码前先确认仓库与分支，部署前确认目标服务器与路径。');
  lines.push('- 涉及生产环境的操作，先备份再执行。');
  lines.push('');

  return { text: lines.join('\n'), item: it, credCount: creds.length };
}

const live = telemetry(db,{origin:ALLOWED_ORIGIN,certPath:process.env.WB_TLS_CERT_PATH});

const intel = intelBridge();

/* ---------- 路由 ---------- */
const server = createServer(async (req, res) => {
  const origin = req.headers.origin;
  if (origin === ALLOWED_ORIGIN) res.setHeader('Access-Control-Allow-Origin', origin);

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
      'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '600',
    });
    return res.end();
  }

  const url = new URL(req.url, 'http://127.0.0.1');
  const path = url.pathname;
  if(['POST','PATCH','DELETE'].includes(req.method)&&origin&&origin!==ALLOWED_ORIGIN)return json(res,403,{error:'origin_not_allowed'});
  res.once('finish',()=>live.record(req.method,path,res.statusCode));

  try {
    if(await intel(req,res,url,{json,readBody,origin:ALLOWED_ORIGIN}))return;
    if(req.method==='GET'&&path==='/api/tls')return json(res,200,live.tls());
    if(req.method==='GET'&&path==='/api/system')return json(res,200,live.system());
    if(req.method==='GET'&&path==='/api/activity')return json(res,200,live.activity());
    if(req.method==='GET'&&path==='/api/security')return json(res,200,live.security(KEY_PATH));
    if(req.method==='GET'&&path==='/api/containers')return json(res,200,await live.containers());
    /* ===== health ===== */
    if (req.method === 'GET' && path === '/api/health') {
      const i = db.prepare('SELECT COUNT(*) AS c FROM items').get().c;
      const c = db.prepare('SELECT COUNT(*) AS c FROM creds').get().c;
      return json(res, 200, { ok: true, items: i, creds: c });
    }

    /* ===== items ===== */
    if (req.method === 'GET' && path === '/api/items') {
      const rows = db.prepare(`SELECT ${ITEM_COLS} FROM items ORDER BY category, sort_order, created_at`).all();
      return json(res, 200, { items: rows.map(r => itemOut(r, false)) });
    }

    if (req.method === 'GET' && path.startsWith('/api/items/') && path.endsWith('/context')) {
      const id = decodeURIComponent(path.slice('/api/items/'.length, -'/context'.length));
      const ctx = buildContext(id);
      if (!ctx) return json(res, 404, { error: 'not found' });
      return json(res, 200, ctx);
    }

    if (req.method === 'GET' && path.startsWith('/api/items/')) {
      const id = decodeURIComponent(path.slice('/api/items/'.length));
      const r = db.prepare(`SELECT ${ITEM_COLS} FROM items WHERE id = ?`).get(id);
      if (!r) return json(res, 404, { error: 'not found' });
      return json(res, 200, itemOut(r, true));
    }

    if (req.method === 'POST' && path === '/api/items') {
      const b = await readBody(req);
      const v = validateItem(b);
      const now = new Date().toISOString();
      const id = 'itm_' + crypto.randomBytes(8).toString('hex');
      db.prepare(`INSERT INTO items (id,name,category,url,admin_url,username,password_enc,note,status,sort_order,repo_url,deploy_path,stack,mechanism,potential,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
        id, v.name, v.category, v.url ?? '', v.adminUrl ?? '', v.username ?? '',
        v.passwordEnc ?? null, v.note ?? '', v.status ?? 'active', v.sortOrder ?? 100,
        v.repoUrl ?? '', v.deployPath ?? '', v.stack ?? '',
        v.mechanism ?? '', v.potential ?? '', now, now
      );
      if (v.credIds) setItemCreds(id, v.credIds);
      const r = db.prepare(`SELECT ${ITEM_COLS} FROM items WHERE id = ?`).get(id);
      return json(res, 201, itemOut(r, false));
    }

    if (req.method === 'PATCH' && path.startsWith('/api/items/')) {
      const id = decodeURIComponent(path.slice('/api/items/'.length));
      if (!db.prepare('SELECT id FROM items WHERE id = ?').get(id)) return json(res, 404, { error: 'not found' });

      const b = await readBody(req);
      const v = validateItem(b, true);
      const map = {
        name: 'name', category: 'category', url: 'url', adminUrl: 'admin_url',
        username: 'username', passwordEnc: 'password_enc', note: 'note',
        status: 'status', sortOrder: 'sort_order',
        repoUrl: 'repo_url', deployPath: 'deploy_path', stack: 'stack',
        mechanism: 'mechanism', potential: 'potential',
      };
      const sets = [], vals = [];
      for (const [k, col] of Object.entries(map)) {
        if (v[k] !== undefined) { sets.push(`${col} = ?`); vals.push(v[k]); }
      }
      if (sets.length) {
        sets.push('updated_at = ?');
        vals.push(new Date().toISOString(), id);
        db.prepare(`UPDATE items SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
      }
      if (v.credIds) setItemCreds(id, v.credIds);

      const r = db.prepare(`SELECT ${ITEM_COLS} FROM items WHERE id = ?`).get(id);
      return json(res, 200, itemOut(r, false));
    }

    if (req.method === 'DELETE' && path.startsWith('/api/items/')) {
      const id = decodeURIComponent(path.slice('/api/items/'.length));
      db.prepare('DELETE FROM item_creds WHERE item_id = ?').run(id);
      const info = db.prepare('DELETE FROM items WHERE id = ?').run(id);
      if (!info.changes) return json(res, 404, { error: 'not found' });
      return json(res, 200, { deleted: true });
    }

    /* ===== creds ===== */
    if (req.method === 'GET' && path === '/api/creds') {
      const rows = db.prepare(`SELECT ${CRED_COLS} FROM creds ORDER BY kind, name`).all();
      return json(res, 200, { creds: rows.map(r => credOut(r, false)) });
    }

    if (req.method === 'GET' && path.startsWith('/api/creds/')) {
      const id = decodeURIComponent(path.slice('/api/creds/'.length));
      const r = db.prepare(`SELECT ${CRED_COLS} FROM creds WHERE id = ?`).get(id);
      if (!r) return json(res, 404, { error: 'not found' });
      return json(res, 200, credOut(r, true));
    }

    if (req.method === 'POST' && path === '/api/creds') {
      const b = await readBody(req);
      const v = validateCred(b);
      const now = new Date().toISOString();
      const id = 'crd_' + crypto.randomBytes(8).toString('hex');
      db.prepare(`INSERT INTO creds (id,name,kind,scope,username,password_enc,token_enc,note,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?)`).run(
        id, v.name, v.kind, v.scope ?? '', v.username ?? '',
        v.passwordEnc ?? null, v.tokenEnc ?? null, v.note ?? '', now, now
      );
      const r = db.prepare(`SELECT ${CRED_COLS} FROM creds WHERE id = ?`).get(id);
      return json(res, 201, credOut(r, false));
    }

    if (req.method === 'PATCH' && path.startsWith('/api/creds/')) {
      const id = decodeURIComponent(path.slice('/api/creds/'.length));
      if (!db.prepare('SELECT id FROM creds WHERE id = ?').get(id)) return json(res, 404, { error: 'not found' });

      const b = await readBody(req);
      const v = validateCred(b, true);
      const map = {
        name: 'name', kind: 'kind', scope: 'scope', username: 'username',
        passwordEnc: 'password_enc', tokenEnc: 'token_enc', note: 'note',
      };
      const sets = [], vals = [];
      for (const [k, col] of Object.entries(map)) {
        if (v[k] !== undefined) { sets.push(`${col} = ?`); vals.push(v[k]); }
      }
      if (!sets.length) return json(res, 400, { error: '没有可更新的字段' });
      sets.push('updated_at = ?');
      vals.push(new Date().toISOString(), id);
      db.prepare(`UPDATE creds SET ${sets.join(', ')} WHERE id = ?`).run(...vals);

      const r = db.prepare(`SELECT ${CRED_COLS} FROM creds WHERE id = ?`).get(id);
      return json(res, 200, credOut(r, false));
    }

    if (req.method === 'DELETE' && path.startsWith('/api/creds/')) {
      const id = decodeURIComponent(path.slice('/api/creds/'.length));
      db.prepare('DELETE FROM item_creds WHERE cred_id = ?').run(id);
      const info = db.prepare('DELETE FROM creds WHERE id = ?').run(id);
      if (!info.changes) return json(res, 404, { error: 'not found' });
      return json(res, 200, { deleted: true });
    }

    return json(res, 404, { error: 'not found' });
  } catch (e) {
    const msg = e.message || 'server error';
    const code = /必填|无效|格式|开头/.test(msg) ? 400 : 500;
    return json(res, code, { error: msg });
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`workbench api listening on 127.0.0.1:${PORT}`);
});
