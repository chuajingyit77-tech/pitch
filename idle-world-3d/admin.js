// 栖境 · 学习管理 — the admin page of the learning backend (backend/*.sql, lessons/backend.js).
//
// An admin signs in (login + password; the first account is made with an invite code) and looks after:
//   课程      the lessons: drafts (written here, by an AI from pasted text, or by the drafting job from Google Drive),
//             checked and published; edited (a published lesson's version goes up); archived; how each one goes
//   员工      the staff who sign in on the screens (name + 4-digit PIN), their learning records, locks
//   设备      the shared screens (each with its own setup code) and team codes for the staff's own phones
//   资料来源  the documents the drafting job has turned into drafts
//   守护者    what the guardians say besides the lessons
//   账号      the admin's password, invites for other admins
// Everything goes through the backend's admin_* functions with the admin's session token; nothing is kept here but
// that token.
import { BACKEND } from './lessons/backend.js';

const TEST = window.__ADMIN_TEST__ || null;
const API = (TEST && TEST.backend) || BACKEND;
const KEY = 'qijing-admin-v1';
const PLAY = new URL('./play.html', location.href).href;
// the residents a lesson can give, by the world its guardian lives in (scenes/<world>.js kinds)
const KINDS = {
  koi: [['kohaku', '红白锦鲤'], ['tancho', '丹顶锦鲤'], ['sanke', '大正三色锦鲤'], ['showa', '昭和三色锦鲤'], ['ogon', '黄金锦鲤'],
    ['platinum', '白金锦鲤'], ['asagi', '浅黄锦鲤'], ['chagoi', '茶鲤'], ['kigoi', '黄鲤'], ['benigoi', '红鲤'], ['hirenaga', '蝶尾锦鲤']],
};
// what a guardian says besides the lessons (lines in qj.guardians)
const LINES = [
  ['start', '开始一课时', '你来了。那我们开始吧。'],
  ['resume', '接着上次学时', '我们接着上次说。'],
  ['allDone', '所有课都学完时', '该教的，我都教给你了。想重温哪一课？'],
  ['later', '「下次再说」按钮', '下次再说'],
  ['bye', '选了「下次再说」', '好。我常在这池边，想学的时候再来。'],
  ['coming', '它正飞过来时（旁白）', '远处传来翅膀扇动的声音……'],
  ['returning', '它刚飞走又被叫回时（旁白）', '它兜一圈，就飞回来。'],
  ['gift', '送新居民时（{what} 种类，{name} 名字）', '池里多了一位新朋友：{what}「{name}」。算是我送你的。'],
  ['review', '错题回顾开始时', '我们把上次没答对的题，再过一遍。'],
  ['reviewDone', '错题回顾结束时', '都答对了。记住了，这些就是你的了。'],
];
const DRAFT_PROMPT = `你要为「栖境」写一节员工培训课。课由锦鲤池的守护者「老苍鹭」用对话来讲：它沉稳、亲切，爱用池塘和水打比方，像一位老前辈在池边讲给新人听。

请把下面的公司资料改写成一节 3–5 分钟的课，只输出一个 JSON 对象（不要任何别的文字，也不要 \`\`\` 代码块标记），格式如下：
{
  "title": "课名（不超过 16 个字）",
  "keys": "3 到 5 个关键字，用 · 隔开，例如：听 · 认 · 办 · 跟",
  "about": "一句话简介（不超过 40 个字）",
  "minutes": 3,
  "badge": "学完得到的徽章名（四个字）",
  "steps": [
    { "say": "守护者说的一句话（不超过 70 个字）。重点词用 **两个星号** 包起来" },
    { "ask": "一个工作中的情景，问员工该怎么做", "options": [
      { "text": "选项", "reply": "选了这个，守护者解释为什么不妥" },
      { "text": "正确的做法", "ok": true, "reply": "答对时守护者说的话" },
      { "text": "选项", "reply": "……" }
    ] },
    { "card": { "title": "要点 · 主题", "items": [["关键字", "一句话说明"]] } }
  ],
  "outro": "最后一句临别的话"
}

要求：
1. 先用 4–8 句 say 讲清楚要做什么、按什么顺序、为什么；中间穿插 2–3 道 ask 情景选择题（每题 3 个选项，只有一个 "ok": true，每个选项都写 reply）；最后一张 card 要点卡（3–5 条）。
2. 只用资料里有的内容，不要编造资料里没有的规定、数字、时限或联系方式；资料里没写清楚的就不写。
3. 每句话简短，口语化，适合在屏幕上一句一句地读。

公司资料：
<<<
{TEXT}
>>>`;

const $ = id => document.getElementById(id);
const S = { token: null, admin: null, data: null, view: null, hash: '', editor: null, overview: null };

/* ------------------------------------------------------------------ */
/* Small helpers                                                       */
/* ------------------------------------------------------------------ */
/** An element: h('div', { class, text, onclick, ... }, ...children). Text is always text, never markup. */
function h(tag, props, ...kids) {
  const e = document.createElement(tag);
  if (props) for (const k of Object.keys(props)) {
    const v = props[k];
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k === 'text') e.textContent = v;
    else if (k === 'icon') e.innerHTML = ICONS[v];
    else if (k.slice(0, 2) === 'on') e.addEventListener(k.slice(2), v);
    else if (k === 'value' || k === 'checked' || k === 'disabled' || k === 'selected') e[k] = v;
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat(Infinity)) if (c != null && c !== false) e.appendChild(typeof c === 'object' ? c : document.createTextNode(String(c)));
  return e;
}
const ICONS = {
  up: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5M6 11l6-6 6 6"/></svg>',
  down: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M6 13l6 6 6-6"/></svg>',
  x: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
  copy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/></svg>',
};
function toast(text, bad) {
  const t = h('div', { class: bad ? 'toast err' : 'toast', text });
  $('toasts').appendChild(t);
  setTimeout(() => t.remove(), 3500);
}
const plain = t => String(t || '').replace(/\*\*/g, '');
/** text with **gold** marks, as the guardian shows it */
function rich(t) {
  const f = document.createDocumentFragment();
  String(t || '').split('**').forEach((part, i) => f.appendChild(i % 2 ? h('b', { text: part }) : document.createTextNode(part)));
  return f;
}
function when(iso) {
  if (!iso) return '—';
  const d = new Date(iso), now = new Date(), mins = Math.round((now - d) / 60000);
  const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  if (mins < 1) return '刚刚';
  if (mins < 60) return `${mins} 分钟前`;
  const day = new Date(now.getFullYear(), now.getMonth(), now.getDate()), dd = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const days = Math.round((day - dd) / 864e5);
  if (days === 0) return `今天 ${hm}`;
  if (days === 1) return `昨天 ${hm}`;
  if (days < 7) return `${days} 天前`;
  return `${d.getFullYear() === now.getFullYear() ? '' : d.getFullYear() + '年'}${d.getMonth() + 1}月${d.getDate()}日`;
}
function dur(sec) {
  const m = Math.round((sec || 0) / 60);
  if (!sec) return '—';
  if (m < 1) return '不到 1 分钟';
  return m < 60 ? `${m} 分钟` : `${Math.floor(m / 60)} 小时 ${m % 60} 分`;
}
const pct = (a, b) => (b ? `${Math.round(100 * a / b)}%` : '—');
const stars = n => h('span', { class: 'stars' }, '★'.repeat(Math.max(0, Math.min(3, n))), h('i', { text: '★'.repeat(3 - Math.max(0, Math.min(3, n))) }));
function copy(text, what) {
  const done = () => toast(`已复制${what || ''}`);
  if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, () => fallback());
  else fallback();
  function fallback() {
    const t = h('textarea', { style: 'position:fixed;opacity:0' });
    t.value = text; document.body.appendChild(t); t.select();
    try { document.execCommand('copy'); done(); } catch (e) { toast('复制不了，请手动选中复制', true); }
    t.remove();
  }
}
const randomPin = () => { const a = new Uint32Array(1); crypto.getRandomValues(a); return String(a[0] % 10000).padStart(4, '0'); };
const quizCount = L => (L.steps || []).filter(s => s.ask !== undefined).length;

/* ------------------------------------------------------------------ */
/* The backend                                                         */
/* ------------------------------------------------------------------ */
async function rpc(fn, body) {
  const r = await fetch(`${API.url}/rest/v1/rpc/${fn}`, {
    method: 'POST', cache: 'no-store', headers: { apikey: API.key, 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`${fn}: HTTP ${r.status}`);
  return r.json();
}
/** A call as the admin signed in: a session that has ended signs out; a network failure says so. */
async function call(fn, body) {
  let r;
  try { r = await rpc(fn, Object.assign({ token: S.token }, body || {})); } catch (e) { toast('连不上后台，请检查网络后再试', true); throw e; }
  if (r && r.ok === false && r.error === 'auth') { signOut('登录已过期，请重新登录'); throw new Error('auth'); }
  return r;
}
async function reload() {
  const r = await call('admin_state');
  S.data = r;
  S.admin = r.admin;
  $('whoAmI').textContent = r.admin ? r.admin.name : '';
  const drafts = r.lessons.filter(l => l.status === 'draft').length;
  $('nDrafts').hidden = !drafts;
  $('nDrafts').textContent = drafts;
  return r;
}
const lessonById = id => S.data.lessons.find(l => l.id === id) || null;
const personById = id => S.data.employees.find(e => e.id === id) || null;
const guardianById = id => S.data.guardians.find(g => g.id === id) || null;

/* ------------------------------------------------------------------ */
/* Signing in                                                          */
/* ------------------------------------------------------------------ */
function showLogin(msg) {
  $('app').hidden = true;
  $('login').hidden = false;
  $('lgMsg').textContent = msg || '';
  $('lgMsg').className = msg ? 'msg err' : 'msg';
}
function signOut(msg) {
  const tok = S.token;
  S.token = null; S.data = null; S.editor = null;
  try { localStorage.removeItem(KEY); } catch (e) {}
  if (tok && !msg) rpc('admin_logout', { token: tok }).catch(() => {});
  showLogin(msg);
}
function signedIn(r) {
  S.token = r.session;
  try { localStorage.setItem(KEY, JSON.stringify({ token: r.session, at: Date.now() })); } catch (e) {}
  start();
}
function loginTabs(claim) {
  $('tabLogin').setAttribute('aria-pressed', String(!claim));
  $('tabClaim').setAttribute('aria-pressed', String(claim));
  $('formLogin').hidden = claim;
  $('formClaim').hidden = !claim;
}
$('tabLogin').addEventListener('click', () => loginTabs(false));
$('tabClaim').addEventListener('click', () => loginTabs(true));
$('formLogin').addEventListener('submit', async e => {
  e.preventDefault();
  const msg = $('lgMsg');
  msg.className = 'msg'; msg.textContent = '正在登录…';
  let r;
  try { r = await rpc('admin_login', { login_name: $('lgName').value, password: $('lgPass').value }); } catch (x) { msg.className = 'msg err'; msg.textContent = '连不上后台，请检查网络后再试'; return; }
  if (r.ok) { $('lgPass').value = ''; msg.textContent = ''; signedIn(r); return; }
  msg.className = 'msg err';
  msg.textContent = r.error === 'locked' ? `密码输错太多次，请 ${Math.ceil((r.wait || 900) / 60)} 分钟后再试`
    : r.error === 'busy' ? '尝试次数太多，请 10 分钟后再试' : '登录名或密码不对';
});
$('formClaim').addEventListener('submit', async e => {
  e.preventDefault();
  const msg = $('clMsg');
  if ($('clPass').value !== $('clPass2').value) { msg.className = 'msg err'; msg.textContent = '两次输入的密码不一样'; return; }
  msg.className = 'msg'; msg.textContent = '正在创建…';
  let r;
  try {
    r = await rpc('admin_claim', { invite_code: $('clCode').value, login_name: $('clLogin').value, password: $('clPass').value, display_name: $('clName').value });
  } catch (x) { msg.className = 'msg err'; msg.textContent = '连不上后台，请检查网络后再试'; return; }
  if (r.ok) { msg.textContent = ''; toast(`欢迎，${r.admin.name}`); signedIn(r); return; }
  msg.className = 'msg err';
  msg.textContent = { code: '邀请码不对，或者已经用过、过期了', login: '登录名要 3–32 个字符：小写字母、数字、点、横线或下划线，以字母或数字开头', password: '密码至少 8 位', taken: '这个登录名已经有人用了', busy: '尝试次数太多，请 10 分钟后再试' }[r.error] || '创建失败，请稍后再试';
});
$('btnLogout').addEventListener('click', () => { if (leaveOk()) signOut(); });

/* ------------------------------------------------------------------ */
/* Dialogs                                                             */
/* ------------------------------------------------------------------ */
let dialogClose = null;
function dialog(title, lead, body, actions, wide) {
  const d = $('dialog');
  d.className = wide ? 'dialog wide' : 'dialog';
  d.textContent = '';
  d.appendChild(h('h2', { text: title }));
  if (lead) d.appendChild(typeof lead === 'string' ? h('p', { class: 'lead', text: lead }) : lead);
  if (body) d.appendChild(body);
  const foot = h('div', { class: 'foot' });
  for (const a of actions || [{ text: '关闭' }]) {
    foot.appendChild(h('button', { class: a.primary ? 'btn primary' : a.danger ? 'btn danger' : 'btn', type: 'button', text: a.text, onclick: async ev => {
      if (a.run) { ev.target.disabled = true; const keep = await a.run(); ev.target.disabled = false; if (keep === false) return; }
      closeDialog();
    } }));
  }
  d.appendChild(foot);
  $('modal').hidden = false;
  dialogClose = null;
  const first = d.querySelector('input,textarea,select');
  if (first) setTimeout(() => first.focus(), 30);
}
function closeDialog() { $('modal').hidden = true; $('dialog').textContent = ''; if (dialogClose) dialogClose(); dialogClose = null; }
$('modal').addEventListener('click', e => { if (e.target === $('modal')) closeDialog(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('modal').hidden) closeDialog(); });
function confirmBox(title, text, yes, run, danger) {
  dialog(title, text, null, [{ text: '取消' }, { text: yes, primary: !danger, danger, run }]);
}

/* ------------------------------------------------------------------ */
/* Pages                                                               */
/* ------------------------------------------------------------------ */
const view = () => $('view');
function page(title, lead, actions) {
  const v = view();
  v.textContent = '';
  const head = h('div', { class: 'head' }, h('div', null, h('h1', { text: title }), lead ? h('p', { text: lead }) : null));
  if (actions && actions.length) head.appendChild(h('div', { class: 'acts' }, actions));
  v.appendChild(head);
  return v;
}
function leaveOk() {
  return !(S.editor && S.editor.dirty) || confirm('这节课还有没保存的修改，确定离开吗？');
}
window.addEventListener('beforeunload', e => { if (S.editor && S.editor.dirty) { e.preventDefault(); e.returnValue = ''; } });
window.addEventListener('hashchange', () => {
  if (location.hash === S.hash) return;
  if (!leaveOk()) { history.replaceState(null, '', S.hash || '#/'); return; }
  route();
});
async function route() {
  if (!S.token) return;
  S.hash = location.hash || '#/';
  const [name, id] = S.hash.replace(/^#\/?/, '').split('/');
  const v = name || 'overview';
  S.view = v;
  S.editor = null;
  for (const a of document.querySelectorAll('#tabs a')) {
    const on = a.dataset.v === v || (v === 'lesson' || v === 'report' ? a.dataset.v === 'lessons' : v === 'person' ? a.dataset.v === 'people' : false);
    if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  }
  window.scrollTo(0, 0);
  const pages = { overview: pageOverview, lessons: pageLessons, lesson: pageLesson, report: pageReport, people: pagePeople, person: pagePerson,
    devices: pageDevices, sources: pageSources, guardians: pageGuardians, account: pageAccount };
  try { await (pages[v] || pageOverview)(id ? decodeURIComponent(id) : null); } catch (e) { if (e.message !== 'auth') { console.error(e); } }
}
const go = hash => { if (location.hash === hash) route(); else location.hash = hash; };

/* ---------- 概览 ---------- */
async function pageOverview() {
  const d = S.data;
  let ov = null;
  try { ov = await call('admin_overview'); } catch (e) {}
  if (S.view !== 'overview') return;
  const staff = d.employees.filter(e => e.active);
  const pub = d.lessons.filter(l => l.status === 'published');
  const drafts = d.lessons.filter(l => l.status === 'draft');
  const own = pub.filter(l => !l.demo);
  const v = page('概览', `${S.admin.name}，你好。这里是员工学习的全貌：谁在学、学得怎样、哪些课在等你审核。`);
  if (drafts.length) {
    v.appendChild(h('div', { class: 'notice' }, h('div', null, h('b', { text: `有 ${drafts.length} 节课草稿等你审核。` }), ' 看过、改好后发布，员工的屏幕上就会出现。 ', h('a', { href: '#/lessons', text: '去看看' }))));
  }
  const locked = d.employees.filter(e => e.locked);
  if (locked.length) {
    v.appendChild(h('div', { class: 'notice bad' }, h('div', null, h('b', { text: `${locked.map(e => e.name).join('、')} 因为密码输错太多次，暂时登录不了。` }), ' 15 分钟后会自动解开，也可以现在解锁： ',
      locked.map(e => h('button', { class: 'btn small', type: 'button', text: `解锁 ${e.name}`, onclick: async () => { await call('admin_unlock', { employee: e.id }); toast(`${e.name} 已解锁`); await reload(); route(); } })))));
  }
  // getting started
  const todo = [
    { done: staff.length > 0, t: '添加员工', s: '名字、部门和 4 位密码。可以一次粘贴一整个名单。', href: '#/people' },
    { done: d.devices.some(x => x.registered && x.active), t: '连接屏幕', s: '给前台的 iPad 一个登记码；员工自己的手机用团队码。', href: '#/devices' },
    { done: own.length > 0, t: '发布第一节公司的课', s: '把 SOP 贴给 AI 起草，或自己写。审核后发布。', href: '#/lessons' },
    { done: own.length > 0 && !pub.some(l => l.demo), t: '收起示范课', s: '有了公司自己的课，就把两节示范课归档。', href: '#/lessons' },
  ];
  if (todo.some(x => !x.done)) {
    const sec = h('div', { class: 'section' }, h('h2', { text: '开始使用' }));
    sec.appendChild(h('div', { class: 'steps-todo' }, todo.map((x, i) => h('a', { class: x.done ? 'card todo done' : 'card todo', href: x.href },
      h('span', { class: 'n', text: x.done ? '✓' : String(i + 1) }), h('b', { text: x.t }), h('span', { text: x.s })))));
    v.appendChild(sec);
  }
  // the figures
  const tiles = h('div', { class: 'tiles' });
  const tile = (n, t) => tiles.appendChild(h('div', { class: 'card tile' }, h('b', { text: String(n) }), h('span', { text: t })));
  tile(staff.length, '在职员工');
  tile(pub.length, '已发布的课');
  tile(ov ? ov.done7 : '—', '近 7 天学完的课次');
  tile(ov ? ov.learners7 : '—', '近 7 天在学的人');
  tile(ov ? pct(ov.right, ov.answered) : '—', '第一次就答对');
  v.appendChild(h('div', { class: 'section' }, tiles));
  // the latest, and who has learned most
  const recent = h('div', { class: 'card' });
  if (!d.recent.length) recent.appendChild(h('div', { class: 'empty', text: '还没有人学完一课。员工在屏幕上学完后，会出现在这里。' }));
  else recent.appendChild(h('div', { class: 'table-wrap' }, h('table', null, h('thead', null, h('tr', null, h('th', { text: '员工' }), h('th', { text: '课' }), h('th', { text: '星' }), h('th', { class: 'num', text: '时间' }))),
    h('tbody', null, d.recent.slice(0, 12).map(r => h('tr', null, h('td', null, h('span', { class: 'name', text: r.employee }), r.dept ? h('span', { class: 'sub', text: r.dept }) : null), h('td', { text: r.lesson }), h('td', null, stars(r.stars)), h('td', { class: 'num muted', text: when(r.at) })))))));
  const top = staff.slice().sort((a, b) => b.finished - a.finished || b.stars - a.stars || (Date.parse(b.lastActive || 0) - Date.parse(a.lastActive || 0))).slice(0, 8);
  const rank = h('div', { class: 'card' });
  if (!top.length || !top[0].finished) rank.appendChild(h('div', { class: 'empty', text: '学完课的员工会按学完的课数排在这里。' }));
  else rank.appendChild(h('div', { class: 'table-wrap' }, h('table', null, h('thead', null, h('tr', null, h('th', { text: '员工' }), h('th', { class: 'num', text: '学完' }), h('th', { class: 'num', text: '星' }), h('th', { class: 'num', text: '首答正确' }))),
    h('tbody', null, top.filter(e => e.finished).map(e => h('tr', null, h('td', null, h('a', { href: `#/person/${e.id}`, class: 'name', text: e.name }), e.dept ? h('span', { class: 'sub', text: e.dept }) : null), h('td', { class: 'num', text: `${e.finished} / ${pub.length}` }), h('td', { class: 'num', text: e.stars }), h('td', { class: 'num', text: pct(e.right, e.answered) })))))));
  v.appendChild(h('div', { class: 'cols section' }, h('div', null, h('h2', { text: '最近学完' }), recent), h('div', null, h('h2', { text: '学得最多' }), rank)));
}

/* ---------- 课程 ---------- */
function pageLessons() {
  const d = S.data;
  const v = page('课程', '守护者用对话教的课。草稿只有你看得到；发布后，员工的屏幕会在 10 分钟内收到。改动已发布的课（步骤或课名），版本会加一，正在学的人会从头开始。', [
    h('button', { class: 'btn', type: 'button', text: '用 AI 起草', onclick: aiDraft }),
    h('button', { class: 'btn primary', type: 'button', text: '新建课程', onclick: () => go('#/lesson/new') }),
  ]);
  const groups = [['draft', '草稿 · 等你审核'], ['published', '已发布'], ['archived', '已归档']];
  const box = h('div', { class: 'lessons' });
  for (const [st, title] of groups) {
    const ls = d.lessons.filter(l => l.status === st);
    if (!ls.length && st !== 'published') continue;
    box.appendChild(h('div', { class: 'group-h', text: `${title}（${ls.length}）` }));
    if (!ls.length) box.appendChild(h('div', { class: 'card empty', text: '还没有发布的课。' }));
    for (const L of ls) box.appendChild(lessonCard(L));
  }
  v.appendChild(box);
}
function lessonCard(L) {
  const g = guardianById(L.guardian);
  const tags = [];
  if (L.demo) tags.push(h('span', { class: 'tag', text: '示范' }));
  if (L.version > 1) tags.push(h('span', { class: 'tag blue', text: `第 ${L.version} 版` }));
  if (L.source && L.source.name) tags.push(h('span', { class: 'tag gold', text: '来自资料' }));
  const meta = [`${(L.steps || []).length} 步`, `${quizCount(L)} 道题`, `约 ${L.minutes} 分钟`];
  if (L.badge) meta.push(`徽章「${L.badge}」`);
  if (g) meta.push(`由${g.name}讲`);
  const side = h('div', { class: 'side' });
  const acts = h('div', { class: 'row' });
  acts.appendChild(h('button', { class: 'btn small', type: 'button', text: L.status === 'published' ? '修改' : '编辑', onclick: () => go(`#/lesson/${L.id}`) }));
  if (L.status === 'draft') acts.appendChild(h('button', { class: 'btn small primary', type: 'button', text: '发布', disabled: L.problems.length > 0, title: L.problems.length ? '还有问题要处理' : '', onclick: () => setStatus(L, 'published') }));
  if (L.status === 'published') {
    acts.appendChild(h('button', { class: 'btn small', type: 'button', text: '学习情况', onclick: () => go(`#/report/${L.id}`) }));
    acts.appendChild(h('button', { class: 'btn small', type: 'button', text: '归档', onclick: () => confirmBox('归档这节课？', `「${L.title}」会从员工的屏幕上收起来，学习记录都保留。之后可以再发布。`, '归档', () => setStatus(L, 'archived')) }));
  }
  if (L.status === 'archived') acts.appendChild(h('button', { class: 'btn small', type: 'button', text: '重新发布', disabled: L.problems.length > 0, onclick: () => setStatus(L, 'published') }));
  if (L.status !== 'published') acts.appendChild(h('button', { class: 'btn small danger', type: 'button', text: '删除', onclick: () => confirmBox('删除这节课？', `「${L.title || '没有课名的草稿'}」会被删除，删除后找不回来。${L.started ? '学过这节课的记录也会一起删除。' : ''}`, '删除', () => setStatus(L, 'delete'), true) }));
  side.appendChild(acts);
  if (L.status === 'published') side.appendChild(h('div', { class: 'm', text: L.started ? `${L.started} 人学过 · ${L.finished} 人学完${L.avgStars ? ` · 平均 ★ ${L.avgStars}` : ''}${L.avgSeconds ? ` · 平均 ${dur(L.avgSeconds)}` : ''}` : '还没有人学' }));
  else side.appendChild(h('div', { class: 'm', text: `改于 ${when(L.updatedAt)}` }));
  return h('div', { class: 'card lesson' },
    h('div', null,
      h('div', { class: 't' }, L.title || h('span', { class: 'muted', text: '（还没有课名）' }), tags),
      L.keys ? h('div', { class: 'k', text: L.keys }) : null,
      L.about ? h('div', { class: 'a', text: L.about }) : null,
      h('div', { class: 'm', text: meta.join(' · ') })),
    side,
    L.status !== 'published' && L.problems.length ? h('div', { class: 'probs', text: `发布前还要处理：${L.problems.join('；')}` }) : null);
}
async function setStatus(L, status) {
  const r = await call('admin_lesson_status', { lesson: L.id, status });
  if (!r.ok) {
    toast(r.error === 'problems' ? `还不能发布：${r.problems.join('；')}` : r.error === 'published' ? '已发布的课不能删除，请先归档' : '没能完成，请刷新后再试', true);
    return false;
  }
  toast({ published: `已发布「${L.title}」，员工的屏幕会在 10 分钟内收到`, archived: `已归档「${L.title}」`, draft: '已撤回为草稿', delete: '已删除' }[status]);
  await reload();
  if (S.view === 'lessons') route(); else go('#/lessons');
  return true;
}

/* ---------- 用 AI 起草 ---------- */
function aiDraft() {
  const text = h('textarea', { class: 'textarea', rows: 8, placeholder: '把 SOP、案例或制度的原文粘贴在这里（一份资料起草一节课）' });
  const reply = h('textarea', { class: 'textarea', rows: 6, placeholder: 'AI 回复的整段内容（以 { 开头、} 结尾）粘贴在这里' });
  const msg = h('div', { class: 'msg' });
  const body = h('div', { class: 'form' },
    h('div', { class: 'field' }, h('label', { text: '① 公司资料原文' }), text),
    h('div', { class: 'field' }, h('label', { text: '② 复制给 AI 的指令' }),
      h('div', { class: 'row' }, h('button', { class: 'btn', type: 'button', icon: 'copy', onclick: () => {
        if (!text.value.trim()) { msg.className = 'msg err'; msg.textContent = '先把资料原文粘贴到 ①'; return; }
        copy(DRAFT_PROMPT.replace('{TEXT}', text.value.trim()), '指令');
        msg.className = 'msg ok'; msg.textContent = '已复制。打开 Claude（claude.ai）或其他 AI 对话，粘贴、发送，然后把它的回复整段复制回来。';
      } }, ' 复制指令')),
      h('div', { class: 'hint', text: '指令里已经包含资料原文和课程格式，AI 会只回复一节课的内容。' })),
    h('div', { class: 'field' }, h('label', { text: '③ 粘贴 AI 的回复' }), reply),
    msg);
  dialog('用 AI 起草一节课', '资料不会存进这个页面：AI 起草的课先成为草稿，你看过、改好再发布。以后也可以让 Claude 每天自动从 Google Drive 的资料文件夹起草（资料来源页有说明）。', body, [
    { text: '取消' },
    { text: '导入为草稿', primary: true, run: async () => {
      let L;
      try { L = parseDraft(reply.value); } catch (e) { msg.className = 'msg err'; msg.textContent = e.message; return false; }
      const r = await call('admin_save_lesson', { lesson: L });
      if (!r.ok) { msg.className = 'msg err'; msg.textContent = '没能保存，请稍后再试'; return false; }
      await reload();
      toast('草稿已保存，请审核');
      go(`#/lesson/${r.id}`);
      return true;
    } },
  ], true);
}
/** The AI's reply as a lesson for admin_save_lesson (with what it got wrong explained in Chinese). */
function parseDraft(t) {
  let s = String(t || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  const a = s.indexOf('{'), b = s.lastIndexOf('}');
  if (a < 0 || b < a) throw new Error('没有找到课的内容：请把 AI 的回复整段粘贴进来（以 { 开头、} 结尾）');
  let o;
  try { o = JSON.parse(s.slice(a, b + 1)); } catch (e) { throw new Error('回复的格式不完整，可能复制漏了一部分。请重新整段复制'); }
  if (!o || typeof o !== 'object' || !Array.isArray(o.steps)) throw new Error('回复里没有课的步骤（steps）');
  const steps = o.steps.map(st => {
    if (st && typeof st.say === 'string') return { say: st.say };
    if (st && typeof st.ask === 'string') return { ask: st.ask, options: (st.options || []).map(x => cleanOpt(x)) };
    if (st && st.card && typeof st.card === 'object') return { card: { title: String(st.card.title || '要点'), items: (st.card.items || []).map(it => Array.isArray(it) ? [String(it[0] || ''), String(it[1] || '')] : [String(it.key || it.k || ''), String(it.text || it.t || '')]) } };
    return null;
  }).filter(Boolean);
  return {
    guardian: 'heron', title: String(o.title || '').slice(0, 80), keys: String(o.keys || '').slice(0, 80), about: String(o.about || '').slice(0, 400),
    minutes: Math.max(1, Math.min(60, parseInt(o.minutes, 10) || 3)), badge: o.badge ? String(o.badge).slice(0, 40) : null, steps,
    outro: String(o.outro || '').slice(0, 400), tags: [], sort: 100,
  };
}
const cleanOpt = x => { const o = { text: String((x && x.text) || '') }; if (x && x.ok === true) o.ok = true; if (x && x.reply) o.reply = String(x.reply); return o; };

/* ---------- 编辑一节课 ---------- */
function problemsOf(L) {
  const p = [], warn = [];
  if (!String(L.title || '').trim()) p.push('缺少课名');
  if (!L.steps.length) { p.push('还没有内容'); return { p, warn }; }
  L.steps.forEach((s, i) => {
    const n = i + 1;
    if (s.say !== undefined) { if (!String(s.say).trim()) p.push(`第 ${n} 步：这句话是空的`); else if (plain(s.say).length > 120) warn.push(`第 ${n} 步：这句话有点长，屏幕上读起来吃力（建议分成两句）`); }
    else if (s.ask !== undefined) {
      if (!String(s.ask).trim()) p.push(`第 ${n} 步：题目是空的`);
      const o = s.options || [];
      if (o.length < 2 || o.length > 4) p.push(`第 ${n} 步：要有 2 到 4 个选项`);
      else {
        if (o.some(x => !String(x.text || '').trim())) p.push(`第 ${n} 步：有空的选项`);
        if (o.filter(x => x.ok).length !== 1) p.push(`第 ${n} 步：正确答案要正好一个`);
        o.forEach((x, j) => { if (String(x.text || '').trim() && !String(x.reply || '').trim()) warn.push(`第 ${n} 步：选项 ${'ABCD'[j]} 没有写守护者的解释`); });
      }
    } else if (s.card) { if (!(s.card.items || []).some(it => String(it[0] || '').trim() || String(it[1] || '').trim())) p.push(`第 ${n} 步：要点卡没有内容`); }
  });
  if (!L.steps.some(s => s.ask !== undefined)) warn.push('这节课没有选择题：员工得不到星星，也没有错题可以回顾');
  return { p, warn };
}
function pageLesson(id) {
  const src = id === 'new' ? null : lessonById(id);
  if (id !== 'new' && !src) { page('找不到这节课', '它可能已经被删除了。', [h('a', { class: 'btn', href: '#/lessons', text: '返回课程' })]); return; }
  const L = src ? JSON.parse(JSON.stringify({ id: src.id, guardian: src.guardian, title: src.title, keys: src.keys, about: src.about, minutes: src.minutes, badge: src.badge || '', reward: src.reward || null, steps: src.steps || [], outro: src.outro || '', tags: src.tags || [], sort: src.sort }))
    : { id: null, guardian: (S.data.guardians[0] || { id: 'heron' }).id, title: '', keys: '', about: '', minutes: 3, badge: '', reward: null, steps: [{ say: '' }], outro: '', tags: [], sort: 100 };
  const E = S.editor = { L, src, dirty: false };
  const v = page(src ? (src.status === 'published' ? '修改已发布的课' : '编辑草稿') : '新建课程', src && src.status === 'published'
    ? '这节课员工正在学。改了步骤或课名再保存，版本号会加一，正在学的员工会从头开始；只改简介、徽章等，不影响他们。'
    : '一步一步写：守护者说的话、情景选择题、最后一张要点卡。右边是员工看到的样子。');
  const wrap = h('div', { class: 'editor' });
  const left = h('div', null);
  const right = h('div', { class: 'card preview' });
  wrap.appendChild(left); wrap.appendChild(right);
  v.appendChild(wrap);
  const probs = h('div');
  const changed = () => { E.dirty = true; drawProblems(); drawPreview(); state.textContent = '有未保存的修改'; };
  // the lesson's own fields
  const g = () => guardianById(L.guardian) || { world: 'koi', name: '守护者' };
  const field = (label, input, hint) => h('div', { class: 'field' }, h('label', { text: label }), input, hint ? h('div', { class: 'hint', text: hint }) : null);
  const inp = (key, attrs) => h('input', Object.assign({ class: 'input', value: L[key] == null ? '' : L[key], oninput: e => { L[key] = e.target.value; changed(); } }, attrs || {}));
  const kinds = () => KINDS[g().world] || [];
  const rewardKind = h('select', { class: 'select', onchange: e => {
    const k = e.target.value;
    if (!k) L.reward = null;
    else { const kd = kinds().find(x => x[0] === k); L.reward = { kind: k, name: (L.reward && L.reward.name) || '', what: kd ? kd[1] : '' }; }
    rewardName.disabled = !L.reward; changed();
  } }, h('option', { value: '', text: '不送（只给徽章）' }), kinds().map(k => h('option', { value: k[0], text: k[1], selected: !!(L.reward && L.reward.kind === k[0]) })));
  const rewardName = h('input', { class: 'input', maxlength: 8, placeholder: '它的名字，例如：金麟', value: (L.reward && L.reward.name) || '', disabled: !L.reward,
    oninput: e => { if (L.reward) { L.reward.name = e.target.value; changed(); } } });
  const meta = h('div', { class: 'card pad meta' },
    S.data.guardians.length > 1 ? field('哪位守护者讲', h('select', { class: 'select', onchange: e => { L.guardian = e.target.value; changed(); } }, S.data.guardians.map(x => h('option', { value: x.id, text: `${x.name} · ${x.title}`, selected: x.id === L.guardian })))) : null,
    field('课名', inp('title', { maxlength: 80, placeholder: '例如：接待投诉的四个字' })),
    h('div', { class: 'grid2' },
      field('关键字', inp('keys', { maxlength: 80, placeholder: '例如：听 · 认 · 办 · 跟' }), '金色显示在课名下面，帮员工记住。'),
      field('大约几分钟', h('input', { class: 'input', type: 'number', min: 1, max: 60, value: L.minutes, oninput: e => { L.minutes = Math.max(1, Math.min(60, parseInt(e.target.value, 10) || 3)); changed(); } }))),
    field('一句话简介', h('textarea', { class: 'textarea', rows: 2, maxlength: 400, oninput: e => { L.about = e.target.value; changed(); } }, L.about)),
    h('div', { class: 'grid3' },
      field('徽章', inp('badge', { maxlength: 40, placeholder: '例如：接待之道' }), '第一次学完得到。'),
      field('送一位新居民', rewardKind, '第一次学完，世界里多一位。'),
      field('新居民的名字', rewardName)),
    field('最后一句话', h('textarea', { class: 'textarea', rows: 2, maxlength: 400, placeholder: '学完时守护者的临别赠言', oninput: e => { L.outro = e.target.value; changed(); } }, L.outro)),
    field('标签', h('input', { class: 'input', value: (L.tags || []).join('，'), placeholder: '用逗号隔开，例如：客服，新人必学', oninput: e => { L.tags = e.target.value.split(/[,，、\s]+/).map(x => x.trim()).filter(Boolean); changed(); } })));
  left.appendChild(meta);
  left.appendChild(h('div', { class: 'section' }, probs));
  // the steps
  const stepsBox = h('div');
  left.appendChild(stepsBox);
  const adders = h('div', { class: 'add-steps' },
    h('button', { class: 'btn', type: 'button', icon: 'plus', onclick: () => addStep({ say: '' }) }, ' 一句话'),
    h('button', { class: 'btn', type: 'button', icon: 'plus', onclick: () => addStep({ ask: '', options: [{ text: '', reply: '' }, { text: '', ok: true, reply: '' }, { text: '', reply: '' }] }) }, ' 选择题'),
    h('button', { class: 'btn', type: 'button', icon: 'plus', onclick: () => addStep({ card: { title: `要点 · ${L.title || ''}`.replace(/ · $/, ''), items: [['', ''], ['', ''], ['', '']] } }) }, ' 要点卡'));
  for (const b of adders.querySelectorAll('button')) { const s = b.querySelector('svg'); if (s) { s.style.width = '15px'; s.style.height = '15px'; } }
  left.appendChild(adders);
  function addStep(st, at) {
    if (at === undefined) L.steps.push(st); else L.steps.splice(at, 0, st);
    changed(); drawSteps();
    const cards = stepsBox.querySelectorAll('.step');
    const c = cards[at === undefined ? cards.length - 1 : at];
    if (c) { c.scrollIntoView({ behavior: 'smooth', block: 'center' }); const t = c.querySelector('textarea,input'); if (t) setTimeout(() => t.focus(), 250); }
  }
  function drawSteps() {
    stepsBox.textContent = '';
    L.steps.forEach((st, i) => stepsBox.appendChild(stepCard(st, i)));
  }
  function tools(i) {
    const t = h('div', { class: 'tools' });
    t.appendChild(h('button', { class: 'icon', type: 'button', title: '上移', icon: 'up', disabled: i === 0, onclick: () => { const s = L.steps.splice(i, 1)[0]; L.steps.splice(i - 1, 0, s); changed(); drawSteps(); } }));
    t.appendChild(h('button', { class: 'icon', type: 'button', title: '下移', icon: 'down', disabled: i === L.steps.length - 1, onclick: () => { const s = L.steps.splice(i, 1)[0]; L.steps.splice(i + 1, 0, s); changed(); drawSteps(); } }));
    t.appendChild(h('button', { class: 'icon', type: 'button', title: '在下面加一句话', icon: 'plus', onclick: () => addStep({ say: '' }, i + 1) }));
    t.appendChild(h('button', { class: 'icon', type: 'button', title: '删掉这一步', icon: 'x', onclick: () => { L.steps.splice(i, 1); changed(); drawSteps(); } }));
    return t;
  }
  function stepCard(st, i) {
    const n = i + 1;
    if (st.say !== undefined) {
      return h('div', { class: 'card step say' }, h('div', { class: 'sh' }, h('b', { text: `第 ${n} 步 · 守护者说` }), tools(i)),
        h('textarea', { class: 'textarea', rows: 2, placeholder: '守护者说的一句话。用 **两个星号** 包起来的字会变成金色。', oninput: e => { st.say = e.target.value; changed(); } }, st.say));
    }
    if (st.ask !== undefined) {
      const opts = h('div');
      const draw = () => {
        opts.textContent = '';
        st.options.forEach((o, j) => {
          const box = h('div', { class: o.ok ? 'opt right' : 'opt' },
            h('label', { class: 'ok' }, h('input', { type: 'radio', name: `ok${i}`, checked: !!o.ok, onchange: () => { st.options.forEach(x => { delete x.ok; }); o.ok = true; changed(); draw(); } }), `选项 ${'ABCD'[j]}`),
            h('div', { class: 'fs' },
              h('input', { class: 'input', value: o.text, placeholder: o.ok ? '正确的做法' : '一个看起来也说得过去的做法', oninput: e => { o.text = e.target.value; changed(); } }),
              h('textarea', { class: 'textarea', rows: 2, placeholder: o.ok ? '答对时守护者说什么' : '选了这个，守护者怎么解释为什么不妥', oninput: e => { o.reply = e.target.value; changed(); } }, o.reply || '')),
            st.options.length > 2 ? h('button', { class: 'btn small ghost x', type: 'button', text: '删掉这个选项', onclick: () => { st.options.splice(j, 1); changed(); draw(); } }) : null);
          opts.appendChild(box);
        });
        if (st.options.length < 4) opts.appendChild(h('div', { class: 'row', style: 'margin-top:8px' }, h('button', { class: 'btn small', type: 'button', text: '+ 再加一个选项', onclick: () => { st.options.push({ text: '', reply: '' }); changed(); draw(); } })));
      };
      draw();
      return h('div', { class: 'card step ask' }, h('div', { class: 'sh' }, h('b', { text: `第 ${n} 步 · 选择题` }), tools(i)),
        h('textarea', { class: 'textarea', rows: 2, placeholder: '一个工作中的情景，问员工该怎么做', oninput: e => { st.ask = e.target.value; changed(); } }, st.ask),
        opts, h('div', { class: 'hint', style: 'margin-top:8px;font-size:12.5px;color:var(--ink-3)', text: '选错了，守护者会解释，再问一次（选错的会划掉）。第一次就答对的题越多，星星越多。' }));
    }
    const c = st.card;
    const items = h('div');
    const draw = () => {
      items.textContent = '';
      c.items.forEach((it, j) => items.appendChild(h('div', { class: 'item' },
        h('input', { class: 'input', value: it[0], maxlength: 8, placeholder: '关键字', oninput: e => { it[0] = e.target.value; changed(); } }),
        h('input', { class: 'input', value: it[1], placeholder: '一句话说明', oninput: e => { it[1] = e.target.value; changed(); } }),
        h('button', { class: 'icon', type: 'button', title: '删掉这一条', icon: 'x', onclick: () => { c.items.splice(j, 1); changed(); draw(); } }))));
      items.appendChild(h('div', { class: 'row', style: 'margin-top:8px' }, h('button', { class: 'btn small', type: 'button', text: '+ 再加一条', onclick: () => { c.items.push(['', '']); changed(); draw(); } })));
    };
    draw();
    return h('div', { class: 'card step card-step' }, h('div', { class: 'sh' }, h('b', { text: `第 ${n} 步 · 要点卡` }), tools(i)),
      h('input', { class: 'input', value: c.title, placeholder: '要点卡的标题', oninput: e => { c.title = e.target.value; changed(); } }),
      items, h('div', { class: 'hint', style: 'margin-top:8px;font-size:12.5px;color:var(--ink-3)', text: '学完以后，员工在「学习」面板里点「要点」随时能再看，适合当 SOP 速查。' }));
  }
  function drawProblems() {
    const { p, warn } = problemsOf(L);
    probs.textContent = '';
    if (!p.length && !warn.length) { probs.appendChild(h('div', { class: 'probs-box ok', text: '检查过了：这节课可以发布。' })); return; }
    const box = h('div', { class: p.length ? 'probs-box' : 'probs-box ok' });
    if (p.length) box.appendChild(h('div', null, h('b', { text: '发布前还要处理：' }), h('ul', null, p.map(x => h('li', { text: x })))));
    else box.appendChild(h('div', { text: '可以发布。' }));
    if (warn.length) box.appendChild(h('div', { style: p.length ? 'margin-top:6px' : '' }, h('b', { text: '建议：' }), h('ul', null, warn.map(x => h('li', { text: x })))));
    probs.appendChild(box);
  }
  function drawPreview() {
    right.textContent = '';
    const gd = g();
    right.appendChild(h('div', { class: 'ph' }, h('span', { text: '员工看到的样子' })));
    const pv = h('div', { class: 'pv' });
    pv.appendChild(h('span', { class: 'who', text: gd.name }));
    if (L.title) pv.appendChild(h('div', { class: 'say' }, rich(gd.lines && gd.lines.start ? gd.lines.start : '你来了。那我们开始吧。')));
    for (const st of L.steps) {
      if (st.say !== undefined) { if (st.say.trim()) pv.appendChild(h('div', { class: 'say' }, rich(st.say))); }
      else if (st.ask !== undefined) {
        pv.appendChild(h('div', { class: 'q' }, rich(st.ask || '（题目）')));
        st.options.forEach((o, j) => {
          pv.appendChild(h('div', { class: o.ok ? 'o ok' : 'o' }, h('i', { text: 'ABCD'[j] }), h('span', { text: o.text || '（选项）' })));
          if (o.reply) pv.appendChild(h('div', { class: 'r' }, rich(o.reply)));
        });
      } else if (st.card) {
        pv.appendChild(h('div', { class: 'kc' }, h('h4', { text: st.card.title || '要点' }), st.card.items.filter(it => it[0] || it[1]).map(it => h('div', null, h('b', { text: it[0] }), h('span', { text: it[1] })))));
      }
    }
    const end = [];
    if (L.badge) end.push(`徽章「${L.badge}」`);
    if (L.reward && L.reward.kind) end.push(`${L.reward.what}「${L.reward.name || '（名字）'}」`);
    pv.appendChild(h('div', { class: 'end' }, h('div', { text: `学完：${end.length ? '获得 ' + end.join('、') : '没有奖励'}` }), L.outro ? h('div', { class: 'say', style: 'margin-top:8px;color:#f5f2ea' }, rich(L.outro)) : null));
    right.appendChild(pv);
  }
  // the bar at the bottom: save, publish
  const state = h('span', { class: 'state', text: src ? `改于 ${when(src.updatedAt)}` : '还没保存' });
  async function save(andPublish) {
    if (L.reward && !String(L.reward.name || '').trim()) { toast('请给新居民起个名字，或者选「不送」', true); return; }
    const lesson = clean(L);
    const r = await call('admin_save_lesson', { lesson });
    if (!r.ok) {
      toast(r.error === 'problems' ? `已发布的课要先改好：${r.problems.join('；')}` : r.error === 'guardian' ? '这位守护者不存在' : '没能保存，请稍后再试', true);
      return false;
    }
    E.dirty = false;
    L.id = r.id;
    if (andPublish && (!src || src.status !== 'published')) {
      const p = await call('admin_lesson_status', { lesson: r.id, status: 'published' });
      if (!p.ok) { toast(`已保存，但还不能发布：${(p.problems || []).join('；')}`, true); await reload(); go(`#/lesson/${r.id}`); return false; }
      toast(`已发布「${lesson.title}」，员工的屏幕会在 10 分钟内收到`);
      await reload();
      go('#/lessons');
      return true;
    }
    toast(src && src.status === 'published' ? (r.version > src.version ? `已保存，现在是第 ${r.version} 版` : '已保存') : '草稿已保存');
    await reload();
    if (location.hash !== `#/lesson/${r.id}`) go(`#/lesson/${r.id}`); else route();
    return true;
  }
  const bar = h('div', { class: 'savebar' }, h('div', { class: 'in' },
    h('a', { class: 'btn ghost', href: '#/lessons', text: '← 返回课程' }), state, h('span', { class: 'spacer' }),
    src ? h('button', { class: 'btn wide-only', type: 'button', text: '复制为新草稿', onclick: async () => {
      const copyL = clean(L); copyL.title = `${copyL.title}（副本）`.slice(0, 80);
      const r = await call('admin_save_lesson', { lesson: copyL });
      if (r.ok) { E.dirty = false; toast('已复制为新草稿'); await reload(); go(`#/lesson/${r.id}`); }
    } }) : null,
    h('button', { class: src && src.status === 'published' ? 'btn primary' : 'btn', type: 'button', text: src && src.status === 'published' ? '保存修改' : '保存草稿', onclick: () => save(false) }),
    !src || src.status !== 'published' ? h('button', { class: 'btn primary', type: 'button', text: '保存并发布', onclick: () => {
      if (problemsOf(L).p.length) { toast('还有问题要处理，先看上面的清单', true); return; }
      save(true);
    } }) : null));
  v.appendChild(bar);
  drawSteps(); drawProblems(); drawPreview();
}
/** The lesson as the backend keeps it: trimmed, no empty card rows, ok only on the right option. */
function clean(L) {
  const steps = L.steps.map(st => {
    if (st.say !== undefined) return { say: String(st.say).trim() };
    if (st.ask !== undefined) return { ask: String(st.ask).trim(), options: st.options.map(o => { const x = { text: String(o.text || '').trim() }; if (o.ok) x.ok = true; if (String(o.reply || '').trim()) x.reply = String(o.reply).trim(); return x; }) };
    return { card: { title: String(st.card.title || '').trim() || '要点', items: st.card.items.map(it => [String(it[0] || '').trim(), String(it[1] || '').trim()]).filter(it => it[0] || it[1]) } };
  });
  const out = { guardian: L.guardian, title: String(L.title || '').trim(), keys: String(L.keys || '').trim(), about: String(L.about || '').trim(), minutes: L.minutes,
    badge: String(L.badge || '').trim() || null, reward: L.reward && L.reward.kind ? { kind: L.reward.kind, name: String(L.reward.name || '').trim(), what: L.reward.what } : null,
    steps, outro: String(L.outro || '').trim(), tags: L.tags || [], sort: L.sort };
  if (L.id) out.id = L.id;
  return out;
}

/* ---------- 一节课的学习情况 ---------- */
async function pageReport(id) {
  const r = await call('admin_lesson_report', { lesson: id });
  if (S.view !== 'report') return;
  if (!r.ok) { page('找不到这节课', '它可能已经被删除了。', [h('a', { class: 'btn', href: '#/lessons', text: '返回课程' })]); return; }
  const L = r.lesson;
  const v = page(`学习情况 · ${L.title}`, `第 ${L.version} 版。每道题看的是员工第一次的答案（错题回顾里的不算）。`, [h('a', { class: 'btn', href: '#/lessons', text: '返回课程' }), h('a', { class: 'btn', href: `#/lesson/${L.id}`, text: '修改这节课' })]);
  const done = r.learners.filter(x => x.done);
  const tiles = h('div', { class: 'tiles' });
  const tile = (n, t) => tiles.appendChild(h('div', { class: 'card tile' }, h('b', { text: String(n) }), h('span', { text: t })));
  const right = r.questions.reduce((a, q) => a + q.right, 0), answers = r.questions.reduce((a, q) => a + q.answers, 0);
  tile(r.learners.length, '学过的人');
  tile(done.length, '学完的人');
  tile(done.length ? (done.reduce((a, x) => a + x.stars, 0) / done.length).toFixed(1) : '—', '平均星级');
  tile(pct(right, answers), '第一次就答对');
  tile(dur(done.length ? done.reduce((a, x) => a + (x.seconds || 0) / Math.max(1, x.runs), 0) / done.length : 0), '平均用时');
  v.appendChild(tiles);
  // the questions
  const qs = h('div', { class: 'section' }, h('h2', { text: '每道题' }));
  const steps = L.steps || [];
  let any = false;
  steps.forEach((st, i) => {
    if (st.ask === undefined) return;
    any = true;
    const q = r.questions.find(x => x.step === i) || { answers: 0, right: 0, choices: {} };
    const card = h('div', { class: 'card q-card' }, h('div', { class: 'q' }, rich(st.ask)), h('div', { class: 'm', text: q.answers ? `${q.answers} 人答过，第一次就答对 ${pct(q.right, q.answers)}` : '还没有人答过' }));
    const bars = h('div', { class: 'bars' });
    st.options.forEach((o, j) => {
      const n = (q.choices && q.choices[String(j)]) || 0;
      bars.appendChild(h('div', { class: 'bar' }, h('span', { class: o.ok ? 't ok' : 't', text: `${'ABCD'[j]}. ${plain(o.text)}${o.ok ? '（正确）' : ''}` }),
        h('span', { class: 'g' }, h('i', { class: o.ok ? 'ok' : '', style: `width:${q.answers ? Math.round(100 * n / q.answers) : 0}%` })), h('span', { class: 'v', text: String(n) })));
    });
    card.appendChild(bars);
    if (q.answers >= 3 && q.right / q.answers < 0.5) card.appendChild(h('div', { class: 'm', style: 'color:var(--warn);margin-top:8px', text: '一半以上的人第一次答错了：可能这一步讲得不够清楚，或者题目有歧义。' }));
    qs.appendChild(card);
  });
  if (!any) qs.appendChild(h('div', { class: 'card empty', text: '这节课没有选择题。' }));
  v.appendChild(qs);
  // who
  const ls = h('div', { class: 'section' }, h('h2', { text: '学过的人' }));
  if (!r.learners.length) ls.appendChild(h('div', { class: 'card empty', text: '还没有人学过这节课。' }));
  else ls.appendChild(h('div', { class: 'card table-wrap' }, h('table', null, h('thead', null, h('tr', null, h('th', { text: '员工' }), h('th', { text: '进度' }), h('th', { class: 'num', text: '学了几遍' }), h('th', { class: 'num', text: '用时' }), h('th', { class: 'num', text: '最近' }))),
    h('tbody', null, r.learners.map(x => h('tr', null, h('td', null, h('span', { class: 'name', text: x.employee }), x.dept ? h('span', { class: 'sub', text: x.dept }) : null),
      h('td', null, x.done ? h('span', null, stars(x.stars), x.current ? null : h('span', { class: 'tag warn', style: 'margin-left:6px', text: '学的是旧版' })) : h('span', { class: 'muted', text: `学到第 ${x.step + 1} 步` })),
      h('td', { class: 'num', text: x.runs || '—' }), h('td', { class: 'num', text: dur(x.seconds) }), h('td', { class: 'num muted', text: when(x.at) })))))));
  v.appendChild(ls);
}

/* ---------- 员工 ---------- */
function pagePeople() {
  const d = S.data;
  const v = page('员工', '员工在屏幕上点自己的名字、输入 4 位密码登录学习。密码只在设定时显示一次，请转告本人。', [
    h('button', { class: 'btn', type: 'button', text: '批量添加', onclick: bulkAdd }),
    h('button', { class: 'btn primary', type: 'button', text: '添加员工', onclick: () => editPerson(null) }),
  ]);
  if (!d.employees.length) { v.appendChild(h('div', { class: 'card empty' }, '还没有员工。', h('br'), '点「添加员工」一个个加，或者「批量添加」一次粘贴整个名单。')); return; }
  const depts = [...new Set(d.employees.map(e => e.dept).filter(Boolean))];
  const f = { q: '', dept: '', off: false };
  const q = h('input', { class: 'input', type: 'search', placeholder: '找名字', style: 'max-width:220px', oninput: e => { f.q = e.target.value.trim(); draw(); } });
  const dp = h('select', { class: 'select', style: 'max-width:180px', onchange: e => { f.dept = e.target.value; draw(); } }, h('option', { value: '', text: '所有部门' }), depts.map(x => h('option', { value: x, text: x })));
  const off = h('label', { class: 'row', style: 'gap:6px;font-size:14px;color:var(--ink-2)' }, h('input', { type: 'checkbox', onchange: e => { f.off = e.target.checked; draw(); } }), '显示已停用的');
  v.appendChild(h('div', { class: 'row', style: 'margin-bottom:12px' }, q, depts.length > 1 ? dp : null, d.employees.some(e => !e.active) ? off : null));
  const box = h('div', { class: 'card table-wrap' });
  v.appendChild(box);
  const pub = d.lessons.filter(l => l.status === 'published').length;
  function draw() {
    const rows = d.employees.filter(e => (f.off || e.active) && (!f.dept || e.dept === f.dept) && (!f.q || e.name.indexOf(f.q) >= 0));
    box.textContent = '';
    box.appendChild(h('table', null, h('thead', null, h('tr', null, h('th', { text: '姓名' }), h('th', { text: '部门' }), h('th', { class: 'num', text: '学完' }), h('th', { class: 'num', text: '星' }), h('th', { class: 'num', text: '首答正确' }), h('th', { class: 'num', text: '学习时长' }), h('th', { class: 'num', text: '最近学习' }), h('th', { text: '状态' }), h('th'))),
      h('tbody', null, rows.map(e => h('tr', null,
        h('td', null, h('a', { class: 'name', href: `#/person/${e.id}`, text: e.name }), e.role ? h('span', { class: 'sub', text: e.role }) : null),
        h('td', { text: e.dept || '—' }),
        h('td', { class: 'num', text: `${e.finished} / ${pub}` }), h('td', { class: 'num', text: e.stars }), h('td', { class: 'num', text: pct(e.right, e.answered) }),
        h('td', { class: 'num', text: dur(e.seconds) }), h('td', { class: 'num muted', text: when(e.lastActive) }),
        h('td', null, !e.active ? h('span', { class: 'tag', text: '已停用' }) : e.locked ? h('span', { class: 'tag bad', text: '锁定中' }) : e.lastLogin ? h('span', { class: 'tag ok', text: '正常' }) : h('span', { class: 'tag warn', text: '还没登录过' })),
        h('td', { class: 'acts' },
          e.locked ? h('button', { class: 'btn small', type: 'button', text: '解锁', onclick: async () => { await call('admin_unlock', { employee: e.id }); toast(`${e.name} 已解锁`); await reload(); route(); } }) : null,
          h('button', { class: 'btn small', type: 'button', text: '编辑', onclick: () => editPerson(e) })))))));
    if (!rows.length) box.appendChild(h('div', { class: 'empty', text: '没有符合的员工。' }));
  }
  draw();
}
function editPerson(e) {
  const isNew = !e;
  const name = h('input', { class: 'input', maxlength: 40, value: e ? e.name : '' });
  const dept = h('input', { class: 'input', maxlength: 40, value: e ? e.dept : '', list: 'deptList' });
  const role = h('input', { class: 'input', maxlength: 40, value: e ? e.role : '' });
  const pin = h('input', { class: 'input mono', maxlength: 4, inputmode: 'numeric', value: isNew ? randomPin() : '', placeholder: isNew ? '' : '不改就留空' });
  const active = h('input', { type: 'checkbox', checked: !e || e.active });
  const msg = h('div', { class: 'msg' });
  const depts = [...new Set(S.data.employees.map(x => x.dept).filter(Boolean))];
  const body = h('div', { class: 'form' },
    h('datalist', { id: 'deptList' }, depts.map(x => h('option', { value: x }))),
    h('div', { class: 'grid2' }, h('div', { class: 'field' }, h('label', { text: '姓名' }), name), h('div', { class: 'field' }, h('label', { text: '部门' }), dept)),
    h('div', { class: 'grid2' }, h('div', { class: 'field' }, h('label', { text: '职位（可不填）' }), role),
      h('div', { class: 'field' }, h('label', { text: isNew ? '4 位密码' : '设新密码' }), h('div', { class: 'row', style: 'flex-wrap:nowrap' }, pin, h('button', { class: 'btn small', type: 'button', text: '随机', onclick: () => { pin.value = randomPin(); } })))),
    e ? h('label', { class: 'row', style: 'gap:8px;font-size:14px' }, active, '在职（停用后不能登录，学习记录保留）') : null,
    msg);
  const actions = [{ text: '取消' }];
  if (e) actions.unshift({ text: '删除', danger: true, run: async () => {
    const r = await call('admin_delete_employee', { employee: e.id });
    if (!r.ok) { msg.className = 'msg err'; msg.textContent = r.error === 'records' ? `${e.name} 已经有学习记录，不能删除；不在职了可以取消勾选「在职」。` : '没能删除'; return false; }
    toast(`已删除 ${e.name}`); await reload(); route(); return true;
  } });
  actions.push({ text: isNew ? '添加' : '保存', primary: true, run: async () => {
    const p = pin.value.trim();
    if (!name.value.trim()) { msg.className = 'msg err'; msg.textContent = '请填姓名'; return false; }
    if ((isNew || p) && !/^[0-9]{4}$/.test(p)) { msg.className = 'msg err'; msg.textContent = '密码要 4 位数字'; return false; }
    const emp = { name: name.value, dept: dept.value, role: role.value };
    if (e) { emp.id = e.id; emp.active = active.checked; }
    if (p) emp.pin = p;
    const r = await call('admin_save_employee', { employee: emp });
    if (!r.ok) { msg.className = 'msg err'; msg.textContent = r.error === 'taken' ? '同一个部门里已经有这个名字了（同名的人请写上区别，例如：小明（客服））' : '没能保存'; return false; }
    await reload(); route();
    if (!p) { toast('已保存'); return true; }
    dialog(`${name.value.trim()} 的登录密码`, '请转告本人。这个密码只显示这一次（后台只存它的加密形式），忘了可以在这里设新的。', h('div', { class: 'code', text: p }), [{ text: '好' }]);
    return false; // (the PIN's own dialog is showing now)
  } });
  dialog(isNew ? '添加员工' : `编辑 · ${e.name}`, null, body, actions);
}
function bulkAdd() {
  const text = h('textarea', { class: 'textarea', rows: 10, placeholder: '每行一个人：姓名 部门 职位（职位可不写），用空格、逗号或 Tab 隔开。可以直接从 Excel 里复制两三列粘贴进来。\n例如：\n小明 客服 专员\n小红 销售' });
  const out = h('div');
  const body = h('div', { class: 'form' }, text, out);
  let rows = [];
  const parse = () => {
    rows = text.value.split(/\n/).map(l => l.trim()).filter(Boolean).map(l => l.split(/[\t,，、;；]+|\s{1,}/).map(x => x.trim()).filter(Boolean)).filter(c => c.length)
      .map(c => ({ name: c[0].slice(0, 40), dept: (c[1] || '').slice(0, 40), role: c.slice(2).join(' ').slice(0, 40), pin: randomPin() }));
    out.textContent = '';
    if (rows.length) out.appendChild(h('div', { class: 'hint', style: 'font-size:13px;color:var(--ink-2)', text: `准备添加 ${rows.length} 人，每人一个随机的 4 位密码（添加后显示，可以复制或打印出来发给大家）。` }));
  };
  text.addEventListener('input', parse);
  dialog('批量添加员工', null, body, [{ text: '取消' }, { text: '添加', primary: true, run: async () => {
    parse();
    if (!rows.length) return false;
    const done = [];
    for (const r of rows) {
      const res = await call('admin_save_employee', { employee: { name: r.name, dept: r.dept, role: r.role, pin: r.pin } });
      done.push(Object.assign({ ok: res.ok, error: res.error }, r));
    }
    await reload(); route();
    const ok = done.filter(r => r.ok), bad = done.filter(r => !r.ok);
    const table = h('div', { class: 'table-wrap' }, h('table', null, h('thead', null, h('tr', null, h('th', { text: '姓名' }), h('th', { text: '部门' }), h('th', { text: '密码' }))),
      h('tbody', null, ok.map(r => h('tr', null, h('td', { text: r.name }), h('td', { text: r.dept || '—' }), h('td', { class: 'mono', text: r.pin }))))));
    const list = ok.map(r => `${r.name}\t${r.dept}\t${r.pin}`).join('\n');
    dialog(`已添加 ${ok.length} 人`, bad.length ? `另有 ${bad.length} 人没加上（同部门里已有同名的人）：${bad.map(r => r.name).join('、')}` : '这些密码只显示这一次，请复制或打印出来，分别转告本人。', table, [
      { text: '复制名单', run: () => { copy(list, '名单'); return false; } }, { text: '打印', run: () => { window.print(); return false; } }, { text: '好', primary: true }], true);
    return false;
  } }], true);
}
async function pagePerson(id) {
  const e = personById(id);
  if (!e) { page('找不到这位员工', '', [h('a', { class: 'btn', href: '#/people', text: '返回员工' })]); return; }
  const r = await call('admin_employee_report', { employee: id });
  if (S.view !== 'person') return;
  const a = r.archive;
  const v = page(`${e.name} 的学习档案`, [e.dept, e.role].filter(Boolean).join(' · ') || ' ', [h('a', { class: 'btn', href: '#/people', text: '返回员工' }), h('button', { class: 'btn', type: 'button', text: '编辑', onclick: () => editPerson(e) })]);
  const pub = S.data.lessons.filter(l => l.status === 'published');
  let secs = 0;
  for (const k of Object.keys(a.progress)) secs += a.progress[k].seconds || 0;
  const tiles = h('div', { class: 'tiles' });
  const tile = (n, t) => tiles.appendChild(h('div', { class: 'card tile' }, h('b', { text: String(n) }), h('span', { text: t })));
  tile(`${pub.filter(l => a.progress[l.id] && a.progress[l.id].done).length} / ${pub.length}`, '学完的课');
  tile(pub.reduce((s, l) => s + (a.progress[l.id] && a.progress[l.id].done ? a.progress[l.id].stars : 0), 0), '星星');
  tile(pct(a.right, a.answered), '第一次就答对');
  tile(dur(secs), '学习时长');
  tile(a.badges.length, '徽章');
  v.appendChild(tiles);
  // the lessons
  v.appendChild(h('div', { class: 'section' }, h('h2', { text: '每节课' }), h('div', { class: 'card table-wrap' }, h('table', null, h('thead', null, h('tr', null, h('th', { text: '课' }), h('th', { text: '进度' }), h('th', { class: 'num', text: '学了几遍' }), h('th', { class: 'num', text: '用时' }), h('th', { class: 'num', text: '最近' }))),
    h('tbody', null, pub.map(l => { const p = a.progress[l.id]; return h('tr', null, h('td', { class: 'name', text: l.title }),
      h('td', null, !p ? h('span', { class: 'muted', text: '还没学' }) : p.done ? h('span', null, stars(p.stars), p.doneVersion < l.version ? h('span', { class: 'tag warn', style: 'margin-left:6px', text: '学的是旧版' }) : null) : h('span', { class: 'muted', text: `学到第 ${p.step + 1} 步` })),
      h('td', { class: 'num', text: p ? p.runs || '—' : '—' }), h('td', { class: 'num', text: p ? dur(p.seconds) : '—' }), h('td', { class: 'num muted', text: p ? when(p.at) : '—' })); }))))));
  // wrong answers still to review
  const ms = a.misses.map(m => { const l = lessonById(m.lesson); const st = l && l.steps[m.step]; return st && st.ask !== undefined ? { l, st, m } : null; }).filter(Boolean);
  const msec = h('div', { class: 'section' }, h('h2', { text: `还没答对的题（${ms.length}）` }));
  if (!ms.length) msec.appendChild(h('div', { class: 'card empty', text: '没有。答错的题会留在这里，直到本人在错题回顾里答对。' }));
  for (const x of ms) msec.appendChild(h('div', { class: 'card q-card' }, h('div', { class: 'm', text: x.l.title }), h('div', { class: 'q' }, rich(x.st.ask)),
    h('div', { class: 'm' }, '当时选了：', h('span', { style: 'color:var(--bad)', text: plain((x.st.options[x.m.choice] || {}).text || '') }), '　正确的是：', h('span', { style: 'color:var(--ok)', text: plain((x.st.options.find(o => o.ok) || {}).text || '') }))));
  v.appendChild(msec);
  // every answer
  const ans = r.answers.slice(0, 60);
  v.appendChild(h('div', { class: 'section' }, h('h2', { text: '答题记录' }), !ans.length ? h('div', { class: 'card empty', text: '还没有答过题。' }) : h('div', { class: 'card table-wrap' }, h('table', null,
    h('thead', null, h('tr', null, h('th', { text: '时间' }), h('th', { text: '课' }), h('th', { text: '题' }), h('th', { text: '答' }))),
    h('tbody', null, ans.map(x => { const l = lessonById(x.lesson); const st = l && l.version === x.version ? l.steps[x.step] : null; return h('tr', null,
      h('td', { class: 'muted', text: when(x.at) }), h('td', { text: x.title }), h('td', { text: st && st.ask ? plain(st.ask).slice(0, 40) + (plain(st.ask).length > 40 ? '…' : '') : `第 ${x.step + 1} 步（旧版）` }),
      h('td', null, h('span', { class: x.correct ? 'tag ok' : 'tag bad', text: x.correct ? '对' : '错' }), x.review ? h('span', { class: 'tag', style: 'margin-left:6px', text: '回顾' }) : !x.first ? h('span', { class: 'tag', style: 'margin-left:6px', text: '再答' }) : null)); }))))));
}

/* ---------- 设备 ---------- */
function pageDevices() {
  const d = S.data;
  const v = page('设备', '能显示公司课程的屏幕。共享屏幕（前台的 iPad）每台一个登记码；员工自己的手机或电脑，用一个团队码就能登记很多台。', [
    h('button', { class: 'btn', type: 'button', text: '员工手机团队码', onclick: newTeamCode }),
    h('button', { class: 'btn primary', type: 'button', text: '添加共享屏幕', onclick: newScreen }),
  ]);
  const box = h('div', { class: 'card table-wrap' });
  if (!d.devices.length) box.appendChild(h('div', { class: 'empty', text: '还没有登记任何设备。点「添加共享屏幕」给前台的 iPad 一个登记码。' }));
  else box.appendChild(h('table', null, h('thead', null, h('tr', null, h('th', { text: '名称' }), h('th', { text: '类型' }), h('th', { text: '状态' }), h('th', { class: 'num', text: '最近在线' }), h('th'))),
    h('tbody', null, d.devices.map(x => h('tr', null,
      h('td', { class: 'name', text: x.label || '（没有名字）' }),
      h('td', null, h('span', { class: x.personal ? 'tag blue' : 'tag gold', text: x.personal ? '个人设备' : '共享屏幕' })),
      h('td', null, !x.active ? h('span', { class: 'tag', text: '已停用' }) : x.registered ? h('span', { class: 'tag ok', text: '已连接' }) : x.pending ? h('span', { class: 'tag warn', text: `等待登记 · 码 ${when(x.codeExpires).replace('前', '后')}前有效` }) : h('span', { class: 'tag bad', text: '登记码已过期' })),
      h('td', { class: 'num muted', text: when(x.lastSeen) }),
      h('td', { class: 'acts' },
        h('button', { class: 'btn small', type: 'button', text: '改名', onclick: () => renameDevice(x) }),
        x.active ? h('button', { class: 'btn small', type: 'button', text: '新登记码', onclick: () => confirmBox('给这台设备一个新的登记码？', x.registered ? `「${x.label}」现在的连接会断开，要在那台设备上输入新的登记码重新连接。` : '旧的登记码会作废。', '生成新码', async () => { const r = await call('admin_device', { device: x.id, new_code: true }); await reload(); route(); showSetupCode(x.label, r.code); return false; }) }) : null,
        x.active ? h('button', { class: 'btn small danger', type: 'button', text: '停用', onclick: () => confirmBox('停用这台设备？', `「${x.label}」会马上回到示范课，在它上面登录的员工会被退出。学习记录都保留。`, '停用', async () => { await call('admin_device', { device: x.id, active: false }); toast('已停用'); await reload(); route(); }, true) })
          : h('button', { class: 'btn small', type: 'button', text: '启用', onclick: async () => { await call('admin_device', { device: x.id, active: true }); await reload(); route(); } })))))));
  v.appendChild(box);
  // team codes
  const codes = d.joinCodes || [];
  const sec = h('div', { class: 'section' }, h('h2', { text: '团队码' }));
  if (!codes.length) sec.appendChild(h('div', { class: 'card empty', text: '还没有团队码。员工想用自己的手机学习时，点「员工手机团队码」生成一个，把链接发到工作群。' }));
  else sec.appendChild(h('div', { class: 'card table-wrap' }, h('table', null, h('thead', null, h('tr', null, h('th', { text: '名称' }), h('th', { class: 'num', text: '已登记' }), h('th', { class: 'num', text: '还能登记' }), h('th', { class: 'num', text: '到期' }), h('th', { text: '状态' }), h('th'))),
    h('tbody', null, codes.map(c => h('tr', null, h('td', { class: 'name', text: c.label || '团队码' }), h('td', { class: 'num', text: c.used }), h('td', { class: 'num', text: c.left }),
      h('td', { class: 'num muted', text: new Date(c.expires).toLocaleDateString('zh-CN') }),
      h('td', null, h('span', { class: c.live ? 'tag ok' : 'tag', text: c.live ? '有效' : c.left ? '已过期' : '已用完或已停止' })),
      h('td', { class: 'acts' }, c.live ? h('button', { class: 'btn small danger', type: 'button', text: '停止', onclick: async () => { await call('admin_join_code', { stop: c.id }); toast('团队码已停止'); await reload(); route(); } }) : null)))))));
  v.appendChild(sec);
}
function newScreen() {
  const label = h('input', { class: 'input', maxlength: 40, placeholder: '例如：前台 iPad、会议室电视' });
  dialog('添加共享屏幕', '给这台屏幕起个名字。生成登记码后，在那台设备上打开栖境，进入「设置 → 公司学习」输入登记码。', h('div', { class: 'field' }, h('label', { text: '名称' }), label), [
    { text: '取消' },
    { text: '生成登记码', primary: true, run: async () => {
      if (!label.value.trim()) { label.focus(); return false; }
      const r = await call('admin_device', { device_label: label.value.trim() });
      await reload(); route();
      showSetupCode(label.value.trim(), r.code);
      return false;
    } }]);
}
function showSetupCode(name, code) {
  dialog(`「${name}」的登记码`, null, h('div', null, h('div', { class: 'code', text: code }),
    h('ol', { class: 'how' }, h('li', { text: '在那台设备上打开栖境（iPad 上就是主屏幕上的栖境图标）。' }), h('li', { text: '点右上角的设置，找到「公司学习」。' }), h('li', { text: '输入上面的登记码，点「连接」。' })),
    h('p', { class: 'muted', style: 'font-size:13px;margin:10px 0 0', text: '登记码 7 天内有效，只能用一次，也只显示这一次。没用上的话，可以在设备列表里点「新登记码」。' })), [{ text: '好', primary: true }]);
}
function newTeamCode() {
  const label = h('input', { class: 'input', maxlength: 30, value: '员工手机' });
  const uses = h('input', { class: 'input', type: 'number', min: 1, max: 500, value: Math.max(10, S.data.employees.filter(e => e.active).length + 5) });
  const days = h('select', { class: 'select' }, [[7, '7 天'], [30, '30 天'], [90, '90 天']].map(x => h('option', { value: x[0], text: x[1] })));
  dialog('员工手机团队码', '一个团队码可以登记多台员工自己的手机或电脑（个人设备：登录一次就一直保持登录）。把生成的链接发到工作群，员工点开就连上了。', h('div', { class: 'form' },
    h('div', { class: 'field' }, h('label', { text: '名称' }), label, h('div', { class: 'hint', text: '用这个码登记的设备会叫「名称 + 编号」，例如：员工手机 3' })),
    h('div', { class: 'grid2' }, h('div', { class: 'field' }, h('label', { text: '最多登记几台' }), uses), h('div', { class: 'field' }, h('label', { text: '有效期' }), days))), [
    { text: '取消' },
    { text: '生成', primary: true, run: async () => {
      const r = await call('admin_join_code', { code_label: label.value.trim() || '员工手机', uses: parseInt(uses.value, 10) || 30, days: parseInt(days.value, 10) || 7 });
      await reload(); route();
      const link = `${PLAY}#join=${r.code}`;
      dialog('团队码已生成', null, h('div', null, h('div', { class: 'code', text: r.code }),
        h('div', { class: 'field', style: 'margin-top:14px' }, h('label', { text: '发给员工的链接' }), h('div', { class: 'copyline' }, h('input', { class: 'input', value: link, readonly: true, onclick: e => e.target.select() }), h('button', { class: 'btn', type: 'button', text: '复制', onclick: () => copy(link, '链接') }))),
        h('ol', { class: 'how' }, h('li', { text: '员工用手机点开这个链接，就自动连上了（建议再「添加到主屏幕」）。' }), h('li', { text: '也可以打开栖境，在「设置 → 公司学习」里输入上面的码。' }), h('li', { text: '然后在「学习」里点自己的名字、输入 4 位密码。' })),
        h('p', { class: 'muted', style: 'font-size:13px;margin:10px 0 0', text: '这个码和链接只显示这一次。担心外传，可以随时在团队码列表里「停止」。' })), [{ text: '好', primary: true }]);
      return false;
    } }]);
}
function renameDevice(x) {
  const label = h('input', { class: 'input', maxlength: 40, value: x.label });
  const kind = h('select', { class: 'select' }, h('option', { value: '0', text: '共享屏幕（员工 3 分钟不操作就退出登录）', selected: !x.personal }), h('option', { value: '1', text: '个人设备（一直保持登录）', selected: x.personal }));
  dialog('设备名称和类型', null, h('div', { class: 'form' }, h('div', { class: 'field' }, h('label', { text: '名称' }), label), h('div', { class: 'field' }, h('label', { text: '类型' }), kind)), [
    { text: '取消' }, { text: '保存', primary: true, run: async () => { await call('admin_device', { device: x.id, device_label: label.value.trim(), personal: kind.value === '1' }); await reload(); route(); toast('已保存'); } }]);
}

/* ---------- 资料来源 ---------- */
function pageSources() {
  const d = S.data;
  const v = page('资料来源', '自动起草用过的资料（例如 Google Drive 里的 SOP 和案例）。每份资料起草成一节课草稿，在「课程」里审核后发布；资料更新了，会再起草一份新的草稿。');
  v.appendChild(h('div', { class: 'card pad', style: 'margin-bottom:16px' }, h('h2', { style: 'font-size:16px;margin-bottom:8px', text: '怎么让资料自动变成课' }),
    h('ol', { class: 'how' },
      h('li', { text: '在 Google Drive 里建一个文件夹（例如「栖境课程资料」），团队把 SOP、案例、制度放进去。' }),
      h('li', { text: '让 Claude 每天早上看一遍这个文件夹：新的或改过的资料，会起草成课程草稿，出现在「课程」里。' }),
      h('li', { text: '你审核、修改，满意了就发布。没有审核的草稿，员工看不到。' })),
    h('p', { class: 'muted', style: 'font-size:13px;margin:10px 0 0', text: '暂时没有设置自动起草的话，也可以在「课程 → 用 AI 起草」里，把资料原文粘贴进去手动起草。' })));
  const box = h('div', { class: 'card table-wrap' });
  if (!d.sources.length) box.appendChild(h('div', { class: 'empty', text: '还没有自动起草过的资料。' }));
  else box.appendChild(h('table', null, h('thead', null, h('tr', null, h('th', { text: '资料' }), h('th', { text: '状态' }), h('th', { text: '草稿' }), h('th', { class: 'num', text: '资料修改' }), h('th', { class: 'num', text: '起草时间' }))),
    h('tbody', null, d.sources.map(s => { const l = s.lesson && lessonById(s.lesson); return h('tr', null,
      h('td', null, /^https?:\/\//.test(s.url || '') ? h('a', { href: s.url, target: '_blank', rel: 'noopener', text: s.name }) : h('span', { text: s.name }), s.note ? h('span', { class: 'sub', text: s.note }) : null),
      h('td', null, h('span', { class: { drafted: 'tag ok', skipped: 'tag', error: 'tag bad', new: 'tag warn' }[s.status] || 'tag', text: { drafted: '已起草', skipped: '跳过', error: '出错', new: '待处理' }[s.status] || s.status })),
      h('td', null, l ? h('a', { href: `#/lesson/${l.id}`, text: `${l.title || '草稿'}（${{ draft: '草稿', published: '已发布', archived: '已归档' }[l.status]}）` }) : h('span', { class: 'muted', text: '—' })),
      h('td', { class: 'num muted', text: when(s.modifiedAt) }), h('td', { class: 'num muted', text: when(s.processedAt) })); }))));
  v.appendChild(box);
}

/* ---------- 守护者 ---------- */
function pageGuardians() {
  const v = page('守护者', '教课的动物守护者，除了课里的话，平时说的这些话也可以改。改完员工的屏幕 10 分钟内会更新。');
  for (const g of S.data.guardians) {
    const lines = JSON.parse(JSON.stringify(g.lines || {}));
    if (!Array.isArray(lines.hello)) lines.hello = [];
    const name = h('input', { class: 'input', maxlength: 20, value: g.name });
    const title = h('input', { class: 'input', maxlength: 40, value: g.title });
    const hello = h('div');
    const drawHello = () => {
      hello.textContent = '';
      lines.hello.forEach((x, i) => hello.appendChild(h('div', { class: 'item', style: 'grid-template-columns:150px 1fr auto' },
        h('div', { class: 'row', style: 'flex-wrap:nowrap;gap:4px' },
          h('input', { class: 'input mono', type: 'number', min: 0, max: 29, value: x.from, style: 'padding:9px 6px', oninput: e => { x.from = +e.target.value; } }), '–',
          h('input', { class: 'input mono', type: 'number', min: 1, max: 30, value: x.to, style: 'padding:9px 6px', oninput: e => { x.to = +e.target.value; } }), '点'),
        h('input', { class: 'input', value: x.text, oninput: e => { x.text = e.target.value; } }),
        h('button', { class: 'icon', type: 'button', icon: 'x', title: '删掉', onclick: () => { lines.hello.splice(i, 1); drawHello(); } }))));
      hello.appendChild(h('div', { class: 'row', style: 'margin-top:8px' }, h('button', { class: 'btn small', type: 'button', text: '+ 再加一个时段', onclick: () => { lines.hello.push({ from: 9, to: 12, text: '' }); drawHello(); } })));
    };
    drawHello();
    const fields = LINES.map(([k, label, ph]) => h('div', { class: 'field' }, h('label', { text: label }), h('input', { class: 'input', value: lines[k] || '', placeholder: ph, oninput: e => { lines[k] = e.target.value; } })));
    v.appendChild(h('div', { class: 'card pad', style: 'margin-bottom:16px' },
      h('div', { class: 'grid2' }, h('div', { class: 'field' }, h('label', { text: '名字' }), name), h('div', { class: 'field' }, h('label', { text: '称号' }), title)),
      h('div', { class: 'field', style: 'margin-top:14px' }, h('label', { text: '打招呼（按钟点；过了午夜写成 24 以上，例如 20–29 点是晚上八点到第二天清晨五点）' }), hello),
      h('div', { class: 'grid2', style: 'margin-top:14px' }, fields),
      h('div', { class: 'row end', style: 'margin-top:16px' }, h('button', { class: 'btn primary', type: 'button', text: '保存', onclick: async () => {
        for (const k of Object.keys(lines)) if (typeof lines[k] === 'string' && !lines[k].trim()) delete lines[k];
        lines.hello = lines.hello.filter(x => String(x.text || '').trim());
        const r = await call('admin_save_guardian', { guardian: { id: g.id, name: name.value, title: title.value, lines } });
        if (r.ok) { toast('已保存'); await reload(); route(); } else toast('没能保存', true);
      } }))));
  }
}

/* ---------- 账号 ---------- */
function pageAccount() {
  const d = S.data;
  const v = page('账号', '管理员账号。每位管理员用自己的登录名和密码。');
  const old = h('input', { class: 'input', type: 'password', autocomplete: 'current-password' });
  const nw = h('input', { class: 'input', type: 'password', autocomplete: 'new-password', placeholder: '至少 8 位' });
  const nw2 = h('input', { class: 'input', type: 'password', autocomplete: 'new-password' });
  const msg = h('div', { class: 'msg' });
  v.appendChild(h('div', { class: 'cols' },
    h('div', { class: 'card pad' }, h('h2', { style: 'font-size:16px;margin-bottom:12px', text: '改密码' }), h('div', { class: 'form' },
      h('div', { class: 'field' }, h('label', { text: '现在的密码' }), old),
      h('div', { class: 'grid2' }, h('div', { class: 'field' }, h('label', { text: '新密码' }), nw), h('div', { class: 'field' }, h('label', { text: '再输一次' }), nw2)),
      msg,
      h('div', { class: 'row end' }, h('button', { class: 'btn primary', type: 'button', text: '改密码', onclick: async () => {
        if (nw.value !== nw2.value) { msg.className = 'msg err'; msg.textContent = '两次输入的新密码不一样'; return; }
        const r = await call('admin_password', { old_password: old.value, new_password: nw.value });
        if (r.ok) { msg.className = 'msg ok'; msg.textContent = '密码已经改好'; old.value = nw.value = nw2.value = ''; }
        else { msg.className = 'msg err'; msg.textContent = r.error === 'old' ? '现在的密码不对' : '新密码至少 8 位'; }
      } })))),
    h('div', { class: 'card pad' }, h('h2', { style: 'font-size:16px;margin-bottom:12px', text: '管理员' }),
      h('div', null, d.admins.map(a => h('div', { class: 'row', style: 'justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--line)' }, h('span', null, h('b', { text: a.name }), h('span', { class: 'muted', text: `　${a.login}` })), h('span', { class: 'muted', text: a.lastLogin ? `最近登录 ${when(a.lastLogin)}` : '' })))),
      h('div', { class: 'row', style: 'margin-top:14px' }, h('button', { class: 'btn', type: 'button', text: '邀请另一位管理员', onclick: async () => {
        const r = await call('admin_new_invite', { note: '' });
        if (!r.ok) return;
        dialog('邀请码', '把邀请码和这个页面的地址发给对方。对方在登录页选「第一次使用」，输入邀请码，设好自己的登录名和密码。邀请码 7 天内有效，只能用一次。', h('div', null, h('div', { class: 'code', text: r.code }),
          h('div', { class: 'copyline', style: 'margin-top:12px' }, h('input', { class: 'input', value: location.href.split('#')[0], readonly: true }), h('button', { class: 'btn', type: 'button', text: '复制地址', onclick: () => copy(location.href.split('#')[0], '地址') }))), [{ text: '好', primary: true }]);
      } })))));
}

/* ------------------------------------------------------------------ */
/* Start                                                               */
/* ------------------------------------------------------------------ */
async function start() {
  $('login').hidden = true;
  $('app').hidden = false;
  view().textContent = '';
  view().appendChild(h('div', { class: 'empty' }, h('span', { class: 'spin' }), ' 正在载入…'));
  try { await reload(); } catch (e) { if (e.message !== 'auth') view().textContent = '连不上后台，请检查网络后刷新页面。'; return; }
  route();
}
(function boot() {
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(KEY)); } catch (e) {}
  if (saved && saved.token && Date.now() - saved.at < 12 * 3600e3) { S.token = saved.token; start(); }
  else showLogin('');
  if (/(?:^#|&)invite=/.test(location.hash)) loginTabs(true);
})();
window.__admin = { S, go, reload };
