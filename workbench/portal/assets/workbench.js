/* ============================================================
   Workspace — data + interactions
   主题：亮色默认 / 01:00–07:00 自动暗色 / 手动切换
   ============================================================ */

const BANK = 'demo-bank';
const ORIGIN = window.location.origin;
const PROTO = new URL(ORIGIN).protocol;
const HOST = new URL(ORIGIN).host;
const AUTH_URL = `${PROTO}//demo:753951qweASD@${HOST}`;

const $ = s => document.querySelector(s);
const $$ = s => Array.from(document.querySelectorAll(s));

/* ================= 主题控制 ================= */
const THEME_KEY = 'ws-theme-pref';   // 'auto' | 'light' | 'dark'

function chinaHour() {
  // 强制按中国时区算，不受浏览器本地时区影响
  const s = new Date().toLocaleString('en-US', { timeZone: 'Asia/Shanghai', hour12: false });
  return parseInt(s.split(',')[1].trim().split(':')[0], 10);
}

function resolveTheme() {
  const pref = localStorage.getItem(THEME_KEY) || 'auto';
  if (pref === 'light' || pref === 'dark') return pref;
  const h = chinaHour();
  return (h >= 1 && h < 7) ? 'dark' : 'light';
}

function applyTheme() {
  const t = resolveTheme();
  document.documentElement.setAttribute('data-theme', t);
  const btn = $('#themeBtn');
  if (btn) {
    btn.innerHTML = t === 'dark'
      ? '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="4.5"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5 19 19M19 5l-1.5 1.5M6.5 17.5 5 19"/></svg>'
      : '<svg viewBox="0 0 24 24"><path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z"/></svg>';
    btn.title = t === 'dark' ? '当前暗色（点击切换亮色）' : '当前亮色（点击切换暗色）';
  }
}

function cycleTheme() {
  const cur = resolveTheme();
  // 手动切换：亮<->暗；再点回 auto 由一天后自然回归
  const next = cur === 'dark' ? 'light' : 'dark';
  localStorage.setItem(THEME_KEY, next);
  applyTheme();
}

/* ================= 导航 ================= */
const VIEW_META = {
  overview: '总览',
  memory: '记忆系统',
  intel: '信息采集',
  projects: '我的项目',
  infra: '基础设施',
  tools: '效率工具',
  creds: '链接凭据',
};

$$('.nav-item[data-view]').forEach(btn => {
  btn.addEventListener('click', () => go(btn.dataset.view));
});

function go(view) {
  $$('.nav-item').forEach(b => b.classList.toggle('is-active', b.dataset.view === view));
  $$('.view').forEach(v => v.classList.toggle('is-active', v.id === 'view-' + view));
  const name = VIEW_META[view] || '';
  $('#crumbNow').textContent = name;
  document.title = name ? `Workspace — ${name}` : 'Workspace';
  $('.scroll').scrollTop = 0;
}

/* ================= 时钟 ================= */
function tick() {
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  const el = $('#sbClock');
  if (el) el.textContent = `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
  // 跨过 1 点 / 7 点边界时自动换肤
  const cur = resolveTheme();
  if (document.documentElement.getAttribute('data-theme') !== cur) applyTheme();
}
tick(); setInterval(tick, 1000);

/* ================= 统计 ================= */
let statsData = null;
const kpiPrev = {};

function fmt(n) { return (n || 0).toLocaleString('en-US'); }

async function loadStats() {
  const t0 = performance.now();
  try {
    const r = await fetch(`${ORIGIN}/v1/default/banks/${BANK}/stats`, { cache: 'no-store' });
    const ms = Math.round(performance.now() - t0);
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const d = await r.json();
    statsData = d;

    const n = d.nodes_by_fact_type || {};
    setKpi('nodes', d.total_nodes);
    setKpi('links', d.total_links);
    setKpi('docs', d.total_documents);
    setKpi('obs', n.observation || d.total_observations || 0);
    setKpi('nodes2', d.total_nodes);

    $('[data-kpi="nodes-sub"]').textContent =
      `观察 ${n.observation || 0} · 事实 ${n.world || 0} · 经历 ${n.experience || 0}`;
    $('[data-kpi="docs-sub"]').textContent =
      d.total_documents ? `平均 ${(d.total_nodes / d.total_documents).toFixed(1)} 单元/篇` : '—';

    $('#latencyChip').textContent = ms + ' ms';
    $('#liveLabel').textContent = '在线';
    $('#liveDot').style.background = 'var(--mint)';
    $('#navMemCount').textContent = fmt(d.total_nodes);

    renderDonut(n);
    loadGrowth();
  } catch (e) {
    $('#liveLabel').textContent = '离线';
    $('#liveDot').style.background = 'var(--rose)';
    $('#latencyChip').textContent = '—';
  }
}

function setKpi(key, val) {
  $$(`[data-kpi="${key}"]`).forEach(el => {
    const from = kpiPrev[key] || 0;
    kpiPrev[key] = val;
    const obj = { v: from };
    gsap.to(obj, {
      v: val, duration: from ? .5 : .9, ease: 'power2.out',
      onUpdate: () => el.textContent = fmt(Math.round(obj.v))
    });
  });
}

/* ================= 图表 ================= */
let growthChart = null, donutChart = null;

function themeColors() {
  const cs = getComputedStyle(document.documentElement);
  const g = k => cs.getPropertyValue(k).trim();
  return {
    accent: g('--accent'), mint: g('--mint'), violet: g('--violet'),
    ink: g('--ink'), ink2: g('--ink-2'), ink3: g('--ink-3'), ink4: g('--ink-4'),
    card: g('--bg-card'), line: g('--line'),
  };
}

async function loadGrowth() {
  try {
    const r = await fetch(`${ORIGIN}/v1/default/banks/${BANK}/stats/memories-timeseries?period=7d`, { cache: 'no-store' });
    if (!r.ok) throw new Error();
    const d = await r.json();
    const b = d.buckets || [];
    const labels = b.map(x => { const t = new Date(x.time); return `${t.getMonth() + 1}/${t.getDate()}`; });
    const world = b.map(x => x.world || 0);
    const exp = b.map(x => x.experience || 0);
    const obs = b.map(x => x.observation || 0);

    const ctx = $('#growthChart');
    if (!ctx) return;
    if (growthChart) growthChart.destroy();
    const c = themeColors();

    growthChart = new Chart(ctx, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          { label: '事实', data: world, backgroundColor: c.accent, borderRadius: 3, barPercentage: .68, categoryPercentage: .72 },
          { label: '经历', data: exp, backgroundColor: c.mint, borderRadius: 3, barPercentage: .68, categoryPercentage: .72 },
          { label: '观察', data: obs, backgroundColor: c.violet, borderRadius: 3, barPercentage: .68, categoryPercentage: .72 },
        ]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        animation: { duration: 650, easing: 'easeOutQuart' },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: c.card, borderColor: c.line, borderWidth: 1,
            titleColor: c.ink, bodyColor: c.ink2,
            titleFont: { size: 11, weight: '600' }, bodyFont: { size: 10 },
            padding: 9, cornerRadius: 6, displayColors: true,
            boxWidth: 7, boxHeight: 7, boxPadding: 4,
          }
        },
        scales: {
          x: { stacked: true, grid: { display: false }, border: { display: false },
               ticks: { color: c.ink4, font: { size: 10 }, padding: 6 } },
          y: { stacked: true, grid: { color: c.line, drawTicks: false }, border: { display: false },
               ticks: { color: c.ink4, font: { size: 10 }, padding: 6,
                        callback: v => v >= 1000 ? (v / 1000).toFixed(1) + 'k' : v } }
        }
      }
    });
  } catch {}
}

function renderDonut(n) {
  const ctx = $('#donutChart');
  if (!ctx) return;
  const data = [n.world || 0, n.experience || 0, n.observation || 0];
  const c = themeColors();
  const colors = [c.accent, c.mint, c.violet];
  const labels = ['客观事实', '经历事件', '深度观察'];

  if (donutChart) donutChart.destroy();

  donutChart = new Chart(ctx, {
    type: 'doughnut',
    data: { labels, datasets: [{ data, backgroundColor: colors, borderWidth: 0, hoverOffset: 4, spacing: 2 }] },
    options: {
      responsive: true, maintainAspectRatio: false, cutout: '72%',
      animation: { duration: 700, easing: 'easeOutQuart' },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: c.card, borderColor: c.line, borderWidth: 1,
          titleColor: c.ink, bodyColor: c.ink2,
          titleFont: { size: 11, weight: '600' }, bodyFont: { size: 10 },
          padding: 9, cornerRadius: 6, displayColors: false,
        }
      }
    }
  });

  const total = data.reduce((a, b) => a + b, 0) || 1;
  $('#donutLegend').innerHTML = labels.map((l, i) => `
    <div><i class="sw" style="background:${colors[i]}"></i>${l}
    <b>${((data[i] / total) * 100).toFixed(1)}%</b></div>`).join('');
}

/* ================= 最近记忆 ================= */
async function loadFeed() {
  const box = $('#feed');
  try {
    const r = await fetch(`${ORIGIN}/v1/default/banks/${BANK}/memories/list?limit=8`, { cache: 'no-store' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const d = await r.json();
    const items = d.items || [];
    if (!items.length) { box.innerHTML = '<div class="feed-empty">暂无记忆条目</div>'; return; }

    box.innerHTML = items.map(m => {
      const t = m.fact_type || 'world';
      const dt = m.date ? new Date(m.date) : null;
      const when = dt && !isNaN(dt)
        ? `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`
        : '—';
      const proof = m.proof_count ? `<span class="sep"></span><span>${m.proof_count} 条佐证</span>` : '';
      return `<div class="feed-item" data-t="${t}">
        <div class="feed-badge"></div>
        <div class="feed-body">
          <div class="feed-text">${esc(m.text || '')}</div>
          <div class="feed-meta"><em>${t}</em><span class="sep"></span><span>${when}</span>${proof}</div>
        </div></div>`;
    }).join('');
  } catch (e) {
    box.innerHTML = `<div class="feed-empty">加载失败：${esc(e.message)}</div>`;
  }
}

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

$('#refreshFeed').addEventListener('click', loadFeed);

/* ================= 客户端配置 ================= */
const CLIENTS = [
  { id:'claude', name:'Claude', tag:'Desktop', icon:'i-spark',
    file:'~/Library/Application Support/Claude/claude_desktop_config.json',
    body:()=>JSON.stringify({mcpServers:{'personal-memory':{command:'npx',args:['-y','@vectorize-io/hindsight-mcp'],env:{HINDSIGHT_API_URL:AUTH_URL,HINDSIGHT_BANK_ID:BANK}}}},null,2),
    steps:['打开 Claude Desktop，进入 <code>Settings → Developer</code>','点击 <code>Edit Config</code>，系统会打开配置文件','把上方 JSON 合并进 <code>mcpServers</code> 后保存','完全退出并重启 Claude，工具图标里出现 <code>personal-memory</code> 即成功']},
  { id:'cursor', name:'Cursor', tag:'Editor', icon:'i-zap',
    file:'~/.cursor/mcp.json',
    body:()=>JSON.stringify({mcpServers:{'personal-memory':{command:'npx',args:['-y','@vectorize-io/hindsight-mcp'],env:{HINDSIGHT_API_URL:AUTH_URL,HINDSIGHT_BANK_ID:BANK}}}},null,2),
    steps:['Cursor 中打开 <code>Settings → Features → MCP</code>','点击 <code>Add New MCP Server</code>，或直接编辑 <code>mcp.json</code>','粘贴上方配置，保存后刷新，状态点变绿即接入成功','在 Composer 或 Chat 中提问，Cursor 会自动调用记忆工具']},
  { id:'codex', name:'Codex', tag:'CLI', icon:'i-terminal',
    file:'终端一次性执行',
    body:()=>`codex mcp add personal-memory \\\n  --env HINDSIGHT_API_URL="${AUTH_URL}" \\\n  --env HINDSIGHT_BANK_ID="${BANK}" \\\n  -- npx -y @vectorize-io/hindsight-mcp`,
    steps:['复制上方命令，在本地终端直接执行','运行 <code>codex mcp list</code> 确认 <code>personal-memory</code> 为 enabled','之后正常启动 <code>codex</code> 即可自动带记忆']},
  { id:'openclaw', name:'OpenClaw', tag:'Gateway', icon:'i-bot',
    file:'~/.openclaw/config',
    body:()=>JSON.stringify({mcp:{servers:{'personal-memory':{command:'npx',args:['-y','@vectorize-io/hindsight-mcp'],env:{HINDSIGHT_API_URL:AUTH_URL,HINDSIGHT_BANK_ID:BANK}}}}},null,2),
    steps:['把上方配置合并到 OpenClaw 配置文件','执行 <code>openclaw restart</code> 重载网关','Agent 即获得 <code>recall</code> / <code>retain</code> 调用能力']},
  { id:'windsurf', name:'Windsurf', tag:'Editor', icon:'i-wind',
    file:'~/.codeium/windsurf/mcp_config.json',
    body:()=>JSON.stringify({mcpServers:{'personal-memory':{command:'npx',args:['-y','@vectorize-io/hindsight-mcp'],env:{HINDSIGHT_API_URL:AUTH_URL,HINDSIGHT_BANK_ID:BANK}}}},null,2),
    steps:['Windsurf 中进入 <code>Settings → Cascade → MCP Servers</code>','编辑 <code>mcp_config.json</code> 写入上方 JSON 并保存','重启 Cascade 面板即可调用']},
  { id:'http', name:'HTTP', tag:'Script', icon:'i-code',
    file:'cURL / Python / Node.js',
    body:()=>`curl -X POST "${ORIGIN}/v1/default/banks/${BANK}/memories/recall" \\\n  -u 'demo:753951qweASD@' -H "Content-Type: application/json" \\\n  -d '{"query":"我的最新规划","budget":"mid"}'`,
    steps:['适配自动化脚本、自定义微服务或任何语言的 HTTP 客户端','所有接口走 HTTP Basic Auth，凭据同工作台登录账号']},
];

const PROMPT_TEXT = `# 个人云端记忆挂载协议

你已接入用户的个人长期记忆库（Hindsight）。遵循以下准则：

1. 【对话前自动召回】
   涉及过往经历、业务定位（惠州制造 / AI-GEO）、历史项目（work-demo 等）、
   证件流程、个人偏好、服务器配置时，回答前必须调用 recall 工具，
   结合 world 客观事实与 observation 核心认知作答，禁止凭空猜测。

2. 【对话中实时沉淀】
   当用户明确做出新决策、敲定架构、改变业务方向、确定时间节点、
   或总结出重要教训时，回复前静默调用 retain，
   以精炼客观的一两句话写入，context 使用 chat:decision 或 chat:project。

3. 【隐私隔离】
   涉密会话、临时密钥、他人隐私不得主动 retain。`;

let current = CLIENTS[0];

function renderClients() {
  $('#clientGrid').innerHTML = CLIENTS.map(c => `
    <div class="client ${c.id === current.id ? 'is-active' : ''}" data-id="${c.id}">
      <div class="client-ico"><svg><use href="#${c.icon}"/></svg></div>
      <div class="client-name">${c.name}</div>
      <div class="client-tag">${c.tag}</div>
    </div>`).join('');
  $$('.client').forEach(el => el.addEventListener('click', () => selectClient(el.dataset.id)));
}

function selectClient(id) {
  current = CLIENTS.find(c => c.id === id) || CLIENTS[0];
  $$('.client').forEach(el => el.classList.toggle('is-active', el.dataset.id === current.id));
  renderConfig();
  gsap.fromTo('#cfgCode', { opacity: 0 }, { opacity: 1, duration: .25 });
}

function renderConfig() {
  $('#cfgName').textContent = current.name;
  $('#cfgFile').textContent = current.file;
  $('#cfgCode').textContent = current.body();
  $('#cfgSteps').innerHTML = current.steps.map(s => `<li>${s}</li>`).join('');
}

$('#promptText').textContent = PROMPT_TEXT;

function copyBtn(btn, text) {
  const orig = btn.innerHTML;
  navigator.clipboard.writeText(text).then(() => {
    btn.classList.add('btn-done');
    btn.innerHTML = btn.innerHTML.replace(/<\/svg>.*/, '</svg>已复制');
    setTimeout(() => { btn.classList.remove('btn-done'); btn.innerHTML = orig; }, 1500);
  }).catch(() => {
    btn.innerHTML = btn.innerHTML.replace(/<\/svg>.*/, '</svg>失败');
    setTimeout(() => { btn.innerHTML = orig; }, 1500);
  });
}

$('#copyCfg').addEventListener('click', e => copyBtn(e.currentTarget, $('#cfgCode').textContent));
$('#copyPrompt').addEventListener('click', e => copyBtn(e.currentTarget, PROMPT_TEXT));

/* ================= 资产 ================= */
const PROJECTS = [
  { icon:'i-globe', name:'work-demo', desc:'业务工作台 · SKU / 订单 / 利润', url:'https://files.example.com', pill:'运行中', cls:'' },
  { icon:'i-id', name:'me 名片', desc:'个人名片与兴趣页，多端自适应', url:'https://me.files.example.com', pill:'运行中', cls:'' },
  { icon:'i-brain', name:'Hindsight 记忆中枢', desc:'长期记忆库与认知图谱', url:'/console', pill:'运行中', cls:'' },
  { icon:'i-radar', name:'aihot 信息采集', desc:'全网 AI 热点情报聚合', url:'#', pill:'规划中', cls:'plan' },
];

const INFRA = [
  { icon:'i-layout', name:'1Panel 面板', desc:'容器、站点、证书与备份管理', url:'http://192.0.2.10:13654', pill:'公网', cls:'warn' },
  { icon:'i-share', name:'X-UI 节点管理', desc:'代理节点与订阅面板', url:'http://192.0.2.10:2096', pill:'公网', cls:'warn' },
  { icon:'i-waypoints', name:'magpie 模型网关', desc:'group/never-stuck 模型路由池', url:'https://api.demo.trade', pill:'运行中', cls:'' },
  { icon:'i-database', name:'Hindsight DB', desc:'pgvector · 127.0.0.1:5433', url:'#', pill:'内网', cls:'mute' },
  { icon:'i-server', name:'OpenResty 反代', desc:'pw / api / 3xui 站点入口', url:'#', pill:'运行中', cls:'' },
  { icon:'i-shield', name:'Fail2Ban', desc:'SSH 暴力破解防护', url:'#', pill:'启用', cls:'' },
];

const TOOLS = [
  { icon:'i-terminal', name:'Hindsight 控制台', desc:'文档、观察与知识图谱', url:'/console', pill:'内部', cls:'' },
  { icon:'i-database', name:'备份归档', desc:'旧库冷备 · /var/backups/pmh-retire', url:'#', pill:'受限', cls:'mute' },
  { icon:'i-mail', name:'TokenMail', desc:'Agent 邮件收发身份', url:'#', pill:'待恢复', cls:'warn' },
  { icon:'i-folder', name:'文件中转站', desc:'上传 · 有效期外链 · 连带删除', url:'#', pill:'规划中', cls:'plan' },
];

function tileHTML(c) {
  const live = c.url !== '#';
  return `<a class="tile" href="${c.url}" ${live ? 'target="_blank" rel="noopener"' : 'onclick="return false" style="cursor:default"'}>
    <div class="tile-top">
      <div class="tile-ico"><svg><use href="#${c.icon}"/></svg></div>
      <span class="tile-pill ${c.cls}">${c.pill}</span>
    </div>
    <h4>${c.name}</h4>
    <p>${c.desc}</p>
    <div class="tile-url">${live ? c.url.replace(/^https?:\/\//, '') : '尚未挂载'}</div>
  </a>`;
}

function renderTiles() {
  $('#projectGrid').innerHTML = PROJECTS.map(tileHTML).join('');
  $('#infraGrid').innerHTML = INFRA.map(tileHTML).join('');
  $('#toolGrid').innerHTML = TOOLS.map(tileHTML).join('');
}

/* ================= 总览：全资产快照 ================= */
function renderOverviewSnapshot() {
  const wrap = $('#overviewAssets');
  if (!wrap) return;

  const rows = [
    ...PROJECTS.map(p => ({ ...p, group: '项目' })),
    ...INFRA.slice(0, 3).map(p => ({ ...p, group: '运维' })),
  ];

  wrap.innerHTML = rows.map(r => {
    const live = r.url !== '#';
    return `<a class="snap-row" href="${r.url}" ${live ? 'target="_blank" rel="noopener"' : 'onclick="return false" style="cursor:default"'}>
      <span class="snap-ico"><svg><use href="#${r.icon}"/></svg></span>
      <span class="snap-name">${r.name}</span>
      <span class="snap-group">${r.group}</span>
      <span class="snap-state ${r.cls}">${r.pill}</span>
    </a>`;
  }).join('');
}

/* ================= 命令面板 ================= */
const PAGES = [
  { icon:'i-grid', label:'总览', view:'overview', hint:'Dashboard' },
  { icon:'i-brain', label:'记忆系统', view:'memory', hint:'Memory' },
  { icon:'i-radar', label:'信息采集', view:'intel', hint:'Intel' },
  { icon:'i-rocket', label:'我的项目', view:'projects', hint:'Projects' },
  { icon:'i-server', label:'基础设施', view:'infra', hint:'Infra' },
  { icon:'i-wrench', label:'效率工具', view:'tools', hint:'Tools' },
  { icon:'i-key', label:'链接凭据', view:'creds', hint:'Credentials' },
];

let palSel = 0;

function openPalette() {
  $('#palette').classList.add('is-open');
  const inp = $('#paletteInput');
  inp.value = ''; inp.focus(); palSel = 0;
  renderPalette('');
}
function closePalette() { $('#palette').classList.remove('is-open'); }

$('#cmdkBtn').addEventListener('click', openPalette);
$('#palette').addEventListener('click', e => { if (e.target.id === 'palette') closePalette(); });
$('#paletteInput').addEventListener('input', e => renderPalette(e.target.value.trim()));

$('#paletteInput').addEventListener('keydown', e => {
  const items = $$('.pal-item');
  if (e.key === 'ArrowDown') { e.preventDefault(); palSel = Math.min(palSel + 1, items.length - 1); paintSel(); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); palSel = Math.max(palSel - 1, 0); paintSel(); }
  else if (e.key === 'Enter') { e.preventDefault(); items[palSel]?.click(); }
});

function paintSel() {
  $$('.pal-item').forEach((el, i) => el.classList.toggle('is-sel', i === palSel));
  $$('.pal-item')[palSel]?.scrollIntoView({ block: 'nearest' });
}

function renderPalette(q) {
  const list = $('#paletteList');
  const ql = q.toLowerCase();
  const pages = PAGES.filter(p => !q || p.label.toLowerCase().includes(ql) || p.hint.toLowerCase().includes(ql));
  let html = '';

  if (pages.length) {
    html += '<div class="pal-group">页面</div>';
    html += pages.map(p => `<div class="pal-item" data-view="${p.view}">
      <svg class="ico"><use href="#${p.icon}"/></svg>
      <span>${p.label}</span><em>${p.hint}</em></div>`).join('');
  }
  if (q) {
    html += '<div class="pal-group">记忆检索</div>';
    html += `<div class="pal-item" data-recall="1">
      <svg class="ico"><use href="#i-search"/></svg>
      <span>在记忆中搜索「${esc(q)}」</span><em>Recall</em></div>`;
  }
  if (!html) html = '<div class="pal-empty">没有匹配的结果</div>';
  list.innerHTML = html;

  $$('.pal-item').forEach(el => el.addEventListener('click', () => {
    if (el.dataset.view) { go(el.dataset.view); closePalette(); }
    else if (el.dataset.recall) { runRecall(q); closePalette(); go('overview'); }
  }));
}

function runRecall(q) {
  if (!q) return;
  const box = $('#feed');
  box.innerHTML = `<div class="feed-empty">正在检索「${esc(q)}」…</div>`;
  fetch(`${ORIGIN}/v1/default/banks/${BANK}/memories/recall`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: q, budget: 'mid' })
  })
    .then(r => r.ok ? r.json() : Promise.reject(new Error('HTTP ' + r.status)))
    .then(d => {
      const hits = (d.results || []).slice(0, 8);
      if (!hits.length) { box.innerHTML = '<div class="feed-empty">未命中相关记忆，换个问法试试。</div>'; return; }
      box.innerHTML = hits.map(h => {
        const t = h.type || 'world';
        return `<div class="feed-item" data-t="${t}">
          <div class="feed-badge"></div>
          <div class="feed-body">
            <div class="feed-text" style="-webkit-line-clamp:3">${esc(h.text || '')}</div>
            <div class="feed-meta"><em>${t}</em><span class="sep"></span><span>召回命中</span></div>
          </div></div>`;
      }).join('');
      gsap.from('.feed-item', { opacity: 0, y: 6, duration: .3, stagger: .04, ease: 'power2.out' });
    })
    .catch(e => { box.innerHTML = `<div class="feed-empty">检索失败：${esc(e.message)}</div>`; });
}

document.addEventListener('keydown', e => {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault();
    $('#palette').classList.contains('is-open') ? closePalette() : openPalette();
  }
  if (e.key === 'Escape') closePalette();
});

/* ================= 对外暴露（供 items.js 使用）================= */
window.WB = { $, $$, esc, go, applyTheme };

/* ================= 启动 ================= */
document.addEventListener('DOMContentLoaded', () => {
  applyTheme();
  $('#themeBtn').addEventListener('click', cycleTheme);

  renderClients();
  renderConfig();
  renderTiles();
  renderOverviewSnapshot();

  loadStats();
  loadFeed();
  setInterval(loadStats, 60000);

  gsap.from('.kpi', { opacity: 0, y: 8, duration: .45, stagger: .05, ease: 'power2.out' });
  gsap.from('.card', { opacity: 0, y: 10, duration: .5, stagger: .06, delay: .1, ease: 'power2.out' });
});
