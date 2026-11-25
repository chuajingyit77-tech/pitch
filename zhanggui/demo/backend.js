// A stand-in for the server that runs entirely in the browser, so the interface can be tried from a
// plain web page with nothing installed. It answers the same requests as server.js with scripted
// agent runs and sample data kept in memory. Nothing here calls a model or the network.
import { applyEvent } from '../public/reduce.js';
import { renderDeck, reviewDeck } from '../src/deck.js';

const DAY = 86_400_000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let seq = 0;
const newId = (prefix) => `${prefix}_${(++seq).toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const now = () => new Date().toISOString();
const daysAgo = (n) => new Date(Date.now() - n * DAY).toISOString();

// Names and taglines mirror src/agents.js.
const AGENTS = [
  { id: 'assistant', name: '通用助理', tagline: '查资料、读写文件、记住偏好，并把专业任务交给其他 agent', group: 'agent' },
  { id: 'pitch', name: 'Pitch 生成', tagline: '调研、设计叙事，生成可直接分享的网页版 pitch', group: 'agent' },
  { id: 'sales', name: '销售获客', tagline: '找潜在客户、带来源打分、起草外联邮件，全部等你批准', group: 'agent' },
  { id: 'coding', name: '编程', tagline: '读懂代码库、修改、跑测试，改完自己验证', group: 'agent' },
  { id: 'relay', name: '接力', tagline: '一件事分成几棒，按顺序交接：上一棒的成果是下一棒的起点', group: 'team' },
  { id: 'quartet', name: '四重奏', tagline: '一个目标拆成几部分，几个 agent 同时做，最后合成一份结果', group: 'team' },
];
const agentName = (id) => AGENTS.find((a) => a.id === id).name;

// ---------- sample data ----------
const FOLLOWUPS = [
  '您好，\n\n补充一个数据：同类客户接入后，客服成本平均下降约四成。如果现在时机不合适，告诉我一声即可。',
  '您好，\n\n这是我最后一次打扰。如果之后客服压力变大，欢迎随时回复这封邮件。',
];
const emailFor = (company, hook) =>
  `您好，\n\n${hook}我们帮助和${company}规模相近的商家，把客服的首次响应时间降到一分钟以内。\n\n方便下周用 15 分钟聊聊吗？\n\n如不希望再收到此类邮件，回复“退订”即可。`;

const lead = (fields) => ({
  id: newId('lead'),
  contactName: '',
  contactRole: '',
  email: '',
  status: 'new',
  draft: null,
  createdAt: now(),
  ...fields,
});

const db = {
  sessions: [],
  memories: [],
  suppressed: [],
  codingWorkspace: '~/示例仓库',
  assign: { assistant: 'moonshot', pitch: 'anthropic', sales: 'xai', coding: 'openai', relay: 'anthropic', quartet: 'anthropic' },
  schedules: [
    { id: newId('sch'), name: '每日线索', agent: 'sales', prompt: '按我的理想客户找 3 家新线索并起草邮件', time: '09:00', days: 'weekdays', enabled: true, createdAt: now(), lastRunAt: null, lastSessionId: null, lastStatus: null },
  ],
  // Three leads at different stages, so the queue shows every state from the first look.
  leads: [
    lead({
      company: '青禾茶业',
      domain: 'qinghe-tea.example',
      contactRole: '电商负责人',
      email: 'hello@qinghe-tea.example',
      score: 86,
      reasons: [{ text: '上月开了第二家线上店，咨询量在涨', source: 'https://qinghe-tea.example/news' }],
      status: 'sent',
      draft: { subject: '关于青禾茶业新店的客服', body: emailFor('青禾茶业', '看到贵司上月开了第二家线上店。'), followups: FOLLOWUPS },
      createdAt: daysAgo(5),
      sentAt: daysAgo(4),
      lastTouchAt: daysAgo(4),
      followupsSent: 0,
    }),
    lead({
      company: '北岸咖啡',
      domain: 'northshore-coffee.example',
      contactRole: '运营经理',
      email: 'ops@northshore-coffee.example',
      score: 78,
      reasons: [{ text: '正在招聘夜班客服，说明夜间无人值守', source: 'https://northshore-coffee.example/careers' }],
      status: 'approved',
      draft: { subject: '夜间客服可以不用再招人', body: emailFor('北岸咖啡', '看到贵司正在招聘夜班客服。'), followups: FOLLOWUPS },
      createdAt: daysAgo(1),
    }),
    lead({
      company: '山野户外',
      domain: 'shanye-outdoor.example',
      contactRole: '创始人',
      score: 71,
      reasons: [{ text: '大促期间公开致歉回复太慢', source: 'https://shanye-outdoor.example/notice' }],
      status: 'replied',
      draft: { subject: '大促期间的客服响应', body: emailFor('山野户外', '看到贵司在大促后的公告。'), followups: FOLLOWUPS },
      createdAt: daysAgo(9),
      sentAt: daysAgo(8),
      lastTouchAt: daysAgo(8),
      followupsSent: 0,
      repliedAt: daysAgo(6),
    }),
  ],
};

// Each sales run in the demo finds the next of these.
const PROSPECTS = [
  { company: '木白家居', domain: 'mubai-home.example', role: '客服主管', score: 82, reason: '正在招聘客服主管，说明客服压力在增加', page: 'careers', hook: '看到贵司正在招聘客服主管。' },
  { company: '栗子烘焙', domain: 'lizi-bakery.example', role: '店铺运营', score: 76, reason: '新开了小程序商城，售前咨询全靠店员兼顾', page: 'news', hook: '看到贵司新开了小程序商城。' },
  { company: '远帆文具', domain: 'yuanfan-stationery.example', role: '电商经理', score: 69, reason: '开学季评论区多条“客服不回复”的反馈', page: 'reviews', hook: '注意到开学季有顾客反馈咨询没人回。' },
  { company: '半亩花田', domain: 'banmu-flowers.example', role: '创始人', score: 64, reason: '节日订单翻倍，公告说明回复会延迟', page: 'notice', hook: '看到贵司节日期间的延迟回复公告。' },
];
let prospectCursor = 0;

const DEMO_DECK = {
  title: '演示 Pitch',
  lang: 'zh',
  slides: [
    { layout: 'cover', kicker: 'Seed 轮', title: '让每个小团队都有一支 AI 客服', body: '演示数据，用于展示版式。', cta: '融资 300 万美元' },
    { layout: 'statement', kicker: '问题', title: '中小商家的客服，又贵又慢', body: '人工客服排班难、培训久，夜间和大促时响应最差。' },
    { layout: 'bullets', kicker: '为什么是现在', title: '三件事同时发生了', bullets: ['线上咨询量逐年上涨，店主自己回不过来', '模型已经能读懂商品资料并准确作答', '小团队也习惯了按月订阅软件'] },
    { layout: 'stats', kicker: '进展', title: '上线一年，数据说明需求真实', stats: [{ value: '12,000', label: '月活用户' }, { value: '40%', label: '客服成本下降' }, { value: '95%', label: '续费率（未提供来源）' }] },
    { layout: 'compare', kicker: '方案', title: '从“加人”变成“加一个 agent”', columns: [{ heading: '传统做法', points: ['招聘与培训周期长', '夜间无人值守', '成本随咨询量线性增长'] }, { heading: '我们的做法', points: ['当天接入', '全天候响应', '成本基本固定'] }] },
    { layout: 'chart', kicker: '效果', title: '首次响应时间对比', chart: { unit: ' 分钟', bars: [{ label: '我们', value: 1 }, { label: '行业平均', value: 9 }] } },
    { layout: 'closing', title: '一起把客服变成增长引擎', cta: 'hello@example.com' },
  ],
};

// ---------- leads ----------
const GAPS = [3, 4];
function followupDueAt(l) {
  if (l.status !== 'sent') return null;
  const n = l.followupsSent || 0;
  return n >= GAPS.length ? null : Date.parse(l.lastTouchAt || l.sentAt) + GAPS[n] * DAY;
}
const followupDue = (l) => followupDueAt(l) !== null && Date.now() >= followupDueAt(l);
const salesTodo = () => db.leads.filter((l) => l.status === 'pending' || followupDue(l)).length;

function leadAction(l, body) {
  const t = now();
  if (body.action === 'approve') Object.assign(l, { status: 'approved', draft: { ...l.draft, subject: body.subject ?? l.draft?.subject, body: body.body ?? l.draft?.body } });
  else if (body.action === 'sent' && l.status === 'approved') Object.assign(l, { status: 'sent', sentAt: t, lastTouchAt: t, followupsSent: 0 });
  else if (body.action === 'followup_sent' && l.status === 'sent') Object.assign(l, { followupsSent: (l.followupsSent || 0) + 1, lastTouchAt: t });
  else if (body.action === 'replied' && l.status === 'sent') Object.assign(l, { status: 'replied', repliedAt: t });
  else if (body.action === 'reject') Object.assign(l, { status: 'rejected', rejectReason: String(body.reason || '').slice(0, 300) });
  else if (body.action === 'suppress') {
    db.suppressed.push(l.domain);
    Object.assign(l, { status: 'rejected', rejectReason: 'do not contact' });
  }
  return l;
}

// ---------- decks ----------
window.__deckHtml = {};
const deckData = {};
const deckWaiting = new Map();
addEventListener('message', (e) => {
  const url = e.data && e.data.zhangguiDeckReady;
  if (url && deckWaiting.has(url)) {
    clearTimeout(deckWaiting.get(url));
    deckWaiting.delete(url);
  }
});
const escapeHtml = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

/** If the host page refuses to show the framed deck, list the slides as plain text instead of leaving a blank panel. */
function plainDeck(deck) {
  const part = (s) => {
    const lines = [...(s.bullets || []), ...(s.stats || []).map((x) => `${x.value} ${x.label}`), ...(s.columns || []).flatMap((c) => [c.heading, ...c.points.map((p) => `· ${p}`)]), ...(s.chart?.bars || []).map((b) => `${b.label}：${b.value}${s.chart.unit || ''}`)];
    return `<div class="lead"><div class="off">${escapeHtml(s.kicker || '')}</div><h4><span>${escapeHtml(s.title)}</span></h4>${s.body ? `<div>${escapeHtml(s.body)}</div>` : ''}${lines.length ? `<ul>${lines.map((l) => `<li>${escapeHtml(l)}</li>`).join('')}</ul>` : ''}${s.cta ? `<div><b>${escapeHtml(s.cta)}</b></div>` : ''}</div>`;
  };
  return `<div class="leads"><div class="hint">这个页面无法显示完整的版式预览，下面是每一页的文字内容。</div>${deck.slides.map(part).join('')}</div>`;
}

window.__deckShown = (frame, url) => {
  clearTimeout(deckWaiting.get(url));
  const giveUp = () => {
    deckWaiting.delete(url);
    if (frame.isConnected) frame.outerHTML = plainDeck(deckData[url]);
  };
  deckWaiting.set(url, setTimeout(giveUp, window.__forceDeckFallback ? 0 : 2500));
};

function publishDeck(deck, facts) {
  const url = `demo-deck:${newId('d')}`;
  // A hosted page cannot print, so the export button is hidden; the framed deck reports back once it has drawn.
  window.__deckHtml[url] = renderDeck(deck, facts)
    .replace('</style>', '#btn-print{display:none}</style>')
    .replace('</body>', `<script>parent.postMessage({ zhangguiDeckReady: ${JSON.stringify(url)} }, '*')</script></body>`);
  deckData[url] = deck;
  return url;
}

// ---------- scripted agent runs ----------
class Stopped extends Error {}

/** Play one agent's canned flow, emitting the same events the real agent loop does. */
async function play(agentId, text, ctx) {
  const say = (event) => ctx.emit({ agent: agentId, depth: ctx.depth, ...event });
  const pause = async (ms) => {
    if (ctx.session.stopped) throw new Stopped('已停止。');
    await sleep(ms);
  };
  let last = '';
  const talk = async (words) => {
    for (let i = 0; i < words.length; i += 3) {
      await pause(16);
      say({ type: 'text', delta: words.slice(i, i + 3) });
    }
    say({ type: 'text_end' });
    last = words;
  };
  const tool = async (name, input, run, tier) => {
    const id = newId('t');
    say({ type: 'tool', id, name, input });
    let content;
    let isError = false;
    if (tier === 'exec' && !ctx.session.allowExec) {
      const decision = await ctx.approve({ agent: agentId, tool: name, tier, input });
      if (!decision.allow) {
        content = `The user declined this action.${decision.reason ? ` Their reason: ${decision.reason}` : ''}`;
        isError = true;
      } else if (decision.always) ctx.session.allowExec = true;
    }
    if (content === undefined) {
      await pause(380);
      try {
        content = String(await run());
      } catch (e) {
        if (e instanceof Stopped) throw e;
        content = `Error: ${e.message}`;
        isError = true;
      }
    }
    say({ type: 'tool_result', id, name, content, isError });
    return { content, isError };
  };
  const member = (id, task) => play(id, task, { ...ctx, depth: ctx.depth + 1 });

  say({ type: 'start', provider: 'mock', model: 'mock' });
  await FLOWS[agentId]({ text, talk, tool, say, member, session: ctx.session });
  say({ type: 'done', usage: { input: 0, output: 0 } });
  return last;
}

const FLOWS = {
  async assistant({ text, talk, tool }) {
    if (/记住|记一下|remember/i.test(text)) {
      const fact = text.replace(/^.*?(记住|记一下)[:：，,\s]*/, '').slice(0, 200) || text;
      await talk('好的，我记下来。');
      await tool('remember', { text: fact }, () => {
        db.memories.push({ id: newId('mem'), text: fact, at: now() });
        return 'Saved';
      });
      await talk('已记住，之后的对话会自动带上这一条。你可以在 **设置 → 记忆** 里查看或删除。');
      return;
    }
    await talk('我把这件事整理成一份备忘，存到工作区。');
    await tool('write_file', { path: 'notes/备忘.md', content: `# 备忘\n\n${text}\n` }, () => 'Wrote notes/备忘.md');
    await talk(`这是演示版，我没有真的去查资料。接入真实模型后，我会按你写的任务“${text.slice(0, 40)}”联网搜索、阅读网页，并给出带来源的回答。\n\n想看其他功能，可以试试左侧的 **Pitch 生成**、**销售获客**、**接力** 或 **四重奏**。`);
  },

  async pitch({ talk, tool, say, session }) {
    session.facts ||= [];
    await talk('先把要用到的事实和来源记下来。');
    for (const [claim, source] of [['月活用户 12,000', 'user'], ['客服成本降低 40%', 'https://example.com/case-study'], ['本轮计划融资 300 万美元', 'user']]) {
      await tool('save_fact', { claim, source }, () => {
        session.facts.push({ claim, source });
        return `Saved. The fact sheet now has ${session.facts.length} facts.`;
      });
    }
    await tool('write_deck', { title: DEMO_DECK.title, slides: `${DEMO_DECK.slides.length} 页` }, () => {
      const { warnings } = reviewDeck(DEMO_DECK, session.facts);
      const url = publishDeck(DEMO_DECK, session.facts);
      say({ type: 'deck', url, title: DEMO_DECK.title });
      return `Deck saved (${DEMO_DECK.slides.length} slides).\n${warnings.length ? `Problems to fix:\n- ${warnings.join('\n- ')}` : 'No problems found.'}`;
    });
    await talk('Pitch 已生成，见预览。其中“95% 续费率”没有来源，那一页已标为 **待确认**：告诉我出处，或者让我删掉这个数字。');
  },

  async sales({ talk, tool }) {
    const p = PROSPECTS[prospectCursor++ % PROSPECTS.length];
    await talk('先看一眼已有的线索，避免重复。');
    await tool('list_leads', {}, () => db.leads.map((l) => `${l.id} | ${l.company} (${l.domain}) | score ${l.score} | ${l.status}`).join('\n') || 'No leads saved yet.');
    let saved = db.leads.find((l) => l.domain === p.domain);
    await tool('save_lead', { company: p.company, domain: p.domain, contact_role: p.role, score: p.score, reasons: [{ text: p.reason, source: `https://${p.domain}/${p.page}` }] }, () => {
      if (db.suppressed.includes(p.domain)) return `${p.domain} is on the do-not-contact list. Not saved; do not contact them.`;
      if (saved) return `Updated existing lead ${saved.id} (${p.company}).`;
      saved = lead({ company: p.company, domain: p.domain, contactRole: p.role, score: p.score, reasons: [{ text: p.reason, source: `https://${p.domain}/${p.page}` }] });
      db.leads.push(saved);
      return `Saved lead ${saved.id} (${p.company}, score ${p.score}).`;
    });
    if (!saved) return talk(`${p.company} 在“不再联系”名单里，我没有保存，也不会为它起草邮件。`);
    await tool('draft_email', { lead_id: saved.id, subject: `关于${p.company}的客服` }, () => {
      if (['sent', 'replied'].includes(saved.status)) return `The first email to ${p.company} has already gone out. Use draft_followup for a follow-up instead.`;
      Object.assign(saved, { status: 'pending', draft: { subject: `关于${p.company}的客服`, body: emailFor(p.company, p.hook), followups: FOLLOWUPS } });
      return `Draft queued for the user's approval (${p.company}). It will not be sent until they approve and send it.`;
    });
    await talk(`找到 **${p.company}**，理由和来源已记录，邮件草稿放进了 **线索与审批**，等你批准。这里不会自动发送邮件。`);
  },

  async coding({ talk, tool }) {
    await talk('先看一下目录里有什么。');
    const ls = await tool('bash', { command: 'ls' }, () => 'README.md\nmath.js\n[exit code 0]', 'exec');
    await talk(ls.isError ? '你没有同意这条命令，所以我没有执行。' : '目录里有 README.md 和 math.js。这是演示版：接入真实模型后，我会真正阅读、修改代码并运行测试，每次改文件和运行命令前都先问你。');
  },

  async relay({ talk, tool, say, member }) {
    await talk('分两棒：销售获客先找一家合适的客户，Pitch 生成再据此做方案。');
    await tool('run_relay', { legs: [{ agent: 'sales', task: '找一家潜在客户并起草邮件' }, { agent: 'pitch', task: '为这家客户做一份 pitch' }] }, async () => {
      say({ type: 'notice', text: `接力 第 1/2 棒 → ${agentName('sales')}` });
      const first = await member('sales', '找一家潜在客户并起草邮件');
      say({ type: 'notice', text: `接力 第 2/2 棒 → ${agentName('pitch')}` });
      const second = await member('pitch', `为这家客户做一份 pitch\n\n上一棒交接：${first}`);
      return `=== Leg 1 (sales) ===\n${first}\n\n=== Leg 2 (pitch) ===\n${second}`;
    });
    await talk('接力完成：销售获客找到一条线索并起草了邮件（等你批准），Pitch 生成据此做出了方案，见预览。');
  },

  async quartet({ talk, tool, say, member }) {
    await talk('这件事可以拆成三部分同时做。');
    const parts = [
      { agent: 'pitch', task: '做一份 pitch' },
      { agent: 'sales', task: '找一家潜在客户' },
      { agent: 'assistant', task: '整理一份竞品备忘' },
    ];
    await tool('run_quartet', { parts }, async () => {
      say({ type: 'notice', text: `四重奏：${parts.map((p) => agentName(p.agent)).join('、')} 同时开工` });
      const outputs = await Promise.all(parts.map((p) => member(p.agent, p.task)));
      return parts.map((p, i) => `=== ${p.agent} ===\n${outputs[i]}`).join('\n\n');
    });
    await talk('四重奏完成：pitch 已生成，线索和邮件草稿在审批队列里，备忘已写入工作区。');
  },
};

// ---------- sessions ----------
const pendingApprovals = new Map();
const running = new Set();
const newSession = (agent, title) => {
  const s = { id: newId('s'), agent, title, transcript: [], facts: [], updatedAt: now(), unread: false };
  db.sessions.push(s);
  return s;
};

function chat({ sessionId, agent, text }) {
  const session = db.sessions.find((s) => s.id === sessionId) || newSession(agent, String(text).trim().slice(0, 40));
  session.stopped = false;
  running.add(session.id);
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const write = (event) => controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      const emit = (event) => {
        applyEvent(session.transcript, event);
        if (event.type === 'deck') session.deckUrl = event.url;
        write(event);
      };
      const approve = (request) =>
        new Promise((resolve) => {
          const id = newId('ap');
          pendingApprovals.set(id, (decision) => {
            pendingApprovals.delete(id);
            emit({ type: 'approval_done', id, allow: Boolean(decision.allow) });
            resolve(decision);
          });
          session.pending = id;
          emit({ type: 'approval', id, ...request });
        });
      write({ type: 'session', id: session.id, title: session.title });
      emit({ type: 'user', text });
      try {
        await play(session.agent, text, { emit, approve, session, depth: 0 });
      } catch (e) {
        emit({ type: 'error', text: e.message || String(e) });
        emit({ type: 'done' });
      }
      running.delete(session.id);
      session.updatedAt = now();
      controller.close();
    },
  });
  return new Response(stream, { status: 200, headers: { 'content-type': 'application/x-ndjson' } });
}

// ---------- scheduled tasks ----------
const scheduleBusy = new Set();

function isDue(task, at = new Date()) {
  if (!task.enabled) return false;
  if (task.days === 'weekdays' && [0, 6].includes(at.getDay())) return false;
  const [h, m] = task.time.split(':').map(Number);
  const slot = new Date(at);
  slot.setHours(h, m, 0, 0);
  if (slot > at) return false;
  return slot.getTime() > Math.max(Date.parse(task.lastRunAt || 0) || 0, Date.parse(task.enabledAt || task.createdAt) || 0);
}

async function runScheduled(task) {
  scheduleBusy.add(task.id);
  const session = newSession(task.agent, `⏰ ${task.name}`);
  session.unread = true;
  running.add(session.id);
  Object.assign(task, { lastRunAt: now(), lastSessionId: session.id, lastStatus: 'running' });
  const emit = (event) => {
    applyEvent(session.transcript, event);
    if (event.type === 'deck') session.deckUrl = event.url;
  };
  // Nobody is watching a scheduled run, so anything that needs approval is declined.
  const approve = async (request) => {
    emit({ type: 'notice', text: `定时任务无人值守，已跳过需要你确认的操作：${request.tool}` });
    return { allow: false, reason: 'this is an unattended scheduled run' };
  };
  emit({ type: 'user', text: task.prompt });
  try {
    await play(task.agent, task.prompt, { emit, approve, session, depth: 0 });
    task.lastStatus = 'ok';
  } catch (e) {
    emit({ type: 'error', text: e.message || String(e) });
    task.lastStatus = 'failed';
  }
  running.delete(session.id);
  session.updatedAt = now();
  scheduleBusy.delete(task.id);
}

setInterval(() => {
  for (const task of db.schedules) if (!scheduleBusy.has(task.id) && isDue(task)) runScheduled(task);
}, 20_000);

// ---------- the requests the interface makes ----------
const PROVIDERS = {
  anthropic: { label: 'Claude (Anthropic)', model: 'claude-opus-5-5', baseURL: '' },
  openai: { label: 'OpenAI', model: '', baseURL: '' },
  xai: { label: 'Grok (xAI)', model: '', baseURL: 'https://api.x.ai/v1' },
  moonshot: { label: 'Kimi (Moonshot)', model: '', baseURL: 'https://api.moonshot.ai/v1' },
};

function state() {
  const providers = {};
  for (const [id, p] of Object.entries(PROVIDERS)) providers[id] = { ...p, hasKey: false, keyHint: '', fromEnv: false, ready: false };
  return {
    agents: AGENTS,
    config: { providers, agents: db.assign, hasBraveKey: false, codingWorkspace: db.codingWorkspace },
    resolved: Object.fromEntries(AGENTS.map((a) => [a.id, 'mock'])),
    sessions: db.sessions
      .map(({ id, agent, title, updatedAt, unread }) => ({ id, agent, title, updatedAt, unread }))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    salesTodo: salesTodo(),
    mock: true,
  };
}

const NO_KEYS = '演示版不保存 key，也不连接任何模型。要用真实模型，需要在自己的电脑上运行掌柜。';

function handle(method, path, query, body) {
  const [, resource, id] = path.split('/'); // "api/leads/lead_x" -> ["api", "leads", "lead_x"]
  if (resource === 'state') return state();
  if (resource === 'config') {
    if (body.braveKey || Object.values(body.providers || {}).some((p) => p.apiKey)) return [400, { error: NO_KEYS }];
    if (typeof body.codingWorkspace === 'string') db.codingWorkspace = body.codingWorkspace.trim() || db.codingWorkspace;
    for (const [agent, provider] of Object.entries(body.agents || {})) if (agent in db.assign && PROVIDERS[provider]) db.assign[agent] = provider;
    return state();
  }
  if (resource === 'models') return [400, { error: NO_KEYS }];
  if (resource === 'chat') return chat(body);
  if (resource === 'approve') {
    const resolve = pendingApprovals.get(body.id);
    if (!resolve) return [404, { error: '这个确认已经失效' }];
    resolve({ allow: Boolean(body.allow), always: Boolean(body.always) });
    return { ok: true };
  }
  if (resource === 'stop') {
    const session = db.sessions.find((s) => s.id === body.sessionId);
    if (session) {
      session.stopped = true;
      pendingApprovals.get(session.pending)?.({ allow: false });
    }
    return { ok: true };
  }
  if (resource === 'sessions') {
    const session = db.sessions.find((s) => s.id === id);
    if (method === 'DELETE') {
      db.sessions = db.sessions.filter((s) => s.id !== id);
      return { ok: true };
    }
    if (!session) return [404, { error: 'Not found' }];
    if (!running.has(session.id)) session.unread = false;
    return { id: session.id, agent: session.agent, title: session.title, transcript: session.transcript, deckUrl: session.deckUrl || null, running: running.has(session.id) };
  }
  if (resource === 'leads') {
    if (!id) return { leads: db.leads.map((l) => ({ ...l, followupDueAt: followupDueAt(l), followupDue: followupDue(l) })), suppressed: db.suppressed };
    const found = db.leads.find((l) => l.id === id);
    return found ? { lead: leadAction(found, body) } : [404, { error: 'Not found' }];
  }
  if (resource === 'memory') {
    if (method === 'DELETE') db.memories = db.memories.filter((m) => m.id !== id);
    return { memories: db.memories };
  }
  if (resource === 'schedules') {
    if (!id && method === 'GET') return { schedules: db.schedules.map((s) => ({ ...s, running: scheduleBusy.has(s.id) })) };
    if (!id) {
      if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(String(body.time))) return [400, { error: '时间格式应为 HH:MM' }];
      if (!String(body.prompt || '').trim()) return [400, { error: '任务内容不能为空' }];
      const task = { id: newId('sch'), name: String(body.name || '').trim() || String(body.prompt).trim().slice(0, 30), agent: body.agent, prompt: String(body.prompt).trim(), time: body.time, days: body.days === 'weekdays' ? 'weekdays' : 'daily', enabled: true, createdAt: now(), lastRunAt: null, lastSessionId: null, lastStatus: null };
      db.schedules.push(task);
      return { schedule: task };
    }
    const task = db.schedules.find((s) => s.id === id);
    if (!task) return [404, { error: 'Not found' }];
    if (body.action === 'delete') db.schedules = db.schedules.filter((s) => s.id !== id);
    if (body.action === 'toggle') Object.assign(task, { enabled: !task.enabled, enabledAt: now() });
    if (body.action === 'run') {
      if (scheduleBusy.has(task.id)) return [409, { error: '这个任务正在运行' }];
      runScheduled(task);
    }
    return { ok: true };
  }
  return [404, { error: 'Not found' }];
}

const realFetch = window.fetch.bind(window);
window.fetch = async (input, init = {}) => {
  const url = String(typeof input === 'string' ? input : input.url);
  const [path, search = ''] = url.replace(/^\.?\//, '').split('?');
  if (!path.startsWith('api/')) return realFetch(input, init);
  await sleep(40);
  let result;
  try {
    result = handle((init.method || 'GET').toUpperCase(), path, new URLSearchParams(search), init.body ? JSON.parse(init.body) : {});
  } catch (e) {
    result = [500, { error: e.message }];
  }
  if (result instanceof Response) return result;
  const [status, data] = Array.isArray(result) ? result : [200, result];
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
};

// ---------- what is different about the demo page ----------
const banner = document.createElement('div');
banner.id = 'demo-banner';
banner.textContent = '演示版：回复和数据都是预先写好的示例，不会联网，也不会调用模型。刷新页面即重置。';
document.getElementById('topbar').insertAdjacentElement('afterend', banner);
