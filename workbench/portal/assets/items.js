// ============================================================
// items.js — 项目清单 CRUD + 卡片直显凭据 + 一键复制
// 依赖 workbench.js 暴露的 window.WB { $, $$, esc, go }
// ============================================================

(function () {
  const WB = window.WB;
  const $ = WB.$, $$ = WB.$$, esc = WB.esc;
  const API = '/api/wb';

  const CAT_LABEL = { site: '项目', infra: '运维', tool: '工具' };
  const STATUS_LABEL = { active: '运行中', planned: '规划中', internal: '内网', offline: '已下线' };
  const STATUS_CLASS = { active: 'ok', planned: 'plan', internal: 'mute', offline: 'warn' };
  const ICON_BY_CAT = { site: 'i-globe', infra: 'i-server', tool: 'i-wrench' };

  let itemCache = [];
  let editingId = null;

  async function wbFetch(path, opts = {}) {
    const r = await fetch(API + path, {
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json' },
      ...opts,
    });
    const text = await r.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = null; }
    if (!r.ok) throw new Error((data && data.error) || ('HTTP ' + r.status));
    return data;
  }

  /* ================= 复制 ================= */
  async function copyText(text, btn) {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // 回退：老浏览器 / 非安全上下文
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); } catch {}
      document.body.removeChild(ta);
    }
    if (btn) {
      const orig = btn.dataset.label || btn.textContent;
      btn.dataset.label = orig;
      btn.classList.add('is-copied');
      btn.textContent = '已复制';
      setTimeout(() => {
        btn.classList.remove('is-copied');
        btn.textContent = orig;
      }, 1200);
    }
  }

  /* ================= 卡片渲染 ================= */
  function credRow(label, value, kind, opts = {}) {
    const hasPw = opts.hasPw;
    if (!value && !hasPw) return '';

    const isPw = kind === 'password';
    const shown = isPw ? '••••••••' : value;
    const safe = esc(value || '');
    const pending = isPw && !value;

    return `<div class="kv-row">
      <span class="kv-k">${label}</span>
      <button class="kv-v kv-copy${isPw ? ' is-masked' : ''}${pending ? ' is-pending' : ''}"
              data-copy="${safe}" data-kind="${kind}" data-item-id="${opts.id || ''}"
              title="点击复制">
        <span class="kv-txt">${esc(shown)}</span>
        <svg class="kv-ico" viewBox="0 0 24 24"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a1.5 1.5 0 0 1-1.5-1.5v-9A1.5 1.5 0 0 1 4 3h9A1.5 1.5 0 0 1 14.5 4.5V5"/></svg>
      </button>
    </div>`;
  }

  function linkRow(label, url, extraClass) {
    if (!url) return '';
    const shown = url.replace(/^https?:\/\//, '');
    return `<div class="kv-row">
      <span class="kv-k">${label}</span>
      <a class="kv-v kv-link ${extraClass || ''}" href="${esc(url)}" target="_blank" rel="noopener" title="${esc(url)}">
        <span class="kv-txt">${esc(shown)}</span>
        <svg class="kv-ico" viewBox="0 0 24 24"><path d="M7 17 17 7M9 7h8v8"/></svg>
      </a>
    </div>`;
  }

  function tileFromItem(it) {
    const cls = STATUS_CLASS[it.status] || '';
    const icon = ICON_BY_CAT[it.category] || 'i-globe';

    return `<div class="tile" data-item="${it.id}">
      <div class="tile-top">
        <div class="tile-ico"><svg><use href="#${icon}"/></svg></div>
        <span class="tile-pill ${cls}">${STATUS_LABEL[it.status] || it.status}</span>
      </div>

      <h4>${esc(it.name)}</h4>

      <div class="kv-list">
        ${linkRow('落地页', it.url)}
        ${linkRow('管理台', it.adminUrl)}
        ${credRow('账户', it.username, 'username', { id: it.id })}
        ${credRow('密码', it.passwordPlain || '', 'password', { id: it.id, hasPw: it.hasPassword })}
        ${it.note ? `<div class="kv-row kv-note"><span class="kv-k">说明</span><span class="kv-v kv-plain">${esc(it.note)}</span></div>` : ''}
      </div>

      <div class="tile-ops">
        <button class="op-btn op-ctx" data-act="ctx" title="复制项目上下文"><svg><use href="#i-clipboard"/></svg></button>
        <button class="op-btn" data-act="edit" title="编辑"><svg><use href="#i-pencil"/></svg></button>
        <button class="op-btn op-del" data-act="del" title="删除"><svg><use href="#i-trash"/></svg></button>
      </div>
    </div>`;
  }

  function snapFromItem(it) {
    const live = !!it.url;
    const cls = STATUS_CLASS[it.status] || '';
    const icon = ICON_BY_CAT[it.category] || 'i-globe';
    const href = it.url || it.adminUrl || '#';
    return `<a class="snap-row" href="${esc(href)}" ${live ? 'target="_blank" rel="noopener"' : 'onclick="return false" style="cursor:default"'}>
      <span class="snap-ico"><svg><use href="#${icon}"/></svg></span>
      <span class="snap-name">${esc(it.name)}</span>
      <span class="snap-group">${CAT_LABEL[it.category] || it.category}</span>
      <span class="snap-state ${cls}">${STATUS_LABEL[it.status] || it.status}</span>
    </a>`;
  }

  /* ================= 事件绑定 ================= */
  function bindTileEvents(scope) {
    scope.querySelectorAll('[data-act]').forEach(b => {
      b.addEventListener('click', ev => {
        ev.preventDefault();
        ev.stopPropagation();
        const id = b.closest('[data-item]').dataset.item;
        if (b.dataset.act === 'edit') openDialog(id);
        else if (b.dataset.act === 'ctx') copyContext(id, b);
        else deleteItem(id);
      });
    });

    scope.querySelectorAll('.kv-copy').forEach(b => {
      b.addEventListener('click', async ev => {
        ev.preventDefault();
        ev.stopPropagation();
        const txt = b.querySelector('.kv-txt');
        let val = b.dataset.copy || '';

        // 密码尚未水合：当场拉取再复制
        if (!val && b.dataset.kind === 'password' && b.dataset.itemId) {
          const orig = txt.textContent;
          txt.textContent = '读取中…';
          try {
            const d = await wbFetch('/items/' + encodeURIComponent(b.dataset.itemId));
            val = d.password || '';
            b.dataset.copy = val;
            const cached = itemCache.find(x => x.id === b.dataset.itemId);
            if (cached) cached.passwordPlain = val;
          } catch {
            txt.textContent = '读取失败';
            setTimeout(() => txt.textContent = orig, 1200);
            return;
          }
          txt.textContent = '••••••••';
        }

        if (!val) {
          txt.textContent = '空';
          setTimeout(() => txt.textContent = '••••••••', 1000);
          return;
        }
        await copyText(val, txt);
      });
    });

    // 密码行：双击临时显示明文
    scope.querySelectorAll('.kv-copy[data-kind="password"]').forEach(b => {
      const txt = b.querySelector('.kv-txt');
      if (!txt) return;
      let revealed = false;
      b.addEventListener('dblclick', async ev => {
        ev.preventDefault();
        revealed = !revealed;
        if (revealed) {
          let val = b.dataset.copy || '';
          if (!val && b.dataset.itemId) {
            try {
              const d = await wbFetch('/items/' + encodeURIComponent(b.dataset.itemId));
              val = d.password || '';
              b.dataset.copy = val;
            } catch {}
          }
          txt.textContent = val || '（空）';
        } else {
          txt.textContent = '••••••••';
        }
        b.classList.toggle('is-masked', !revealed);
      });
    });
  }

  function renderAll() {
    const byCat = { site: [], infra: [], tool: [] };
    for (const it of itemCache) (byCat[it.category] || byCat.site).push(it);

    const put = (sel, arr, empty) => {
      const el = $(sel);
      if (!el) return;
      el.innerHTML = arr.length
        ? arr.map(tileFromItem).join('')
        : `<div class="tile-empty">${empty}</div>`;
      bindTileEvents(el);
    };

    put('#projectGrid', byCat.site, '还没有项目。点右上角「新增项目」开始。');
    put('#infraGrid', byCat.infra, '没有运维条目。');
    put('#toolGrid', byCat.tool, '没有工具条目。');

    const snap = $('#overviewAssets');
    if (snap) snap.innerHTML = itemCache.length
      ? itemCache.map(snapFromItem).join('')
      : '<div class="feed-empty">清单为空</div>';
  }

  async function loadItems() {
    try {
      const d = await wbFetch('/items');
      itemCache = d.items || [];
      renderAll();
      // 后台异步补齐明文密码，用于一键复制（不阻塞渲染）
      hydratePasswords();
    } catch (e) {
      ['#projectGrid', '#infraGrid', '#toolGrid'].forEach(sel => {
        const el = $(sel);
        if (el) el.innerHTML = `<div class="tile-empty">清单接口不可用：${esc(e.message)}</div>`;
      });
    }
  }

  async function hydratePasswords() {
    const need = itemCache.filter(it => it.hasPassword && !it.passwordPlain);
    for (const it of need) {
      try {
        const d = await wbFetch('/items/' + encodeURIComponent(it.id));
        it.passwordPlain = d.password || '';
        // 只更新对应卡片的复制按钮，不整页重渲染
        const btn = document.querySelector(`[data-item="${it.id}"] .kv-copy[data-kind="password"]`);
        if (btn) btn.dataset.copy = it.passwordPlain;
      } catch {}
    }
  }

  /* ================= 弹窗 ================= */
  function dialog() {
    let d = $('#itemDialog');
    if (d) return d;

    d = document.createElement('div');
    d.id = 'itemDialog';
    d.className = 'dialog';
    d.innerHTML = `
      <div class="dialog-box">
        <div class="dialog-head">
          <h3 id="dlgTitle">新增项目</h3>
          <button class="dialog-x" id="dlgClose"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg></button>
        </div>
        <div class="dialog-body">
          <label class="field"><span>名称 *</span><input id="f_name" maxlength="80" placeholder="例如 work-demo"></label>
          <label class="field"><span>分类 *</span>
            <select id="f_category">
              <option value="site">项目</option>
              <option value="infra">运维</option>
              <option value="tool">工具</option>
            </select>
          </label>
          <label class="field"><span>落地页</span><input id="f_url" maxlength="500" placeholder="https://example.com 或 /console"></label>
          <label class="field"><span>管理台</span><input id="f_adminUrl" maxlength="500" placeholder="https://example.com/admin"></label>
          <div class="field-row">
            <label class="field"><span>账户</span><input id="f_username" maxlength="120" autocomplete="off"></label>
            <label class="field"><span>密码</span><input id="f_password" type="text" maxlength="200" autocomplete="new-password" placeholder="留空则不修改"></label>
          </div>
          <label class="field"><span>代码仓库</span><input id="f_repoUrl" maxlength="500" placeholder="https://github.com/user/repo"></label>
          <div class="field-row">
            <label class="field"><span>部署路径</span><input id="f_deployPath" maxlength="300" placeholder="/opt/xxx 或 /var/www/xxx"></label>
            <label class="field"><span>技术栈</span><input id="f_stack" maxlength="200" placeholder="Node 22 + SQLite + Nginx"></label>
          </div>
          <label class="field">
            <span>说明 <em class="field-hint">支持多行，一行一个 tab</em></span>
            <textarea id="f_note" maxlength="3000" rows="4" placeholder="工作台说明&#10;第二行说明&#10;第三行说明"></textarea>
          </label>
          <label class="field">
            <span>关联凭据 <em class="field-hint">勾选后生成上下文时自动带出</em></span>
            <div class="cred-picker" id="f_credPicker"></div>
          </label>
          <div class="field-row">
            <label class="field"><span>状态</span>
              <select id="f_status">
                <option value="active">运行中</option>
                <option value="planned">规划中</option>
                <option value="internal">内网</option>
                <option value="offline">已下线</option>
              </select>
            </label>
            <label class="field"><span>排序</span><input id="f_sortOrder" type="number" value="100"></label>
          </div>
          <p class="dialog-err" id="dlgErr"></p>
        </div>
        <div class="dialog-foot">
          <button class="btn btn-ghost" id="dlgCancel">取消</button>
          <button class="btn btn-accent" id="dlgSave">保存</button>
        </div>
      </div>`;
    document.body.appendChild(d);

    d.addEventListener('click', e => { if (e.target.id === 'itemDialog') closeDialog(); });
    $('#dlgClose').addEventListener('click', closeDialog);
    $('#dlgCancel').addEventListener('click', closeDialog);
    $('#dlgSave').addEventListener('click', saveItem);


    return d;
  }

  function openDialog(id = null) {
    dialog();
    editingId = id;
    $('#dlgErr').textContent = '';

    if (id) {
      const it = itemCache.find(x => x.id === id);
      if (!it) return;
      $('#dlgTitle').textContent = '编辑项目';
      $('#f_name').value = it.name || '';
      $('#f_category').value = it.category || 'site';
      $('#f_url').value = it.url || '';
      $('#f_adminUrl').value = it.adminUrl || '';
      $('#f_username').value = it.username || '';
      $('#f_password').value = '';
      $('#f_password').placeholder = it.hasPassword ? '已设置，留空则不修改' : '留空则不设置';
      $('#f_repoUrl').value = it.repoUrl || '';
      $('#f_deployPath').value = it.deployPath || '';
      $('#f_stack').value = it.stack || '';
      $('#f_note').value = it.note || '';
      $('#f_status').value = it.status || 'active';
      $('#f_sortOrder').value = it.sortOrder ?? 100;
      renderCredPicker(it.credIds || []);
    } else {
      $('#dlgTitle').textContent = '新增项目';
      ['f_name', 'f_url', 'f_adminUrl', 'f_username', 'f_password', 'f_note', 'f_repoUrl', 'f_deployPath', 'f_stack']
        .forEach(k => { $('#' + k).value = ''; });
      renderCredPicker([]);
      $('#f_category').value = 'site';
      $('#f_status').value = 'active';
      $('#f_sortOrder').value = 100;
      $('#f_password').placeholder = '留空则不设置';
    }

    $('#itemDialog').classList.add('is-open');
    setTimeout(() => $('#f_name').focus(), 60);
  }

  function closeDialog() {
    const d = $('#itemDialog');
    if (d) d.classList.remove('is-open');
    editingId = null;
  }

  /* ================= 凭据选择器 ================= */
  function renderCredPicker(selected) {
    const box = $('#f_credPicker');
    if (!box) return;
    const creds = (window.WBCreds && window.WBCreds.list()) || [];
    if (!creds.length) {
      box.innerHTML = '<div class="picker-empty">还没有凭据。先去左侧「链接凭据」新增。</div>';
      return;
    }
    const KIND_CN = { cloudflare: 'Cloudflare', github: 'GitHub', ssh: 'SSH', api: 'API Key', db: '数据库', other: '其他' };
    box.innerHTML = creds.map(c => `
      <label class="picker-row">
        <input type="checkbox" value="${c.id}" ${selected.includes(c.id) ? 'checked' : ''}>
        <span class="picker-name">${esc(c.name)}</span>
        <span class="picker-kind">${KIND_CN[c.kind] || c.kind}</span>
      </label>`).join('');
  }

  async function saveItem() {
    const err = $('#dlgErr');
    err.textContent = '';

    const name = $('#f_name').value.trim();
    if (!name) { err.textContent = '名称必填'; return; }

    const payload = {
      name,
      category: $('#f_category').value,
      url: $('#f_url').value.trim(),
      adminUrl: $('#f_adminUrl').value.trim(),
      username: $('#f_username').value.trim(),
      note: $('#f_note').value,          // 保留换行
      status: $('#f_status').value,
      sortOrder: parseInt($('#f_sortOrder').value, 10) || 0,
      repoUrl: $('#f_repoUrl').value.trim(),
      deployPath: $('#f_deployPath').value.trim(),
      stack: $('#f_stack').value.trim(),
      credIds: Array.from(document.querySelectorAll('#f_credPicker input[type=checkbox]:checked'))
        .map(x => x.value),
    };

    const pw = $('#f_password').value;
    if (pw) payload.password = pw;
    else if (!editingId) payload.password = '';

    const btn = $('#dlgSave');
    btn.disabled = true;
    btn.textContent = '保存中…';

    try {
      if (editingId) {
        await wbFetch('/items/' + encodeURIComponent(editingId), {
          method: 'PATCH', body: JSON.stringify(payload),
        });
      } else {
        await wbFetch('/items', { method: 'POST', body: JSON.stringify(payload) });
      }
      closeDialog();
      await loadItems();
    } catch (e) {
      err.textContent = e.message;
    } finally {
      btn.disabled = false;
      btn.textContent = '保存';
    }
  }

  /* ================= 复制项目上下文 ================= */
  async function copyContext(id, btn) {
    const orig = btn.innerHTML;
    btn.innerHTML = '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" stroke-dasharray="4 4"/></svg>';
    btn.disabled = true;
    try {
      const r = await fetch(API + '/items/' + encodeURIComponent(id) + '/context', { cache: 'no-store' });
      const text = await r.text();
      if (!r.ok) {
        let msg = 'HTTP ' + r.status;
        try { msg = JSON.parse(text).error || msg; } catch {}
        throw new Error(msg);
      }
      const d = JSON.parse(text);
      await navigator.clipboard.writeText(d.text);
      btn.classList.add('is-copied');
      btn.innerHTML = '<svg viewBox="0 0 24 24"><path d="m5 13 4 4L19 7"/></svg>';
      setTimeout(() => {
        btn.classList.remove('is-copied');
        btn.innerHTML = orig;
        btn.disabled = false;
      }, 1400);
    } catch (e) {
      btn.innerHTML = orig;
      btn.disabled = false;
      alert('生成上下文失败：' + e.message);
    }
  }

  async function deleteItem(id) {
    const it = itemCache.find(x => x.id === id);
    if (!confirm(`删除「${it ? it.name : '该项'}」？此操作不可撤销。`)) return;
    try {
      await wbFetch('/items/' + encodeURIComponent(id), { method: 'DELETE' });
      await loadItems();
    } catch (e) {
      alert('删除失败：' + e.message);
    }
  }

  /* ================= 启动 ================= */
  function boot() {
    $$('[data-new-item]').forEach(b =>
      b.addEventListener('click', () => openDialog(null)));
    loadItems();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  window.WBItems = { reload: loadItems, open: openDialog };
})();
