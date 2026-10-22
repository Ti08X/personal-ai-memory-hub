// ============================================================
// credentials.js — 链接凭据库（Cloudflare / GitHub / SSH / 其他）
// 独立于项目清单，可在侧边栏管理；生成项目上下文时按需引用
// 依赖 workbench.js 暴露的 window.WB { $, $$, esc }
// ============================================================

(function () {
  const WB = window.WB;
  const $ = WB.$, $$ = WB.$$, esc = WB.esc;
  const API = '/api/wb';

  const KIND_LABEL = {
    cloudflare: 'Cloudflare',
    github: 'GitHub',
    ssh: 'SSH 服务器',
    api: 'API Key',
    db: '数据库',
    other: '其他',
  };
  const KIND_ICON = {
    cloudflare: 'i-cloud',
    github: 'i-github',
    ssh: 'i-terminal',
    api: 'i-key',
    db: 'i-database',
    other: 'i-folder',
  };

  let credCache = [];
  let editingId = null;

  async function api(path, opts = {}) {
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

  /* ================= 渲染 ================= */
  function credRow(c) {
    const kind = KIND_LABEL[c.kind] || c.kind;
    const icon = KIND_ICON[c.kind] || 'i-key';
    return `<div class="cred-item" data-cred="${c.id}">
      <div class="cred-head">
        <span class="cred-ico"><svg><use href="#${icon}"/></svg></span>
        <span class="cred-name">${esc(c.name)}</span>
        <span class="cred-kind">${esc(kind)}</span>
        <button class="op-btn" data-cact="edit" title="编辑"><svg><use href="#i-pencil"/></svg></button>
        <button class="op-btn op-del" data-cact="del" title="删除"><svg><use href="#i-trash"/></svg></button>
      </div>
      ${c.scope ? `<div class="cred-meta">适用范围：${esc(c.scope)}</div>` : ''}
      ${c.note ? `<div class="cred-meta">${esc(c.note)}</div>` : ''}
    </div>`;
  }

  function renderCreds() {
    const box = $('#credList');
    if (!box) return;
    box.innerHTML = credCache.length
      ? credCache.map(credRow).join('')
      : '<div class="tile-empty">还没有凭据。点上方「新增凭据」添加 Cloudflare / GitHub / SSH 等访问信息。</div>';

    box.querySelectorAll('[data-cact]').forEach(b => {
      b.addEventListener('click', ev => {
        ev.preventDefault();
        ev.stopPropagation();
        const id = b.closest('[data-cred]').dataset.cred;
        if (b.dataset.cact === 'edit') openCredDialog(id);
        else deleteCred(id);
      });
    });
  }

  async function loadCreds() {
    try {
      const d = await api('/creds');
      credCache = d.creds || [];
      renderCreds();
    } catch (e) {
      const box = $('#credList');
      if (box) box.innerHTML = `<div class="tile-empty">凭据接口不可用：${esc(e.message)}</div>`;
    }
  }

  /* ================= 弹窗 ================= */
  function credDialog() {
    let d = $('#credDialog');
    if (d) return d;

    const kindOpts = Object.entries(KIND_LABEL)
      .map(([v, l]) => `<option value="${v}">${l}</option>`).join('');

    d = document.createElement('div');
    d.id = 'credDialog';
    d.className = 'dialog';
    d.innerHTML = `
      <div class="dialog-box">
        <div class="dialog-head">
          <h3 id="credTitle">新增凭据</h3>
          <button class="dialog-x" id="credClose"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg></button>
        </div>
        <div class="dialog-body">
          <label class="field"><span>名称 *</span><input id="c_name" maxlength="80" placeholder="例如 Cloudflare 主账号"></label>
          <label class="field"><span>类型 *</span><select id="c_kind">${kindOpts}</select></label>
          <label class="field"><span>适用范围</span><input id="c_scope" maxlength="200" placeholder="例如 files.example.com / example.com 全部域名"></label>
          <div class="field-row">
            <label class="field"><span>账号 / 用户名</span><input id="c_username" maxlength="200" autocomplete="off" placeholder="邮箱或用户名"></label>
            <label class="field"><span>密码</span><input id="c_password" type="text" maxlength="400" autocomplete="new-password" placeholder="留空则不修改"></label>
          </div>
          <label class="field">
            <span>Token / API Key <em class="field-hint">留空则不修改</em></span>
            <textarea id="c_token" rows="2" maxlength="2000" placeholder="Cloudflare API Token / GitHub PAT / 私钥路径等"></textarea>
          </label>
          <label class="field">
            <span>备注 / 其他信息</span>
            <textarea id="c_note" rows="3" maxlength="2000" placeholder="例如：SSH 使用 ~/.ssh/lightsail_singapore.pem&#10;服务器 192.0.2.10 用户 ubuntu"></textarea>
          </label>
          <p class="dialog-err" id="credErr"></p>
        </div>
        <div class="dialog-foot">
          <button class="btn btn-ghost" id="credCancel">取消</button>
          <button class="btn btn-accent" id="credSave">保存</button>
        </div>
      </div>`;
    document.body.appendChild(d);

    d.addEventListener('click', e => { if (e.target.id === 'credDialog') closeCredDialog(); });
    $('#credClose').addEventListener('click', closeCredDialog);
    $('#credCancel').addEventListener('click', closeCredDialog);
    $('#credSave').addEventListener('click', saveCred);
    return d;
  }

  function openCredDialog(id = null) {
    credDialog();
    editingId = id;
    $('#credErr').textContent = '';

    if (id) {
      const c = credCache.find(x => x.id === id);
      if (!c) return;
      $('#credTitle').textContent = '编辑凭据';
      $('#c_name').value = c.name || '';
      $('#c_kind').value = c.kind || 'other';
      $('#c_scope').value = c.scope || '';
      $('#c_username').value = c.username || '';
      $('#c_password').value = '';
      $('#c_password').placeholder = c.hasPassword ? '已设置，留空则不修改' : '留空则不设置';
      $('#c_token').value = '';
      $('#c_token').placeholder = c.hasToken ? '已设置，留空则不修改' : '留空则不设置';
      $('#c_note').value = c.note || '';
    } else {
      $('#credTitle').textContent = '新增凭据';
      ['c_name', 'c_scope', 'c_username', 'c_password', 'c_token', 'c_note']
        .forEach(k => { $('#' + k).value = ''; });
      $('#c_kind').value = 'other';
      $('#c_password').placeholder = '留空则不设置';
      $('#c_token').placeholder = '留空则不设置';
    }

    $('#credDialog').classList.add('is-open');
    setTimeout(() => $('#c_name').focus(), 60);
  }

  function closeCredDialog() {
    const d = $('#credDialog');
    if (d) d.classList.remove('is-open');
    editingId = null;
  }

  async function saveCred() {
    const err = $('#credErr');
    err.textContent = '';

    const name = $('#c_name').value.trim();
    if (!name) { err.textContent = '名称必填'; return; }

    const payload = {
      name,
      kind: $('#c_kind').value,
      scope: $('#c_scope').value.trim(),
      username: $('#c_username').value.trim(),
      note: $('#c_note').value,
    };

    const pw = $('#c_password').value;
    if (pw) payload['password'] = String(pw);
    else if (!editingId) payload.password = '';

    const tk = $('#c_token').value;
    if (tk) payload['token'] = String(tk);
    else if (!editingId) payload.token = '';

    const btn = $('#credSave');
    btn.disabled = true;
    btn.textContent = '保存中…';

    try {
      if (editingId) {
        await api('/creds/' + encodeURIComponent(editingId), {
          method: 'PATCH', body: JSON.stringify(payload),
        });
      } else {
        await api('/creds', { method: 'POST', body: JSON.stringify(payload) });
      }
      closeCredDialog();
      await loadCreds();
      if (window.WBItems) window.WBItems.reload();
    } catch (e) {
      err.textContent = e.message;
    } finally {
      btn.disabled = false;
      btn.textContent = '保存';
    }
  }

  async function deleteCred(id) {
    const c = credCache.find(x => x.id === id);
    if (!confirm(`删除凭据「${c ? c.name : '该项'}」？使用它的项目上下文将不再包含此凭据。`)) return;
    try {
      await api('/creds/' + encodeURIComponent(id), { method: 'DELETE' });
      await loadCreds();
      if (window.WBItems) window.WBItems.reload();
    } catch (e) {
      alert('删除失败：' + e.message);
    }
  }

  function boot() {
    $$('[data-new-cred]').forEach(b =>
      b.addEventListener('click', () => openCredDialog(null)));
    loadCreds();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  window.WBCreds = {
    reload: loadCreds,
    list: () => credCache,
    /** 取某条凭据的完整信息（含明文 token / 密码），用于生成上下文 */
    async full(id) {
      try { return await api('/creds/' + encodeURIComponent(id)); }
      catch { return null; }
    },
    find: id => credCache.find(c => c.id === id) || null,
  };
})();
