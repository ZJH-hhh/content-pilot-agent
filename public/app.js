const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];
const paths = {
  grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  layers: '<path d="m12 3 10 5-10 5L2 8zM3 12l9 5 9-5M3 16l9 5 9-5"/>',
  wallet: '<path d="M20 8V5a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15v12H5a2 2 0 0 1-2-2V6"/><path d="M20 12h-5v4h5"/><path d="M16 14h.1"/>',
  sparkles: '<path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5zM20 2v4M18 4h4"/>',
  check: '<path d="m6 12 4 4 8-9"/>',
  panel: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
  edit: '<path d="m15 4 5 5M4 20l5-1L21 7a2 2 0 0 0-5-5L4 14zM4 20h16"/>',
  'arrow-right': '<path d="M4 12h16m-6-6 6 6-6 6"/>',
  download: '<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>',
  sliders: '<path d="M4 6h7m5 0h4M4 12h2m5 0h9M4 18h10m5 0h1"/><circle cx="13.5" cy="6" r="2.5"/><circle cx="8.5" cy="12" r="2.5"/><circle cx="16.5" cy="18" r="2.5"/>',
  shield: '<path d="m12 3 8 3v6c0 4-4 7-8 9-4-2-8-5-8-9V6z"/><path d="m8 12 3 3 5-6"/>',
  flask: '<path d="M9 3h6m-5 0v6L4 19a1 1 0 0 0 1 2h14a1 1 0 0 0 1-2L14 9V3M7 15h10"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7h.01"/>',
  file: '<path d="M14 3H5v18h14V8zM14 3v5h5M8 12h8M8 16h6"/>',
  refresh: '<path d="M20 7v5h-5M4 17v-5h5"/><path d="M6 7a7 7 0 0 1 13-1l1 6M4 12l1 6a7 7 0 0 0 13-1"/>',
  link: '<path d="m9 15 6-6M8 11l-3 3a4 4 0 0 0 5 5l3-3M11 8l3-3a4 4 0 0 1 5 5l-3 3"/>',
  alert: '<path d="m12 3 10 18H2zM12 9v5M12 17h.01"/>',
  copy: '<rect x="8" y="8" width="12" height="13" rx="2"/><path d="M16 8V3H3v13h5"/>',
  play: '<path d="m8 4 12 8-12 8z"/>',
  arrow: '<path d="m9 5 7 7-7 7"/>'
};
const icon = name => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.file}</svg>`;
function hydrateIcons(root = document) { $$('[data-icon]', root).forEach(el => { el.innerHTML = icon(el.dataset.icon); }); }
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const number = n => Number(n || 0).toLocaleString('zh-CN', { maximumFractionDigits: 2 });
const date = value => new Date(value).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
const statuses = { queued: ['排队中', 'running'], running: ['规划中', 'running'], resuming: ['续跑中', 'running'], completed: ['已完成', 'success'], incomplete: ['未完成', 'error'], needs_input: ['待补充', 'warning'] };
const toolLabels = { search_materials: '素材检索', generate_script: '脚本生成', estimate_plan: '成本估算', save_plan: '方案保存', stop: '结束规划', finish: '确认完成' };
const state = { tasks: [], selected: localStorage.getItem('pilot-selected'), tab: 'overview', view: 'workspace', config: null, tier: 'all', busy: false, online: true };
const task = () => state.tasks.find(t => t.id === state.selected);
const active = t => ['queued', 'running', 'resuming'].includes(t.status);
const badge = t => { const [label, cls] = statuses[t.status] || ['未知', 'neutral']; return `<span class="badge ${cls}">${label}</span>`; };
let toastTimer;
function toast(message) { $('#toast').textContent = message; $('#toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { $('#toast').hidden = true; }, 3500); }
async function api(url, options = {}) {
  const response = await fetch(url, { ...options, headers: { 'Content-Type': 'application/json', ...options.headers } });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || '请求失败，请稍后再试');
  return data;
}
function setDeadline() {
  const d = new Date(Date.now() + 24 * 60 * 60000);
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  $('#deadline').value = d.toISOString().slice(0, 16);
}
function setView(view) {
  state.view = view;
  $$('.view').forEach(el => { el.hidden = el.id !== `${view}-view`; });
  $$('.nav-item').forEach(el => el.classList.toggle('active', el.dataset.view === view));
  $('#breadcrumb-current').textContent = { workspace: '规划工作台', history: '任务记录', materials: '素材资源库' }[view];
  if (view === 'history') renderHistory();
  if (view === 'materials') renderLibrary();
}
function selectTask(id) {
  state.selected = id; localStorage.setItem('pilot-selected', id); state.tab = 'overview'; setView('workspace'); renderResult();
  if (innerWidth < 740) $('.result-panel').scrollIntoView({ behavior: 'smooth', block: 'start' });
}
function renderStats() {
  const done = state.tasks.filter(t => t.status === 'completed');
  $('#nav-count').textContent = state.tasks.length;
  $('#stat-total').innerHTML = `${state.tasks.length}<small> 个</small>`;
  $('#stat-complete').innerHTML = `${done.length}<small> 份</small>`;
  $('#stat-cost').innerHTML = `${number(done.reduce((sum, t) => sum + t.results.plan.estimate.total, 0))}<small> 单位</small>`;
  $('#stat-saved').innerHTML = `${number(done.reduce((sum, t) => sum + Math.max(0, t.input.budget - t.results.plan.estimate.total), 0))}<small> 单位</small>`;
  $('#completion-rate').textContent = state.tasks.length ? `${Math.round(done.length / state.tasks.length * 100)}% 完成率` : '准备好出发';
  $('#recent-count').textContent = `${state.tasks.length} 个任务`;
}
function row(t) {
  const cost = t.results.plan?.estimate.total ?? t.results.estimates.at(-1)?.total;
  return `<button class="task-row" data-task="${t.id}"><span class="row-icon">${icon('file')}</span><span class="row-title"><strong>${esc(t.input.theme || '未命名任务')}</strong><small>${date(t.createdAt)} <span>·</span> ${t.mode === 'mock' ? '离线 Mock' : '真实模型'} <span>·</span> ${t.trace.filter(e => e.kind === 'tool').length} 次工具调用</small></span><span class="row-cost" title="预计制作费用">${cost == null ? '—' : number(cost)} <small>单位</small></span>${badge(t)}<span class="row-arrow">${icon('arrow')}</span></button>`;
}
const emptyRows = text => `<div class="recent-empty">${icon('clock')}<span>${text}</span></div>`;
function renderRecent() { $('#recent-tasks').innerHTML = state.tasks.length ? state.tasks.slice(0, 3).map(row).join('') : emptyRows('还没有规划记录。开始第一个任务，让好想法发生。'); }
function renderHistory() {
  const query = $('#history-search').value.toLowerCase();
  const filter = $('#history-filter').value;
  const list = state.tasks.filter(t => (t.input.theme || '').toLowerCase().includes(query) && (filter === 'all' || (filter === 'running' ? active(t) : t.status === filter)));
  $('#history-list').innerHTML = list.length ? list.map(row).join('') : emptyRows(query || filter !== 'all' ? '没有找到符合条件的任务。试试其他关键词或状态。' : '你的创作旅程，从第一个内容计划开始。');
}
function steps(t) {
  return `<div class="mini-title"><h3>执行计划</h3><span>${t ? `${t.trace.filter(e => e.kind === 'tool' && e.status === 'success').length} 次成功调用 / 上限 ${t.maxSteps} 次` : '4 个步骤，自动协作'}</span></div><div class="step-grid">${Object.entries(toolLabels).slice(0, 4).map(([tool, label], i) => {
    const entries = t?.trace.filter(e => e.tool === tool && e.kind === 'tool') || [];
    const last = entries.at(-1);
    const cls = last ? last.status === 'success' ? 'success-step' : last.status === 'failed' ? 'failed-step' : 'active-step' : '';
    return `<div class="step-card ${cls}"><span class="step-number">${last?.status === 'success' ? icon('check') : `0${i + 1}`}</span><span class="step-indicator"></span><strong>${label}</strong><p>${last ? last.status === 'success' ? (entries.length > 1 ? `完成 · ${entries.length} 次调用` : '已完成') : last.status === 'partial' ? '部分成功' : '工具失败' : '等待执行'}</p></div>`;
  }).join('')}</div>`;
}
function emptyOverview() {
  return `<div class="empty-intro"><div><span class="mini-eyebrow">FROM A SPARK TO A PLAN</span><h3>灵感已就位，随时可以启程。</h3><p>设定主题、预算与时间，Agent 会为你寻找素材、创作脚本，并规划可执行的方案。</p></div><div class="orbit-art" aria-hidden="true"><span class="paper-plane">➤</span><i class="art-dot"></i></div></div>${steps()}<div class="mini-title"><h3>你的方案，将在这里成形</h3><span>清晰 · 可执行 · 可追溯</span></div><div class="expectation"><span data-icon="file"></span><div><h4>从想法到执行，只差一次开始</h4><p>内容脚本、素材建议、费用明细与执行记录，<br>一份完整方案，帮你省下反复协调的时间。</p></div></div><div class="ready-bottom"><span>${icon('link')}预算不够？Agent 会尝试替代方案。</span><span>从左侧开始创建 ↖</span></div>`;
}
function renderBudget(t, estimate) {
  if (!estimate) return '';
  const budget = t.input.budget;
  const total = estimate.total;
  const first = estimate.items[0].amount / Math.max(total, budget) * 100;
  const second = estimate.items[1].amount / Math.max(total, budget) * 100;
  return `<div class="budget-block"><div class="budget-block-head"><span>预计制作费用 <span style="color:#adb5c1;font-size:9px">/ 预算 ${number(budget)} 单位</span></span><strong class="budget-total">${number(total)} <small>单位</small></strong></div><div class="budget-bar"><i style="width:${first}%"></i><i style="width:${second}%"></i></div><div class="budget-legend"><span><i></i>素材 ${estimate.items[0].amount}</span><span><i></i>制作 ${estimate.items[1].amount}</span><span>${estimate.budgetGap ? `预算缺口 ${estimate.budgetGap}` : `结余 ${number(budget - total)} 单位`}</span></div></div>`;
}
function scenes(script) {
  return `<div class="script-list">${script.scenes.map(s => `<div class="scene"><span class="scene-time">${s.time}</span><div><strong>${esc(s.title)}</strong><p>${esc(s.visual)}</p><p class="scene-narration">“${esc(s.narration)}”</p></div></div>`).join('')}</div>`;
}
function overview(t) {
  const plan = t.results.plan;
  const estimate = plan?.estimate || t.results.estimates.at(-1);
  const script = plan?.script || t.results.scripts.at(-1);
  const failed = t.trace.some(e => e.status === 'failed' || e.status === 'partial');
  const replanned = t.results.estimates.some(e => !e.feasible);
  const successful = Object.keys(toolLabels).slice(0, 4).filter(tool => t.trace.some(e => e.tool === tool && e.status === 'success')).length;
  let message = '';
  if (t.status === 'completed') message = replanned ? `发现初始方案成本 ${t.results.estimates[0].total} 单位，已调整为 ${plan.estimate.total} 单位轻量方案。素材、脚本与结果均已保留。` : failed ? '已根据工具返回结果调整方案，任务完成；失败记录与成功产物均已保留。' : '素材、脚本与预算已核验，方案已保存。准备把灵感变成下一次行动。';
  else if (active(t)) message = t.status === 'resuming' ? 'Agent 正在读取成功产物，准备继续执行…' : t.trace.at(-1)?.summary || 'Agent 正在读取你的需求，准备选择第一个工具…';
  else message = t.reason;
  return `<div class="task-overview-title"><div><h3 class="task-title-truncate">${esc(t.input.theme || '等待补充任务主题')}</h3><p>预算 ${number(t.input.budget)} 单位 <span>·</span> 截止 ${t.input.deadline && Number.isFinite(Date.parse(t.input.deadline)) ? date(t.input.deadline) : '未填写'}${estimate ? ` <span>·</span> 预计制作 ${estimate.durationMinutes} 分钟` : ''}</p></div></div><div class="observation-banner ${t.status === 'incomplete' || t.status === 'needs_input' ? 'danger' : replanned || failed ? 'replan' : ''}">${icon(t.status === 'completed' ? 'check' : active(t) ? 'sparkles' : 'alert')}<p>${esc(message)}</p></div>${steps(t)}<div class="plan-progress"><div class="progress-track"><i style="width:${successful * 25}%"></i></div><span class="progress-label">${successful}/4 步骤有成功产物</span></div>${renderBudget(t, estimate)}<div class="mini-title"><div class="script-heading"><h3>内容脚本</h3>${script ? `<span>${esc(script.format)}</span>` : ''}</div>${script ? '<button class="copy-button" data-copy="script">复制文案 ↗</button>' : '<span>生成后展示分镜</span>'}</div>${script ? scenes(script) : `<div class="script-empty">${active(t) ? '正在为你的内容计划准备素材与脚本…' : t.status === 'needs_input' ? '请在左侧补充必填信息后创建新任务。' : '脚本尚未生成。已完成的素材检索结果可在「全部产物」查看。'}</div>`}${active(t) ? `<div class="working-hint">${icon('refresh')}Agent 正在执行中，工具结果将自动更新…</div>` : ''}<div class="resume-row">${t.status === 'incomplete' ? `<button class="button secondary" id="resume-button">${icon('refresh')}从已有结果继续</button>` : ''}<button class="text-button" id="repeat-button">${icon('shield')}验证重复执行</button></div><div class="mode-label">${t.mode === 'mock' ? '离线 Mock · 规则策略验证流程，不证明真实模型决策效果。' : '真实模型 · 每轮根据最新工具结果选择动作。'}脚本工具使用本地原创模板。</div>`;
}
function renderTrace(t) {
  if (!t?.trace.length) return `<div class="trace-notice">${t?.status === 'needs_input' ? '输入校验未通过，未调用模型或工具。' : '任务启动后，每次模型动作与工具观察将在这里按顺序展示。'}</div>${emptyRows('暂时还没有执行轨迹。')}`;
  return `<div class="trace-notice">${t.mode === 'mock' ? '离线规则策略的动作记录，仅验证流程与工程约束。' : '真实模型动态选择动作，以下仅包含可公开的简要依据。'}显示工具参数、返回摘要和后续动作；不包含模型内部思维过程。</div>${t.trace.map(e => `<article class="trace-entry ${e.status}"><span class="trace-circle">${String(e.step).padStart(2, '0')}</span><div class="trace-body"><div class="trace-head"><strong>${esc(toolLabels[e.tool] || '模型响应错误')}</strong><span class="badge ${e.status === 'success' ? 'success' : e.status === 'failed' ? 'error' : 'warning'}">${({ success: '成功', failed: '失败', partial: '部分成功', observed: '已决策' })[e.status]}</span><time>${date(e.at)}</time></div><p class="trace-reason">依据 · ${esc(e.reason || '模型响应不可用，保留已有结果并停止。')}</p>${e.arguments ? `<div class="trace-args">${esc(e.tool)}(${esc(JSON.stringify(e.arguments))})</div>` : ''}<p>观察 · ${esc(e.summary || (e.tool === 'stop' ? e.reason : '模型结束当前规划'))}</p>${e.result ? `<details><summary style="font-size:9px;color:#adb6c1;cursor:pointer">查看完整工具返回</summary><pre class="trace-args">${esc(JSON.stringify(e.result, null, 2))}</pre></details>` : ''}</div></article>`).join('')}`;
}
function outputs(t) {
  if (!t) return emptyRows('创建任务后，这里会保留每一步成功产物。');
  const { materials, scripts, estimates, plan } = t.results;
  return `<div class="trace-notice">产物按实际成功结果保存，重规划与失败不会删除已有素材或脚本。${plan ? `已保存方案编号：${esc(plan.id)}` : '当前尚无已保存方案。'}</div><div class="output-card"><h3>${icon('layers')}检索素材 <span>${materials.length} 份</span></h3>${materials.length ? materials.map(m => `<p><strong>${esc(m.title)}</strong> · ${m.licenseCost} 单位授权费<br>${esc(m.description)}</p>`).join('') : '<p>暂无素材结果</p>'}</div><div class="output-card"><h3>${icon('edit')}内容脚本 <span>${scripts.length} 份</span></h3>${scripts.length ? scripts.map(s => `<details><summary style="font-size:10px;color:#8c97a7;cursor:pointer">${esc(s.title)} · ${esc(s.materialId)}</summary>${scenes(s)}<div class="caption">${esc(s.caption)}<div class="tags">${s.hashtags.map(esc).join(' ')}</div></div></details>`).join('') : '<p>暂无脚本结果</p>'}</div><div class="output-card"><h3>${icon('wallet')}成本估算 <span>${estimates.length} 次</span></h3>${estimates.length ? estimates.map(e => `<p><strong>${esc(e.materialId)}</strong> · 合计 ${e.total} 单位 / ${e.durationMinutes} 分钟<br>${e.feasible ? '估算时满足预算与时间' : `不可行：预算缺口 ${e.budgetGap}，时间缺口 ${e.timeGapMinutes} 分钟`}</p>`).join('') : '<p>暂无成本估算</p>'}</div><div class="output-card"><h3>${icon('shield')}方案保存</h3><p>${plan ? `已保存 · ${esc(plan.id)}<br>${date(plan.savedAt)} · ${plan.estimate.total} 模拟单位` : '尚未保存；失败步骤不会被标记为成功。'}</p></div>`;
}
let lastRender = '';
function renderResult(force = true) {
  const t = task();
  const signature = JSON.stringify([t, state.tab]);
  if (!force && signature === lastRender) return;
  lastRender = signature;
  $('#task-id').textContent = t ? `#${t.id.slice(0, 8).toUpperCase()}` : '等待创建';
  const [label, cls] = t ? statuses[t.status] : ['尚未开始', 'neutral'];
  $('#task-status').className = `badge ${cls}`; $('#task-status').textContent = label;
  $('#trace-count').textContent = t?.trace.length || 0;
  $('#export-button').disabled = !t;
  $$('[data-tab]').forEach(el => { el.classList.toggle('active', el.dataset.tab === state.tab); el.setAttribute('aria-selected', String(el.dataset.tab === state.tab)); });
  $('#result-content').innerHTML = state.tab === 'trace' ? renderTrace(t) : state.tab === 'outputs' ? outputs(t) : t ? overview(t) : emptyOverview();
  hydrateIcons($('#result-content'));
}
function art(material) {
  if (material.palette === 'amber') return `<svg viewBox="0 0 400 210" fill="none" aria-hidden="true"><defs><linearGradient id="sunset" x2="0" y2="1"><stop stop-color="#f3e5d2"/><stop offset="1" stop-color="#e6bda1"/></linearGradient></defs><path fill="url(#sunset)" d="M0 0h400v210H0z"/><circle cx="282" cy="75" r="40" fill="#fff3d8"/><path d="M0 155h30V96h40v59h14V65h46v90h18v-37h48v37h17v-60h41v60h33v-28h34v28h24V81h38v74h17v55H0z" fill="#c4ab98"/><path d="M0 184h51v-60h35v60h39v-42h51v42h25v-61h58v61h47v-44h57v44h37v26H0z" fill="#927f72"/><path d="M24 210 181 157l91 53" fill="#e8cbb4"/><path d="m183 166 61 44M175 171l-99 39" stroke="#f4e0c9" stroke-width="2"/><path d="M104 80h5m8 0h5m-18 14h5m8 0h5M224 111h5m7 0h5m-17 12h5m7 0h5" stroke="#f0d9ba" stroke-width="4"/><path d="m266 37 6-2 6 2m-20-6 4-2 4 2" stroke="#ba9f86"/></svg>`;
  if (material.palette === 'violet') return `<svg viewBox="0 0 400 210" fill="none" aria-hidden="true"><path fill="#e7e1ed" d="M0 0h400v210H0z"/><ellipse cx="200" cy="184" rx="120" ry="16" fill="#d3c9de"/><circle cx="256" cy="76" r="69" fill="#d4c9e2"/><path d="m128 111 64-31 63 31-63 32z" fill="#f9f4ff"/><path d="M128 111v72l64 27v-67z" fill="#b6a5c8"/><path d="M255 111v72l-63 27v-67z" fill="#c9b8dd"/><rect x="172" y="52" width="43" height="65" rx="11" transform="rotate(-12 172 52)" fill="#9182ab"/><path d="m184 60 27-6m-23 47 27-6" stroke="#c4b8d3" stroke-width="2"/><circle cx="291" cy="151" r="22" fill="#e7ba9f"/><path d="m88 53 9 8-9 8-9-8z" fill="#c8b3db"/><path d="M305 39v18m-9-9h18" stroke="#f5f0fa" stroke-width="2"/></svg>`;
  return `<svg viewBox="0 0 400 210" fill="none" aria-hidden="true"><path fill="#e2e9dd" d="M0 0h400v210H0z"/><path d="M0 156q80-70 155-3t245-33v90H0z" fill="#bdc9af"/><circle cx="287" cy="56" r="30" fill="#f6eed0"/><path d="M0 185q82-61 170-8t230-5v38H0z" fill="#91a58a"/><rect x="132" y="32" width="87" height="150" rx="13" transform="rotate(12 132 32)" fill="#f8f7eb"/><rect x="139" y="43" width="69" height="124" rx="6" transform="rotate(12 139 43)" fill="#cbd6bf"/><path d="m124 122 33-19 37 35-3 12-70-14z" fill="#8faaa0"/><circle cx="177" cy="80" r="13" fill="#f4e5b9"/><path d="M270 182v-64m0 25c-28-7-21-32-21-32 26 4 21 32 21 32Zm1 16c26-6 22-32 22-32-25 4-22 32-22 32Z" fill="#7c987c" stroke="#7c987c" stroke-width="2"/><path d="m102 67 3 8 8 3-8 3-3 8-3-8-8-3 8-3z" fill="#f7f5dc"/></svg>`;
}
function renderLibrary() {
  const materials = state.config?.catalog.materials || [];
  $('#material-library').innerHTML = materials.filter(m => state.tier === 'all' || m.tier === state.tier).map(m => `<article class="material-card"><div class="material-art ${m.palette}-art">${art(m)}<span class="material-type">${m.tier === 'premium' ? '精选素材 PREMIUM' : '轻量素材 ESSENTIAL'}</span></div><div class="material-info"><h3>${esc(m.title)}</h3><p>${esc(m.description)}</p><div class="material-tags">${m.tags.map(tag => `<span>${esc(tag)}</span>`).join('')}</div><div class="material-meta"><span><strong>${m.licenseCost + m.productionCost}</strong>单位 / 完整制作</span><span>预计 ${m.durationMinutes} 分钟</span></div><button class="button secondary" data-use-material="${m.id}">${icon('plus')}以此激发一个计划</button></div></article>`).join('');
}
function dialog(title, html) { $('#dialog-title').textContent = title; $('#dialog-body').innerHTML = html; $('#info-dialog').showModal(); }
function modeInfo() {
  dialog('透明的运行方式', `<p><strong>当前模式：${state.config?.mode === 'openai' ? '真实模型' : '离线 Mock'}</strong></p><p>离线模式使用确定性规则策略，根据工具结果演示预算调整、异常处理与续跑。它仅验证流程，不能证明真实模型决策效果。</p><p>真实模式在服务端配置 <strong>AGENT_MODEL_MODE=openai</strong> 及 API 密钥后启用。每轮模型读取当前状态和工具返回，选择下一动作。密钥不会传入网页。</p><p>业务工具均为本地工具；素材为原创合成资料，脚本使用本地模板。费用是预计制作成本，不产生实际扣款。</p>`);
}
function applyTemplate(name) {
  const templates = { travel: ['城市漫游 · 发现身边的美好', 10], launch: ['新品发布 · 为下一次心动预热', 15], weekend: ['周末生活提案 · 给日常一点新鲜感', 8] };
  const [theme, budget] = templates[name] || templates.travel;
  state.selected = null; localStorage.removeItem('pilot-selected'); state.tab = 'overview';
  $('#theme').value = theme; $('#budget').value = budget; $('#scenario').value = 'normal'; setDeadline(); $('#theme-count').textContent = `${theme.length} / 120`; $('#form-error').hidden = true; setView('workspace'); renderResult(); $('#theme').focus();
}
async function refresh() {
  try {
    const data = await api('/api/tasks'); state.tasks = data.tasks; state.online = true;
    renderStats(); renderRecent(); renderResult(false); if (state.view === 'history') renderHistory();
    $('.online').innerHTML = `<i></i>${state.tasks.some(active) ? 'Agent 执行中' : 'Agent 就绪'}`;
  } catch { state.online = false; $('.online').textContent = '服务连接中断'; }
}
let pendingRequest = null;
$('#brief-form').addEventListener('submit', async event => {
  event.preventDefault(); if (state.busy) return;
  const theme = $('#theme').value.trim(), budgetValue = $('#budget').value, deadlineValue = $('#deadline').value;
  const errors = [];
  if (!theme) errors.push('请先填写内容主题');
  if (!budgetValue || Number(budgetValue) <= 0 || Number(budgetValue) > 1000000) errors.push('请填写大于 0 且不超过 1,000,000 的预算');
  if (!deadlineValue || !Number.isFinite(new Date(deadlineValue).getTime()) || new Date(deadlineValue).getTime() <= Date.now()) errors.push('请选择未来的截止时间');
  const maxSteps = Number($('#max-steps').value);
  if (!Number.isInteger(maxSteps) || maxSteps < 1 || maxSteps > 32) errors.push('工具调用上限须为 1–32 的整数');
  if (errors.length) { $('#form-error').textContent = errors.join('；'); $('#form-error').hidden = false; return; }
  $('#form-error').hidden = true; state.busy = true; $('#start-button').disabled = true;
  const body = { theme, budget: Number(budgetValue), deadline: new Date(deadlineValue).toISOString(), scenario: $('#scenario').value, maxSteps };
  const fingerprint = JSON.stringify(body);
  if (pendingRequest?.fingerprint !== fingerprint) pendingRequest = { fingerprint, key: crypto.randomUUID() };
  try {
    const result = await api('/api/tasks', { method: 'POST', body: JSON.stringify({ ...body, requestKey: pendingRequest.key }) });
    pendingRequest = null; state.tasks = [result.task, ...state.tasks.filter(t => t.id !== result.task.id)]; selectTask(result.task.id); renderStats(); renderRecent();
    toast(result.reused ? '已复用原任务，无新增工具调用' : '计划已启程，Agent 正在安排下一步');
  } catch (error) { $('#form-error').textContent = `${error.message}。再次提交会复用请求编号，避免重复创建。`; $('#form-error').hidden = false; }
  finally { state.busy = false; $('#start-button').disabled = false; }
});
$('#theme').addEventListener('input', () => { $('#theme-count').textContent = `${$('#theme').value.length} / 120`; });
$('#new-task').addEventListener('click', () => { state.selected = null; localStorage.removeItem('pilot-selected'); state.tab = 'overview'; $('#brief-form').reset(); setDeadline(); $('#theme-count').textContent = '0 / 120'; $('#form-error').hidden = true; renderResult(); $('#theme').focus(); });
$('#export-button').addEventListener('click', () => { if (task()) { const a = document.createElement('a'); a.href = `/api/tasks/${task().id}/export`; a.download = `content-pilot-${task().id}.json`; a.click(); toast('已导出方案、状态与完整工具轨迹'); } });
document.addEventListener('click', async event => {
  const view = event.target.closest('[data-view]'); if (view) { setView(view.dataset.view); return; }
  const template = event.target.closest('[data-template]'); if (template) { applyTemplate(template.dataset.template); return; }
  const selected = event.target.closest('[data-task]'); if (selected) { if ($('#info-dialog').open) $('#info-dialog').close(); selectTask(selected.dataset.task); return; }
  const tab = event.target.closest('[data-tab]'); if (tab) { state.tab = tab.dataset.tab; renderResult(); return; }
  const tier = event.target.closest('[data-tier]'); if (tier) { state.tier = tier.dataset.tier; $$('[data-tier]').forEach(b => b.classList.toggle('active', b === tier)); renderLibrary(); return; }
  const use = event.target.closest('[data-use-material]'); if (use) { const m = state.config.catalog.materials.find(m => m.id === use.dataset.useMaterial); applyTemplate(m.tier === 'premium' ? 'launch' : 'weekend'); toast(`已填入灵感任务。Agent 会根据预算自行选择可行素材。`); return; }
  const resume = event.target.closest('#resume-button'); if (resume && task()) {
    resume.disabled = true;
    try { const data = await api(`/api/tasks/${task().id}/resume`, { method: 'POST', body: '{}' }); state.tasks = state.tasks.map(t => t.id === data.task.id ? data.task : t); renderResult(); toast('已基于成功结果续跑，工具调用上限保持不变'); } catch (error) { toast(error.message); resume.disabled = false; }
  }
  const repeat = event.target.closest('#repeat-button'); if (repeat && task()) {
    const t = task(); repeat.disabled = true;
    try { const data = await api('/api/tasks', { method: 'POST', body: JSON.stringify({ ...t.input, requestKey: t.requestKey }) }); toast(data.reused ? '重复请求已去重：复用同一任务，无新增调用或费用' : '任务已创建'); } catch (error) { toast(error.message); } finally { repeat.disabled = false; }
  }
  const copy = event.target.closest('[data-copy]'); if (copy && task()) {
    const script = task().results.plan?.script || task().results.scripts.at(-1);
    try { await navigator.clipboard.writeText(`${script.title}\n\n${script.scenes.map(s => `${s.time} ${s.title}\n画面：${s.visual}\n旁白：${s.narration}`).join('\n\n')}\n\n${script.caption}\n${script.hashtags.join(' ')}`); toast('分镜与文案已复制'); } catch { toast('浏览器未允许剪贴板访问，可通过导出获取完整文案'); }
  }
});
$('#history-search').addEventListener('input', renderHistory); $('#history-filter').addEventListener('change', renderHistory);
$('#mode-info').addEventListener('click', modeInfo);
$('#help-open').addEventListener('click', () => dialog('把一个灵感，变成可执行的计划', '<p><strong>01 · 写下目标</strong><br>填写内容主题、预算和截止时间，或点击侧栏的灵感起点。</p><p><strong>02 · 让 Agent 规划</strong><br>系统检索素材、生成脚本、估算成本并保存方案。预算或时间不够时会尝试轻量方案；没有可行方案时明确停止。</p><p><strong>03 · 查看每一步</strong><br>「执行轨迹」显示动作依据和工具返回，「全部产物」保留已成功结果。高级选项可注入失败，验证恢复逻辑。</p><p><strong>04 · 继续或导出</strong><br>失败任务可从成功结果续跑；相同请求编号会去重。导出包含完整任务、方案与轨迹的 JSON。</p>'));
$('#dialog-close').addEventListener('click', () => $('#info-dialog').close());
$('#info-dialog').addEventListener('click', e => { if (e.target === $('#info-dialog')) { const r = $('#info-dialog').getBoundingClientRect(); if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) $('#info-dialog').close(); } });
function openSearch() {
  dialog('找到一个灵感', '<input id="global-search" placeholder="搜索你的内容任务…" aria-label="搜索任务"><div id="global-results"></div>');
  const render = () => { const q = $('#global-search').value.toLowerCase(); const found = state.tasks.filter(t => (t.input.theme || '').toLowerCase().includes(q)); $('#global-results').innerHTML = found.slice(0, 8).map(t => `<button class="dialog-result" data-task="${t.id}">${esc(t.input.theme || '未命名任务')}<span>${statuses[t.status][0]}</span></button>`).join('') || '<p>没有匹配任务，去创建下一个好计划吧。</p>'; };
  $('#global-search').addEventListener('input', render); render(); $('#global-search').focus();
}
$('#search-open').addEventListener('click', openSearch);
document.addEventListener('keydown', e => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); if (!$('#info-dialog').open) openSearch(); } if ((e.ctrlKey || e.metaKey) && e.key === '1') { e.preventDefault(); setView('workspace'); } });
hydrateIcons(); setDeadline(); $('#theme').value = '城市漫游 · 发现身边的美好'; $('#theme-count').textContent = `${$('#theme').value.length} / 120`; renderResult();
try { state.config = await api('/api/config'); if (state.config.mode === 'openai') { $('#mode-title').textContent = '真实模型模式'; $('#mode-copy').innerHTML = '模型观察每次工具结果，<br>动态选择下一步行动。'; } await refresh(); } catch (error) { toast(`服务暂不可用：${error.message}`); }
setInterval(() => { if (!document.hidden) refresh(); }, 1500);
window.addEventListener('focus', refresh);
