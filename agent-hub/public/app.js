import { applyEvent } from '/reduce.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const EXAMPLES = {
  assistant: ['帮我查一下最近一周 AI agent 领域的重要发布，给出来源', '记住：我的公司做跨境电商 SaaS，回答尽量简洁', '为我们的产品做一份融资 pitch，并找 5 家可能感兴趣的客户'],
  pitch: ['为一家做 AI 客服的 SaaS 公司做 10 页融资 pitch，面向种子轮投资人。公司信息：……', '根据这个官网做一份销售 pitch：https://', '把第 3 页改得更有冲击力，用一个大数字开场'],
  sales: ['我们卖面向中小电商的库存管理软件，帮我找 5 家东南亚的潜在客户并起草邮件', '看看我拒绝过哪些线索，据此调整后再找 5 家', '给得分最高的三家各写一封跟进邮件'],
  coding: ['看一下这个仓库的结构，告诉我怎么运行测试', '修复失败的测试，并说明原因', '给这个函数加上输入校验，并补一个测试'],
};
const TOOL_LABEL = { web_search: '搜索', web_fetch: '读取网页', read_file: '读文件', write_file: '写文件', edit_file: '改文件', glob: '找文件', grep: '搜索代码', bash: '运行命令', remember: '记住', forget: '忘记', delegate: '委派', save_fact: '记录事实', write_deck: '生成 pitch', save_lead: '保存线索', draft_email: '起草邮件', list_leads: '查看线索' };

let state = null;
let agent = localStorage.getItem('agent') || 'assistant';
let sessionId = null;
let items = [];
let busy = false;
let deckUrl = null;
let sideMode = null; // 'deck' | 'leads'

const api = async (path, opts = {}) => {
  const res = await fetch(path, { ...opts, headers: { 'content-type': 'application/json' }, body: opts.body ? JSON.stringify(opts.body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `请求失败 (${res.status})`);
  return data;
};

// ---------- markdown (small, escaped first) ----------
function md(src) {
  const blocks = [];
  let text = esc(src).replace(/```(\w*)\n?([\s\S]*?)(```|$)/g, (_, _lang, code) => {
    blocks.push(`<pre><code>${code.replace(/\n$/, '')}</code></pre>`);
    return `\u0000${blocks.length - 1}\u0000`;
  });
  const inline = (s) =>
    s
      .replace(/`([^`\n]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
      .replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
      .replace(/(^|[\s(（])(https?:\/\/[^\s<)）]+)/g, '$1<a href="$2" target="_blank" rel="noopener">$2</a>');
  const out = [];
  let list = null;
  const flush = () => {
    if (list) out.push(`<${list.tag}>${list.rows.map((r) => `<li>${r}</li>`).join('')}</${list.tag}>`);
    list = null;
  };
  for (const para of text.split(/\n{2,}/)) {
    for (const line of para.split('\n')) {
      const h = /^(#{1,4})\s+(.*)$/.exec(line);
      const ul = /^\s*[-*•]\s+(.*)$/.exec(line);
      const ol = /^\s*\d+[.)]\s+(.*)$/.exec(line);
      if (ul || ol) {
        const tag = ul ? 'ul' : 'ol';
        if (!list || list.tag !== tag) {
          flush();
          list = { tag, rows: [] };
        }
        list.rows.push(inline((ul || ol)[1]));
      } else {
        flush();
        if (/^\u0000\d+\u0000$/.test(line.trim())) out.push(line.trim());
        else if (h) out.push(`<h${Math.min(4, h[1].length + 2)}>${inline(h[2])}</h${Math.min(4, h[1].length + 2)}>`);
        else if (line.trim()) out.push(`<p>${inline(line)}</p>`);
      }
    }
    flush();
  }
  return out.join('').replace(/\u0000(\d+)\u0000/g, (_, i) => blocks[i]);
}

// ---------- rendering ----------
const agentName = (id) => state.agents.find((a) => a.id === id)?.name || id;

function brief(item) {
  const i = item.input || {};
  return i.command || i.query || i.url || i.path || i.pattern || i.company || i.title || i.task || i.claim || i.text || i.lead_id || '';
}

// The verification stamp at the end of a run: how the work was checked, or that it was not.
const STAMP = {
  verified: { cls: 'ok', title: '已验证', hint: '检查是在最后一次改动之后通过的' },
  failed: { cls: 'bad', title: '检查未通过', hint: '' },
  escalated: { cls: 'bad', title: '已停下，等你决定', hint: '同一类检查连续几轮都没通过，没有再继续改' },
  none: { cls: 'warn', title: '未验证', hint: '改了文件，但没有一项可信的检查通过' },
  stale: { cls: 'warn', title: '验证已过期', hint: '检查通过之后又改了文件' },
};
// Why an approval cannot be covered by "allow for this conversation".
const WHY = {
  protected: '这会改动用来检查这次修改的测试或规则文件，所以每次都要你单独同意。',
  destructive: '这个命令可能删掉或覆盖东西，所以每次都要你单独同意。',
};

function stampHtml(item) {
  const s = STAMP[item.status];
  if (!s) return '';
  const checks = (item.checks || [])
    .map((c) => `<li class="${c.pass ? 'pass' : 'fail'}">${c.pass ? '✓' : '✗'} ${esc(c.label)}${!c.pass && c.rounds > 1 ? `（已 ${c.rounds} 轮）` : ''}</li>`)
    .join('');
  const hint = item.status === 'none' && item.inconclusive ? `${s.hint}（有检查的结果被管道或 “|| true” 盖住了，不算数）` : s.hint;
  return `<div class="stamp ${s.cls}${item.depth ? ' sub' : ''}"><b>${s.title}</b>${hint ? `<span>${esc(hint)}</span>` : ''}${checks ? `<ul>${checks}</ul>` : ''}</div>`;
}

function itemHtml(item) {
  const sub = item.depth ? ' sub' : '';
  switch (item.type) {
    case 'user':
      return `<div class="msg user">${esc(item.text)}</div>`;
    case 'start':
      return item.depth ? `<div class="who sub"><b>↳ ${esc(agentName(item.agent))}</b>接手任务 · ${esc(item.model || '')}</div>` : '';
    case 'text':
      return `<div class="msg text${sub}">${md(item.text)}</div>`;
    case 'tool': {
      // A check that ran and failed is not a tool error, but it must not look like a success either.
      const cls = item.state === 'running' ? 'running' : item.isError || item.check === 'fail' ? 'error' : '';
      const chk = item.check ? `<span class="chk ${item.check}">${{ pass: '检查通过', fail: '检查未通过', unclear: '结果不算数' }[item.check] || ''}</span>` : '';
      const body = `${item.input && Object.keys(item.input).length ? JSON.stringify(item.input, null, 2) : ''}${item.result ? `\n\n→ ${item.result}` : ''}`.trim();
      return `<details class="tool ${cls}${sub}"><summary><span class="dot"></span><span class="name">${esc(TOOL_LABEL[item.name] || item.name)}</span><span class="brief">${esc(brief(item))}</span>${chk}</summary>${body ? `<pre>${esc(body)}</pre>` : ''}</details>`;
    }
    case 'approval': {
      const what = item.tool === 'bash' ? item.input.command : JSON.stringify(item.input, null, 2);
      if (item.state !== 'pending') return `<div class="approval done">${item.state === 'allowed' ? '已允许' : '已拒绝'}：${esc(TOOL_LABEL[item.tool] || item.tool)}</div>`;
      const always = item.tier === 'exec' ? '本次对话都允许命令' : '本次对话都允许改文件';
      const why = WHY[item.why] || '';
      // An action that always asks cannot be covered by a blanket approval, so that button is not offered.
      return `<div class="approval" data-approval="${esc(item.id)}"><div><b>${esc(agentName(item.agent))}</b> 想要${esc(TOOL_LABEL[item.tool] || item.tool)}，需要你同意：</div>${why ? `<div class="why">${why}</div>` : ''}<pre>${esc(what)}</pre><div class="row"><button data-act="allow" type="button">允许</button>${why ? '' : `<button data-act="always" class="ghost" type="button">${always}</button>`}<button data-act="deny" class="danger" type="button">拒绝</button></div></div>`;
    }
    case 'notice':
      return `<div class="note">${esc(item.text)}</div>`;
    case 'error':
      return `<div class="note error">${esc(item.text)}</div>`;
    case 'deck':
      return `<div class="deck-link"><span>📑 ${esc(item.title || 'Pitch')}</span><button class="ghost small" data-deck="${esc(item.url)}" type="button">查看</button><a href="${esc(item.url)}" target="_blank" rel="noopener">新窗口</a></div>`;
    case 'verification':
      return stampHtml(item);
    default:
      return '';
  }
}

function renderMessages() {
  const box = $('messages');
  if (!items.length) {
    const a = state.agents.find((x) => x.id === agent);
    box.innerHTML = `<div class="empty"><h1>${esc(a.name)}</h1><p>${esc(a.tagline)}</p><div class="examples">${EXAMPLES[agent].map((e) => `<button type="button" data-example="${esc(e)}">${esc(e)}</button>`).join('')}</div></div>`;
    return;
  }
  // Keep tool cards the user opened from snapping shut on every streamed token.
  const open = new Set([...box.querySelectorAll('details[open]')].map((d) => d.dataset.k));
  const nearBottom = $('scroll').scrollHeight - $('scroll').scrollTop - $('scroll').clientHeight < 120;
  box.innerHTML = items.map((it, k) => itemHtml(it).replace(/^<details /, `<details data-k="${k}" ${open.has(String(k)) ? 'open ' : ''}`)).join('') + (busy ? '<div class="typing">运行中…</div>' : '');
  if (nearBottom) $('scroll').scrollTop = $('scroll').scrollHeight;
}

function renderRail() {
  $('agents').innerHTML = state.agents.map((a) => `<button type="button" class="agent${a.id === agent ? ' active' : ''}" data-agent="${a.id}"><b>${esc(a.name)}</b><small>${esc(a.tagline)}</small></button>`).join('');
  $('sessions').innerHTML =
    state.sessions.map((s) => `<div class="session${s.id === sessionId ? ' active' : ''}" data-session="${s.id}"><span>${esc(s.title || '未命名')}</span><em>${esc(agentName(s.agent))}</em><button class="icon" data-del="${s.id}" type="button" aria-label="删除">✕</button></div>`).join('') || '<div class="hint">还没有对话</div>';
  const a = state.agents.find((x) => x.id === agent);
  const prov = state.resolved[agent];
  $('agent-name').textContent = a.name;
  $('agent-model').textContent = prov ? `${state.config.providers[prov]?.label || '模拟模型'} · ${state.config.providers[prov]?.model || 'mock'}` : '未配置模型';
  const banner = $('setup-banner');
  if (!prov) {
    banner.hidden = false;
    banner.innerHTML = '还没有可用的模型。填入任意一家的 API key 并选择模型后即可开始。<button type="button" class="small" id="banner-settings">打开设置</button>';
  } else if (agent === 'coding' && !state.config.codingWorkspace) {
    banner.hidden = false;
    banner.innerHTML = '编程 agent 需要一个工作目录（你的代码仓库路径）。<button type="button" class="small" id="banner-settings">打开设置</button>';
  } else banner.hidden = true;
  const btn = $('toggle-side');
  btn.hidden = !(agent === 'sales' || deckUrl);
  btn.textContent = agent === 'sales' ? '线索与审批' : '查看 pitch';
}

// ---------- side panel ----------
function showDeck(url) {
  deckUrl = url;
  sideMode = 'deck';
  $('side').hidden = false;
  $('side-title').textContent = 'Pitch 预览';
  $('side-actions').innerHTML = `<a class="small" href="${esc(url)}" target="_blank" rel="noopener">新窗口打开</a>`;
  $('side-body').innerHTML = `<iframe sandbox="allow-scripts allow-modals allow-popups" src="${esc(url)}?t=${Date.now()}" title="Pitch"></iframe>`;
}

async function showLeads() {
  sideMode = 'leads';
  $('side').hidden = false;
  $('side-title').textContent = '线索与审批';
  $('side-actions').innerHTML = '<a class="small" href="/api/leads.csv">导出 CSV</a>';
  const { leads, suppressed } = await api('/api/leads');
  const order = { pending: 0, new: 1, approved: 2, rejected: 3 };
  leads.sort((a, b) => order[a.status] - order[b.status] || b.score - a.score);
  const label = { new: '待起草', pending: '待你审批', approved: '已批准', rejected: '已拒绝' };
  $('side-body').innerHTML = `<div class="leads">${
    leads.length
      ? leads
          .map((l) => {
            const d = l.draft;
            const mailto = d ? `mailto:${encodeURIComponent(l.email || '')}?subject=${encodeURIComponent(d.subject)}&body=${encodeURIComponent(d.body)}` : '';
            return `<div class="lead" data-lead="${l.id}">
<h4><span>${esc(l.company)} <small class="off">${esc(l.domain)}</small></span><span class="badge">${l.score} 分</span><span class="badge ${l.status}">${label[l.status]}</span></h4>
${l.contactName ? `<div class="off">${esc(l.contactName)} · ${esc(l.contactRole)} ${esc(l.email)}</div>` : ''}
<ul>${l.reasons.map((r) => `<li>${esc(r.text)} <a href="${esc(r.source)}" target="_blank" rel="noopener">来源</a></li>`).join('')}</ul>
${d ? `<input data-f="subject" value="${esc(d.subject)}" ${l.status === 'pending' ? '' : 'readonly'}><textarea data-f="body" ${l.status === 'pending' ? '' : 'readonly'}>${esc(d.body)}</textarea>` : ''}
${l.rejectReason ? `<div class="off">拒绝原因：${esc(l.rejectReason)}</div>` : ''}
<div class="row">${
              l.status === 'pending' ? '<button class="small" data-lead-act="approve" type="button">批准</button><button class="small ghost" data-lead-act="reject" type="button">拒绝</button>' : ''
            }${l.status === 'approved' ? `<a class="small" href="${mailto}">在邮件客户端打开</a><button class="small ghost" data-lead-act="copy" type="button">复制正文</button>` : ''}${
              l.status !== 'rejected' ? '<button class="small danger" data-lead-act="suppress" type="button">不再联系</button>' : ''
            }</div></div>`;
          })
          .join('')
      : '<div class="hint">还没有线索。告诉销售 agent 你的理想客户，它找到的公司和起草的邮件会出现在这里，等你批准。<br><br>这里不会自动发送任何邮件：批准后由你自己发出。</div>'
  }${suppressed.length ? `<div class="hint">不再联系名单：${suppressed.map(esc).join('、')}</div>` : ''}</div>`;
}

// ---------- chat ----------
async function sendMessage(text) {
  if (busy || !text.trim()) return;
  busy = true;
  $('send').hidden = true;
  $('stop').hidden = false;
  $('input').value = '';
  autosize();
  try {
    const res = await fetch('/api/chat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sessionId, agent, text }) });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `请求失败 (${res.status})`);
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        if (!line) continue;
        const ev = JSON.parse(line);
        if (ev.type === 'session') sessionId = ev.id;
        else applyEvent(items, ev);
        if (ev.type === 'deck') showDeck(ev.url);
        if (ev.type === 'tool_result' && ['save_lead', 'draft_email'].includes(ev.name) && agent === 'sales') showLeads();
      }
      renderMessages();
    }
  } catch (e) {
    applyEvent(items, { type: 'error', text: e.message });
  } finally {
    busy = false;
    $('send').hidden = false;
    $('stop').hidden = true;
    renderMessages();
    state = await api('/api/state');
    renderRail();
  }
}

async function openSession(id) {
  const s = await api(`/api/sessions/${id}`);
  sessionId = s.id;
  agent = s.agent;
  localStorage.setItem('agent', agent);
  items = s.transcript || [];
  deckUrl = s.deckUrl;
  $('side').hidden = true;
  if (deckUrl) showDeck(deckUrl);
  renderRail();
  renderMessages();
  $('scroll').scrollTop = $('scroll').scrollHeight;
}

function newChat(nextAgent = agent) {
  agent = nextAgent;
  localStorage.setItem('agent', agent);
  sessionId = null;
  items = [];
  deckUrl = null;
  $('side').hidden = true;
  if (agent === 'sales' && innerWidth > 900) showLeads();
  renderRail();
  renderMessages();
  $('input').focus();
}

// ---------- settings ----------
function renderSettings() {
  const c = state.config;
  const provs = Object.entries(c.providers)
    .map(
      ([id, p]) => `<div class="prov" data-prov="${id}">
<div class="head"><span>${esc(p.label)}</span>${p.ready ? '<span class="ok">可用</span>' : `<span class="off">${p.hasKey ? '请选择模型' : '未配置'}</span>`}</div>
<label class="field">API key<input type="password" data-k="apiKey" autocomplete="off" placeholder="${p.hasKey ? `已保存 ${esc(p.keyHint)}${p.fromEnv ? '（来自环境变量）' : ''}` : '粘贴 key'}"><span></span></label>
<label class="field">模型<input data-k="model" list="models-${id}" value="${esc(p.model)}" placeholder="点右侧按钮获取可用模型"><button type="button" class="ghost small" data-models="${id}">获取列表</button></label>
<datalist id="models-${id}"></datalist>
${id === 'anthropic' ? '' : `<label class="field">接口地址<input data-k="baseURL" value="${esc(p.baseURL)}" placeholder="默认"><span></span></label>`}
</div>`,
    )
    .join('');
  const assign = state.agents
    .map((a) => `<label class="field">${esc(a.name)}<select data-assign="${a.id}">${Object.entries(c.providers).map(([id, p]) => `<option value="${id}"${c.agents[a.id] === id ? ' selected' : ''}>${esc(p.label)}</option>`).join('')}</select><span class="off">${state.resolved[a.id] && state.resolved[a.id] !== c.agents[a.id] ? `当前用 ${esc(c.providers[state.resolved[a.id]]?.label || '')}` : ''}</span></label>`)
    .join('');
  $('settings-body').innerHTML = `
<h3>模型厂商</h3><p>填任意一家就能用。key 只保存在这台电脑的 data/config.json 里。</p>${provs}
<h3>每个 agent 用哪家</h3><p>指定的厂商未配置时，会自动改用已配置的那家。</p>${assign}
<h3>编程 agent 的工作目录</h3><p>你的代码仓库的完整路径。编程 agent 只能读写这个目录，改文件和运行命令前都会先问你。</p>
<label class="field">路径<input id="coding-ws" value="${esc(c.codingWorkspace)}" placeholder="/Users/you/projects/my-app"><span></span></label>
<h3>联网搜索</h3><p>用 Claude 时由 Anthropic 的搜索工具完成。其他厂商默认用 DuckDuckGo；填入 Brave Search API key 更稳定。</p>
<label class="field">Brave key<input id="brave" type="password" autocomplete="off" placeholder="${c.hasBraveKey ? '已保存' : '可选'}"><span></span></label>
<h3>验收关卡</h3><p>每次任务结束都会盖章：已验证、未验证，或检查未通过。同一类检查连续 3 轮不过，agent 会停下来找你。“先观察”只记下哪些任务本该被拦；“严格”会把没验证的改动退回去先验证，最多退 2 次。</p>
<label class="field">模式<select id="verify-mode">${[['observe', '先观察（建议先用这个）'], ['enforce', '严格'], ['off', '关闭']].map(([v, t]) => `<option value="${v}"${c.verification?.mode === v ? ' selected' : ''}>${t}</option>`).join('')}</select><span></span></label>
<div id="verify-log" class="hint">加载中…</div>
<h3>记忆</h3><div id="memories" class="hint">加载中…</div>`;
  api('/api/verification').then(({ summary: v, recent }) => {
    const box = $('verify-log');
    if (!box) return;
    if (!v.total) {
      box.textContent = '还没有记录。agent 改过文件或跑过检查的任务会记在这里。';
      return;
    }
    const open = recent.filter((r) => r.status !== 'verified').slice(0, 5);
    box.className = '';
    box.innerHTML = `<p>最近 ${v.total} 次有记录的任务：已验证 ${v.verified} · 未验证 ${v.none + v.stale} · 检查未通过 ${v.failed} · 停下等你 ${v.escalated}。其中 ${v.wouldBlock} 次在“严格”模式下会被拦下。</p>${open
      .map((r) => `<div class="mem"><span>${esc(new Date(r.at).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }))} · ${esc(agentName(r.agent))} · ${esc(STAMP[r.status]?.title || r.status)}${r.checks?.length ? `：${esc(r.checks.map((k) => `${k.pass ? '✓' : '✗'} ${k.label}`).join('，'))}` : ''}</span></div>`)
      .join('')}`;
  });
  api('/api/memory').then(({ memories }) => {
    $('memories').className = '';
    $('memories').innerHTML = memories.length ? memories.map((m) => `<div class="mem"><span>${esc(m.text)}</span><button type="button" class="icon" data-forget="${m.id}" aria-label="删除">✕</button></div>`).join('') : '<p>助理还没有记住任何东西。</p>';
  });
}

async function saveSettings() {
  const patch = { providers: {}, agents: {}, codingWorkspace: $('coding-ws').value };
  for (const el of document.querySelectorAll('.prov')) {
    const p = {};
    for (const input of el.querySelectorAll('[data-k]')) {
      if (input.dataset.k === 'apiKey' && !input.value) continue; // empty means "keep the saved key"
      p[input.dataset.k] = input.value;
    }
    patch.providers[el.dataset.prov] = p;
  }
  for (const sel of document.querySelectorAll('[data-assign]')) patch.agents[sel.dataset.assign] = sel.value;
  if ($('brave').value) patch.braveKey = $('brave').value;
  patch.verification = { mode: $('verify-mode').value };
  state = await api('/api/config', { method: 'POST', body: patch });
  $('settings-status').textContent = '已保存';
  renderSettings();
  renderRail();
}

// ---------- events ----------
function autosize() {
  const t = $('input');
  t.style.height = 'auto';
  t.style.height = `${Math.min(180, t.scrollHeight)}px`;
}

$('composer').addEventListener('submit', (e) => {
  e.preventDefault();
  sendMessage($('input').value);
});
$('input').addEventListener('input', autosize);
$('input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    sendMessage($('input').value);
  }
});
$('stop').addEventListener('click', () => api('/api/stop', { method: 'POST', body: { sessionId } }));
$('new-chat').addEventListener('click', () => newChat());
$('toggle-rail').addEventListener('click', () => $('app').classList.toggle('rail-open'));
$('close-side').addEventListener('click', () => ($('side').hidden = true));
$('toggle-side').addEventListener('click', () => {
  if (!$('side').hidden) $('side').hidden = true;
  else if (agent === 'sales') showLeads();
  else if (deckUrl) showDeck(deckUrl);
});
$('open-settings').addEventListener('click', () => {
  $('settings-status').textContent = '';
  renderSettings();
  $('settings').showModal();
});
$('save-settings').addEventListener('click', () => saveSettings().catch((e) => ($('settings-status').textContent = e.message)));

document.addEventListener('click', async (e) => {
  const t = e.target.closest('button, .session, a');
  if (!t) {
    if ($('app').classList.contains('rail-open') && !e.target.closest('#rail')) $('app').classList.remove('rail-open');
    return;
  }
  if (t.id === 'banner-settings') return $('open-settings').click();
  if (t.dataset.agent) {
    $('app').classList.remove('rail-open');
    return newChat(t.dataset.agent);
  }
  if (t.dataset.del) {
    e.stopPropagation();
    await api(`/api/sessions/${t.dataset.del}`, { method: 'DELETE' });
    if (t.dataset.del === sessionId) newChat();
    state = await api('/api/state');
    return renderRail();
  }
  if (t.dataset.session) {
    $('app').classList.remove('rail-open');
    return openSession(t.dataset.session);
  }
  if (t.dataset.example) {
    $('input').value = t.dataset.example;
    autosize();
    return $('input').focus();
  }
  if (t.dataset.deck) return showDeck(t.dataset.deck);
  if (t.dataset.act) {
    const id = t.closest('[data-approval]').dataset.approval;
    const act = t.dataset.act;
    return api('/api/approve', { method: 'POST', body: { id, allow: act !== 'deny', always: act === 'always' } }).catch((err) => alert(err.message));
  }
  if (t.dataset.leadAct) {
    const card = t.closest('[data-lead]');
    const id = card.dataset.lead;
    const act = t.dataset.leadAct;
    if (act === 'copy') return navigator.clipboard.writeText(card.querySelector('[data-f=body]').value);
    const body = { action: act };
    if (act === 'approve') Object.assign(body, { subject: card.querySelector('[data-f=subject]').value, body: card.querySelector('[data-f=body]').value });
    if (act === 'reject') body.reason = prompt('拒绝原因（会告诉销售 agent，用来改进之后的线索）') || '';
    if (act === 'suppress' && !confirm('把这家公司加入“不再联系”名单？')) return;
    await api(`/api/leads/${id}`, { method: 'POST', body });
    return showLeads();
  }
  if (t.dataset.models) {
    const id = t.dataset.models;
    $('settings-status').textContent = '正在获取模型列表…';
    try {
      // Save first so a key typed a moment ago is the one used.
      await saveSettings();
      const { models } = await api(`/api/models?provider=${id}`);
      document.getElementById(`models-${id}`).innerHTML = models.map((m) => `<option value="${esc(m)}">`).join('');
      $('settings-status').textContent = `找到 ${models.length} 个模型，点模型输入框选择`;
      document.querySelector(`[data-prov="${id}"] [data-k=model]`).focus();
    } catch (err) {
      $('settings-status').textContent = err.message;
    }
    return;
  }
  if (t.dataset.forget) {
    await api(`/api/memory/${t.dataset.forget}`, { method: 'DELETE' });
    return renderSettings();
  }
});

state = await api('/api/state');
if (!state.agents.some((a) => a.id === agent)) agent = 'assistant';
newChat(agent);
