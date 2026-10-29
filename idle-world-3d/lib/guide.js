// 栖境 — lessons from the worlds' guardians.
//
// An animal that lives in a world (the koi pond's old heron) teaches short lessons the way a game's NPCs do. A board
// lists the guardians and their lessons; picking one, or tapping the guardian where it stands in its world, calls it
// in. The camera closes in on it and it talks, line by line. It asks questions with a few answers to choose from (a
// wrong answer is explained, then the question comes again), shows a card of the key points and, the first time a
// lesson is finished, gives a badge and a new resident for its world. A lesson put down halfway carries on from there.
//
// Two kinds of lessons:
//  - the demo lessons in lessons/index.js, on a screen not connected to the company: progress, stars and badges are
//    kept with the rest of this screen's world;
//  - the company's own lessons, on a screen registered with the learning backend (lib/school.js): whoever learns
//    signs in first (their name, then a 4-digit PIN), and everything goes into their learning record (学习档案),
//    which the board shows them along with the questions they got wrong, to answer again with the guardian.
//
// A world with a guardian describes it in its build() result as `guardian`: { id, state() ('away' | 'leaving' |
// 'coming' | 'ready'), summon(), talk(on), speak(on), react('yes' | 'no' | 'done'), release(), anchor(out) (a point above its
// head), view(yaw) ({ target, yaw, pitch, dist } for the camera), look(out) (the camera's target, every frame),
// rewardAt(out) (where a new resident comes in) }.
import * as THREE from 'three';
import { GUARDIANS, LESSONS } from '../lessons/index.js';

const CANCEL = 'cancel';
// a guardian speaking: characters per second, and the pause after punctuation (seconds)
const CPS = 30;
const PAUSE = { '，': 0.12, '、': 0.12, '：': 0.16, '；': 0.2, '。': 0.32, '！': 0.32, '？': 0.32, '…': 0.2, '—': 0.08 };
// the board or a lesson left open on a screen nobody is using is put away after this long (progress is kept)
const IDLE_CLOSE = 120e3;
const KEYS = 'ABCD';
const EMPTY = { step: 0, done: false, stars: 0, slips: 0 };
const TITLES = { lessons: '守护者的课', who: '你是哪位？', pin: '', me: '我的档案' };
const LEAD = {
  demo: '世界里的动物守护者，会用对话和小题目，教你工作里的门道。选一课开始；在世界里看见它的时候，也可以直接点它。',
  company: '公司的课：世界里的动物守护者，会用对话和小题目，教你工作里的门道。选一课开始；在世界里看见它的时候，也可以直接点它。',
};
// the demo lessons, shaped like the company's (an id and a version each)
const DEMO = { company: false, guardians: GUARDIANS, lessons: {} };
for (const id of Object.keys(LESSONS)) DEMO.lessons[id] = Object.assign({ id, version: 1 }, LESSONS[id]);

export function createGuide(host) {
  const $ = id => document.getElementById(id);
  const el = {
    btn: $('btnLearn'), dot: $('learnDot'), mark: $('guideMark'),
    board: $('board'), sheet: $('boardSheet'), heading: $('boardTitle'), lead: $('boardLead'), meBar: $('meBar'),
    lessons: $('paneLessons'), list: $('boardList'), badges: $('boardBadges'), boardClose: $('boardClose'),
    who: $('paneWho'), pin: $('panePin'), me: $('paneMe'),
    talk: $('talk'), box: $('talkBox'), name: $('talkName'), title: $('talkTitle'), bar: $('talkBar'), text: $('talkText'),
    opts: $('talkOpts'), next: $('talkNext'), close: $('talkClose'),
    banner: $('banner'), bStars: $('bannerStars'), bGifts: $('bannerGifts'),
  };
  // mode: 'closed' | 'board' | 'talk'; pane: what the board shows; sess: the conversation under way; pending: a lesson
  // (or a review) waiting for its world; afterLogin: what to do once someone has signed in
  const S = { mode: 'closed', pane: 'lessons', sess: null, pending: null, afterLogin: null, pin: null, markOn: false, markGid: null, speed: 1 };
  const _anchor = new THREE.Vector3();
  const school = host.school || null;

  /* ---------- what is taught here, and the record of it ---------- */
  /** The lessons on this screen: the company's when it is connected, else the demo ones. */
  const C = () => (school && school.active && school.content()) || DEMO;
  const company = () => C().company;
  const learner = () => (company() && school ? school.who : null);
  function data() {
    const d = host.save();
    if (!d.lessons || typeof d.lessons !== 'object') d.lessons = {};
    if (!Array.isArray(d.badges)) d.badges = [];
    return d;
  }
  function rec(id) { const d = data(); return d.lessons[id] || (d.lessons[id] = { step: 0, done: false, stars: 0 }); }
  // the demo lessons' record: kept with this screen's world
  const localLedger = {
    get: L => data().lessons[L.id] || EMPTY,
    start(L) { const r = rec(L.id); r.step = 0; r.slips = 0; host.markDirty(); },
    step(L, i) { rec(L.id).step = i; host.markDirty(); },
    answer(L, i, choice, correct, first, review) {
      if (first && !correct && !review) { const r = rec(L.id); r.slips = (r.slips || 0) + 1; host.markDirty(); }
    },
    done(L, stars) {
      const r = rec(L.id), d = data(), first = !r.done;
      r.done = true; r.stars = Math.max(r.stars || 0, stars); r.step = 0; r.slips = 0; r.at = Date.now(); r.runs = (r.runs || 0) + 1;
      let badge = null;
      if (L.badge && d.badges.indexOf(L.badge) < 0) { d.badges.push(L.badge); badge = L.badge; }
      host.persist();
      return { first, badge };
    },
    badges: () => data().badges,
    misses: () => [],
  };
  // the company's lessons with nobody signed in: nothing is kept
  const nobody = { get: () => EMPTY, start() {}, step() {}, answer() {}, done: () => ({ first: false, badge: null }), badges: () => [], misses: () => [] };
  const ledger = () => (!company() ? localLedger : learner() ? school.ledger : nobody);
  /** Where someone is in a lesson. A lesson changed since it was begun starts again (its steps are not the ones it was
   *  left at); `updated`: finished before it changed. */
  function prog(L) {
    const p = ledger().get(L) || EMPTY;
    const moved = p.version && p.version !== L.version;
    return { step: moved ? 0 : p.step || 0, done: !!p.done, stars: p.stars || 0, slips: moved ? 0 : p.slips || 0, updated: !!(p.done && p.doneVersion && p.doneVersion < L.version) };
  }
  const guardian = id => C().guardians.find(g => g.id === id) || null;
  const guardianOf = lid => C().guardians.find(g => g.lessons.indexOf(lid) >= 0) || null;
  const lessonsOf = g => g.lessons.map(id => C().lessons[id]).filter(Boolean);
  const unfinished = g => lessonsOf(g).some(L => !prog(L).done);
  /** whether a guardian has something for whoever is here (the company's lessons, before anyone signs in: anything) */
  const waiting = g => (company() && !learner() ? lessonsOf(g).length > 0 : unfinished(g));
  const quizCount = L => L.steps.filter(s => s.ask).length;
  const cardOf = L => { for (let i = L.steps.length - 1; i >= 0; i--) if (L.steps[i].card) return L.steps[i].card; return null; };
  const fill = (t, m) => String(t || '').replace(/\{(\w+)\}/g, (_, k) => (m && m[k] != null ? m[k] : ''));
  /** a line said to the learner by name (the company's lessons) */
  const withName = t => { const w = learner(); return w && t ? `${w.name}，${t}` : t; };
  function worldName(id) { const w = host.worlds.find(x => x.id === id); return w ? `${w.name} · ${w.sub}` : ''; }
  function adapterFor(gid) {
    const w = host.world();
    const a = w && w.inst && w.inst.guardian;
    return a && a.id === gid ? a : null;
  }
  function updateDot() { el.dot.hidden = !(learner() || !company()) || !C().guardians.some(unfinished); }
  /** the questions the learner got wrong and has not answered right since, in lessons still taught here */
  function misses(g) {
    const c = C();
    return ledger().misses().filter(m => {
      const L = c.lessons[m.lesson], st = L && L.steps[m.step];
      return st && st.ask && (!g || g.lessons.indexOf(m.lesson) >= 0);
    });
  }

  /* ---------- small DOM helpers ---------- */
  function node(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }
  function button(cls, text, onClick) {
    const b = node('button', cls, text);
    b.type = 'button';
    b.addEventListener('click', e => { e.stopPropagation(); host.wake(); onClick(e); });
    return b;
  }
  const stars = n => { const f = node('span', 'stars'); f.appendChild(node('b', '', '★'.repeat(n))); f.appendChild(node('i', '', '★'.repeat(3 - n))); return f; };
  /** a round badge with one character of the name: the last of a Chinese name (明 for 小明), the first of a Latin one */
  function avatar(name) {
    const ch = Array.from(String(name || '?').trim() || '?');
    return node('span', 'av', /^[A-Za-z]/.test(ch[0]) ? ch[0].toUpperCase() : ch[ch.length - 1]);
  }
  /** text whose last few characters stay together: a wrapped line never ends with one or two of them alone */
  function keepTail(text, n = 4) {
    const chars = Array.from(String(text)), f = document.createDocumentFragment();
    if (chars.length <= n + 2) { f.appendChild(document.createTextNode(chars.join(''))); return f; }
    f.appendChild(document.createTextNode(chars.slice(0, -n).join('')));
    f.appendChild(node('span', 'nw', chars.slice(-n).join('')));
    return f;
  }
  /** a line's text without the ** marks */
  const plain = t => String(t || '').replace(/\*\*/g, '');
  function renderCard(c) {
    const box = node('div', 'sum');
    box.appendChild(node('h3', '', c.title || '要点'));
    const ol = node('ol');
    for (const it of c.items || []) {
      const li = node('li');
      li.appendChild(node('b', '', it[0]));
      li.appendChild(node('span', '', it[1]));
      ol.appendChild(li);
    }
    box.appendChild(ol);
    return box;
  }
  function fmtTime(sec) {
    const m = Math.round((sec || 0) / 60);
    if (m < 1) return sec > 0 ? '不到 1 分钟' : '0 分钟';
    return m < 60 ? `${m} 分钟` : `${Math.floor(m / 60)} 小时 ${m % 60} 分`;
  }

  /* ---------- the board ---------- */
  function pane(name, title) {
    S.pane = name;
    el.lessons.hidden = name !== 'lessons';
    el.who.hidden = name !== 'who';
    el.pin.hidden = name !== 'pin';
    el.me.hidden = name !== 'me';
    if (name !== 'lessons') el.meBar.hidden = true; // (the lessons pane shows who is learning; the others say it themselves)
    el.heading.textContent = title !== undefined ? title : TITLES[name];
    el.sheet.scrollTop = 0;
    if (name !== 'pin') S.pin = null;
  }
  function renderBoard() {
    const c = C();
    el.lead.textContent = c.company ? LEAD.company : LEAD.demo;
    renderMeBar();
    el.list.textContent = '';
    const here = host.world() ? host.world().meta.id : '';
    for (const g of c.guardians) {
      const sec = node('section', 'gsec');
      const head = node('div', 'gd');
      const pt = node('div', 'pt');
      if (g.portrait) pt.style.backgroundImage = `url("${host.asset(g.portrait)}")`;
      const info = node('div', 'gi');
      info.appendChild(node('div', 'nm', g.name));
      const wn = worldName(g.world);
      info.appendChild(node('div', 'tt', wn ? `${g.title} · 住在${wn}` : g.title));
      head.appendChild(pt); head.appendChild(info);
      sec.appendChild(head);
      for (const L of lessonsOf(g)) sec.appendChild(lessonItem(L, g.world === here));
      el.list.appendChild(sec);
    }
    if (!c.guardians.length) el.list.appendChild(node('p', 'empty', '这里还没有发布的课。管理员发布以后，会出现在这里。'));
    el.badges.textContent = '';
    const have = ledger().badges();
    for (const g of c.guardians) for (const L of lessonsOf(g)) {
      if (!L.badge) continue;
      const got = have.indexOf(L.badge) >= 0;
      const seal = node('div', got ? 'seal' : 'seal no', got ? L.badge : '？');
      seal.title = got ? `${L.badge}（学会「${L.title}」）` : `学会「${L.title}」可得`;
      el.badges.appendChild(seal);
    }
    el.badges.parentNode.hidden = !el.badges.children.length;
  }
  /** who is learning (the company's lessons): sign in, or the learner with their record and a way out */
  function renderMeBar() {
    el.meBar.textContent = '';
    if (!company()) { el.meBar.hidden = true; return; }
    el.meBar.hidden = false;
    const w = learner();
    if (!w) {
      const t = node('div', 'mb-t');
      t.appendChild(node('b', '', '还没登录'));
      t.appendChild(node('span', '', '登录后，学到哪里、得了几颗星，都会存进你的个人档案'));
      el.meBar.appendChild(t);
      el.meBar.appendChild(button('pill primary', '登录', () => needWho(null)));
      return;
    }
    const t = node('div', 'mb-t me');
    t.appendChild(avatar(w.name));
    const nm = node('div', 'mb-n');
    nm.appendChild(node('b', '', w.name));
    if (w.dept) nm.appendChild(node('span', '', w.dept));
    t.appendChild(nm);
    el.meBar.appendChild(t);
    const acts = node('div', 'mb-a');
    acts.appendChild(button('pill ghost glass', '我的档案', () => openMe()));
    acts.appendChild(button('link', '退出', () => { school.logout(); host.toast(`${w.name} 已退出登录`); }));
    el.meBar.appendChild(acts);
  }
  function lessonItem(L, here) {
    const r = prog(L);
    const box = node('article', r.done ? 'ls done' : 'ls');
    const tl = node('div', 'tl');
    tl.appendChild(node('span', '', L.title));
    if (L.demo) tl.appendChild(node('span', 'tag', '示范'));
    if (r.updated) tl.appendChild(node('span', 'tag new', '有更新'));
    box.appendChild(tl);
    if (L.keys) box.appendChild(node('div', 'ky', L.keys));
    if (L.about) box.appendChild(node('div', 'ab', L.about));
    const meta = [];
    if (L.minutes) meta.push(`约 ${L.minutes} 分钟`);
    const n = quizCount(L);
    if (n) meta.push(`${n} 道题`);
    const gifts = [];
    if (L.badge) gifts.push(`徽章「${L.badge}」`);
    if (L.reward && L.reward.name) gifts.push(`${L.reward.what || ''}「${L.reward.name}」`);
    if (gifts.length) meta.push('奖励 ' + gifts.join('、'));
    box.appendChild(node('div', 'mt', meta.join(' · ')));
    const row = node('div', 'row');
    const st = node('div', 'st');
    if (r.done) { st.appendChild(node('span', '', '已学会 ')); st.appendChild(stars(Math.max(1, Math.min(3, r.stars || 1)))); }
    else st.textContent = r.step > 0 ? `学到一半（${Math.round(100 * r.step / L.steps.length)}%）` : '还没学';
    const bt = node('div', 'bt');
    const card = cardOf(L);
    let shown = null;
    if (r.done && card) {
      const k = button('pill ghost glass', '要点', () => {
        if (shown) { shown.remove(); shown = null; k.setAttribute('aria-expanded', 'false'); return; }
        shown = renderCard(card);
        box.appendChild(shown);
        k.setAttribute('aria-expanded', 'true');
      });
      bt.appendChild(k);
    }
    bt.appendChild(button('pill primary', r.done ? '重温' : r.step > 0 ? '继续' : here ? '开始' : '前往学习', () => startLesson(L.id)));
    row.appendChild(st); row.appendChild(bt);
    box.appendChild(row);
    return box;
  }
  function openBoard() {
    if (S.mode === 'talk') return;
    renderBoard();
    pane('lessons');
    S.mode = 'board';
    el.board.classList.add('open');
    el.board.setAttribute('aria-hidden', 'false');
    if (learner() && school.stale) school.check();
  }
  function closeBoard() {
    if (S.mode !== 'board') return;
    S.mode = 'closed';
    S.pin = null;
    el.board.classList.remove('open');
    el.board.setAttribute('aria-hidden', 'true');
  }
  function showLessons() { renderBoard(); pane('lessons'); }
  /** From the board: talk with the lesson's guardian, going to its world first if it lives in another. */
  function startLesson(lid) {
    const g = guardianOf(lid);
    if (!g || !C().lessons[lid]) return;
    if (company() && !learner()) { needWho({ lesson: lid }); return; }
    closeBoard();
    if (!goTo(g, { gid: g.id, lid })) return;
    openTalk(g, lid);
  }
  /** Be in the guardian's world: true when already there (else it is on its way, and `pending` starts it there). */
  function goTo(g, pending) {
    const w = host.world();
    if (w && w.meta.id === g.world) return true;
    if (!host.worlds.some(x => x.id === g.world)) return true; // a guardian of no world here: it talks without the close-up
    if (!host.loading()) { S.pending = pending; host.enterWorld(g.world); }
    return false;
  }

  /* ---------- signing in (the company's lessons) ---------- */
  /** Someone has to sign in first: the names, then whatever was asked for. */
  function needWho(action) {
    S.afterLogin = action;
    if (S.mode === 'talk') closeTalk(false);
    if (S.mode !== 'board') openBoard();
    renderWho();
  }
  function renderWho() {
    pane('who');
    el.who.textContent = '';
    // by department, then name, in pinyin order (as people look for them)
    const zh = (a, b) => String(a || '').localeCompare(String(b || ''), 'zh-CN');
    const staff = (school ? school.staff : []).slice().sort((a, b) => zh(a.dept, b.dept) || zh(a.name, b.name));
    el.who.appendChild(node('p', 'lead', staff.length ? '点你的名字，再输入 4 位密码。' : '还没有员工名单：请管理员在管理页面里添加员工。'));
    const groups = node('div', 'who-groups');
    const draw = q => {
      groups.textContent = '';
      let dept = null, grid = null, n = 0;
      for (const p of staff) {
        if (q && p.name.indexOf(q) < 0 && (p.dept || '').indexOf(q) < 0) continue;
        if (!grid || p.dept !== dept) {
          dept = p.dept;
          if (dept) groups.appendChild(node('div', 'dh', dept));
          grid = groups.appendChild(node('div', 'names'));
        }
        const b = button('nm-btn', '', () => renderPin(p));
        b.appendChild(avatar(p.name));
        b.appendChild(node('span', 'n', p.name));
        grid.appendChild(b);
        n++;
      }
      if (!n && q) groups.appendChild(node('p', 'empty', `没有找到「${q}」`));
    };
    if (staff.length > 16) {
      const f = node('input', 'field find');
      f.type = 'search'; f.placeholder = '找名字或部门'; f.setAttribute('aria-label', '找名字或部门');
      f.addEventListener('input', () => { host.wake(); draw(f.value.trim()); });
      el.who.appendChild(f);
    }
    draw('');
    el.who.appendChild(groups);
    const back = node('div', 'pane-foot');
    back.appendChild(button('link', '返回课程', () => { S.afterLogin = null; showLessons(); }));
    el.who.appendChild(back);
  }
  function renderPin(p) {
    pane('pin', p.name);
    el.pin.textContent = '';
    const P = S.pin = { who: p, digits: '', busy: false };
    if (p.dept) el.pin.appendChild(node('div', 'pin-dept', p.dept));
    el.pin.appendChild(node('p', 'lead pin-lead', '输入你的 4 位密码'));
    P.dots = node('div', 'dots');
    for (let i = 0; i < 4; i++) P.dots.appendChild(node('i'));
    el.pin.appendChild(P.dots);
    P.msg = node('div', 'pin-msg');
    P.msg.setAttribute('aria-live', 'polite');
    el.pin.appendChild(P.msg);
    const pad = node('div', 'pad');
    for (const k of ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'del']) {
      if (!k) { pad.appendChild(node('span')); continue; }
      const b = button(k === 'del' ? 'k del' : 'k', k === 'del' ? '' : k, () => (k === 'del' ? pinBack() : pinDigit(k)));
      if (k === 'del') { b.setAttribute('aria-label', '删除'); b.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6h11v12H9l-5-6z"/><path d="M12.5 9.5l5 5M17.5 9.5l-5 5"/></svg>'; }
      pad.appendChild(b);
    }
    el.pin.appendChild(pad);
    const foot = node('div', 'pane-foot');
    foot.appendChild(button('link', '不是我，返回', () => renderWho()));
    el.pin.appendChild(foot);
  }
  function pinShow() {
    const P = S.pin;
    if (!P) return;
    Array.prototype.forEach.call(P.dots.children, (d, i) => d.classList.toggle('on', i < P.digits.length));
  }
  function pinDigit(d) {
    const P = S.pin;
    if (!P || P.busy || P.digits.length >= 4) return;
    P.digits += d;
    P.msg.textContent = ''; P.msg.className = 'pin-msg';
    pinShow();
    if (P.digits.length === 4) pinSubmit(P);
  }
  function pinBack() {
    const P = S.pin;
    if (!P || P.busy) return;
    P.digits = P.digits.slice(0, -1);
    pinShow();
  }
  async function pinSubmit(P) {
    P.busy = true;
    P.msg.textContent = '正在核对…';
    P.dots.classList.add('busy');
    const r = await school.login(P.who, P.digits);
    if (S.pin !== P) return; // (the board was put away meanwhile)
    P.busy = false;
    P.dots.classList.remove('busy');
    if (r.ok) {
      S.pin = null;
      host.toast(`欢迎，${learner() ? learner().name : P.who.name}`);
      afterLogin();
      return;
    }
    P.digits = '';
    pinShow();
    P.dots.classList.remove('shake');
    void P.dots.offsetWidth; // (restarts the shake)
    P.dots.classList.add('shake');
    P.msg.className = 'pin-msg err';
    const left = r.left, mins = Math.max(1, Math.ceil((r.wait || 900) / 60));
    P.msg.textContent = r.error === 'pin' ? (left > 1 ? `密码不对，还可以再试 ${left} 次` : '密码不对。再错一次，这个名字要等 15 分钟才能登录')
      : r.error === 'locked' ? `输错太多次了，请 ${mins} 分钟后再试，或请管理员解锁`
      : r.error === 'busy' ? '这台设备刚才输错太多次，请过几分钟再试'
      : r.error === 'who' ? '名单有变动，请重新选你的名字'
      : r.error === 'net' ? '连不上网络，请检查网络后再试'
      : '暂时登录不了，请稍后再试';
    if (r.error === 'who') setTimeout(() => { if (S.pin === P) renderWho(); }, 1500);
  }
  function afterLogin() {
    const a = S.afterLogin;
    S.afterLogin = null;
    if (a && a.lesson && C().lessons[a.lesson]) { startLesson(a.lesson); return; }
    if (a && a.talk && guardian(a.talk)) { closeBoard(); openTalk(guardian(a.talk), null); return; }
    showLessons();
  }

  /* ---------- the learning record (学习档案) ---------- */
  function openMe() { renderMe(); if (school.stale) school.check(); }
  function renderMe() {
    const w = learner(), a = w && school.archive();
    if (!w || !a) { showLessons(); return; }
    const top = S.pane === 'me' ? el.sheet.scrollTop : 0;
    pane('me');
    el.me.textContent = '';
    const c = C(), all = [];
    for (const g of c.guardians) for (const L of lessonsOf(g)) all.push(L);
    const head = node('div', 'me-head');
    head.appendChild(avatar(w.name));
    const nm = node('div', 'mb-n');
    nm.appendChild(node('b', '', w.name));
    if (w.dept) nm.appendChild(node('span', '', w.dept));
    head.appendChild(nm);
    el.me.appendChild(head);
    // the figures
    const done = all.filter(L => prog(L).done);
    let starSum = 0, secs = 0;
    for (const L of done) starSum += prog(L).stars;
    for (const k of Object.keys(a.progress)) secs += a.progress[k].seconds || 0;
    const tiles = node('div', 'tiles');
    const tile = (v, k) => { const t = node('div', 'tile'); t.appendChild(node('b', '', v)); t.appendChild(node('span', '', k)); tiles.appendChild(t); };
    tile(`${done.length} / ${all.length}`, '已学会的课');
    tile(`★ ${starSum}`, '星星');
    tile(a.answered ? `${Math.round(100 * a.right / a.answered)}%` : '—', '第一次就答对');
    tile(fmtTime(secs), '学习时长');
    el.me.appendChild(tiles);
    // the wrong answers, to answer again
    const ms = misses(null);
    const sec = node('section', 'me-sec');
    sec.appendChild(node('h3', '', ms.length ? `错题回顾 · ${ms.length} 题` : '错题回顾'));
    if (!ms.length) sec.appendChild(node('p', 'empty', '没有要回顾的错题。答错的题会留在这里，答对一次就会消失。'));
    for (const m of ms.slice(0, 30)) {
      const L = c.lessons[m.lesson], st = L.steps[m.step];
      const it = node('div', 'miss');
      it.appendChild(node('div', 'mt', L.title));
      it.appendChild(node('div', 'q')).appendChild(keepTail(plain(st.ask), 3));
      const o = st.options[m.choice];
      if (o) { const p = node('div', 'was'); p.appendChild(document.createTextNode('当时选了：')); p.appendChild(node('s', '', plain(o.text))); it.appendChild(p); }
      const r = node('div', 'row');
      r.appendChild(button('pill ghost glass', '再答一次', () => startReview([m])));
      it.appendChild(r);
      sec.appendChild(it);
    }
    if (ms.length > 1) { const r = node('div', 'row all'); r.appendChild(button('pill primary', `全部复习（${ms.length} 题）`, () => startReview(ms))); sec.appendChild(r); }
    el.me.appendChild(sec);
    // the lessons
    const ls = node('section', 'me-sec');
    ls.appendChild(node('h3', '', '课程'));
    for (const L of all) {
      const r = prog(L), row = node('div', 'me-ls');
      row.appendChild(node('span', 'tl', L.title));
      const s = node('span', 'st');
      if (r.done) { s.appendChild(stars(Math.max(1, Math.min(3, r.stars || 1)))); if (r.updated) s.appendChild(node('span', 'tag new', '有更新')); }
      else s.textContent = r.step > 0 ? `学到一半（${Math.round(100 * r.step / L.steps.length)}%）` : '还没学';
      row.appendChild(s);
      ls.appendChild(row);
    }
    el.me.appendChild(ls);
    // badges
    const bs = node('section', 'me-sec');
    bs.appendChild(node('h3', '', '徽章'));
    const list = node('div', 'list');
    for (const L of all) if (L.badge) {
      const got = a.badges.indexOf(L.badge) >= 0;
      const seal = node('div', got ? 'seal' : 'seal no', got ? L.badge : '？');
      seal.title = got ? `${L.badge}（学会「${L.title}」）` : `学会「${L.title}」可得`;
      list.appendChild(seal);
    }
    if (list.children.length) { bs.appendChild(list); el.me.appendChild(bs); }
    const foot = node('div', 'pane-foot');
    foot.appendChild(button('link', '返回课程', () => showLessons()));
    el.me.appendChild(foot);
    el.sheet.scrollTop = top;
  }
  /** Answer again, with their guardian, the questions got wrong (those of the first one's guardian). */
  function startReview(items) {
    const g = items.length ? guardianOf(items[0].lesson) : null;
    if (!g) return;
    const mine = items.filter(m => g.lessons.indexOf(m.lesson) >= 0);
    closeBoard();
    if (!goTo(g, { gid: g.id, review: mine })) return;
    openTalk(g, null, mine);
  }

  /* ---------- the conversation ---------- */
  function openTalk(g, lid, review) {
    if (company() && !learner()) { needWho(lid ? { lesson: lid } : { talk: g.id }); return; }
    if (S.mode === 'board') closeBoard();
    if (S.sess) closeTalk(false);
    const a = adapterFor(g.id);
    const L = lid ? C().lessons[lid] : null;
    const s = S.sess = { g, adapter: a, lid: L ? lid : null, lesson: L, review: review || null, slips: 0, closed: false, started: false, finished: false, line: null, after: null, wake: null, view: null };
    S.mode = 'talk';
    el.name.textContent = g.name;
    el.title.textContent = g.title;
    el.text.textContent = '';
    clearOpts(); showNext(false); progress(0);
    document.body.classList.add('talking');
    el.talk.classList.remove('dim');
    el.talk.classList.add('open');
    el.talk.setAttribute('aria-hidden', 'false');
    if (a) a.talk(true); // (calls it in when it is not here)
    if (learner() && school.stale) school.check();
    run(s);
  }
  function closeTalk(saved) {
    const s = S.sess;
    if (!s) return;
    s.closed = true;
    const w = s.wake;
    s.wake = null;
    if (s.adapter) { s.adapter.speak(false); s.adapter.talk(false); s.adapter.release(); }
    host.focus(null);
    S.sess = null; S.mode = 'closed';
    el.talk.classList.remove('open');
    el.talk.classList.remove('dim');
    el.talk.setAttribute('aria-hidden', 'true');
    el.banner.classList.remove('show');
    document.body.classList.remove('talking');
    if (saved && s.lid && s.started && !s.finished) host.toast(learner() ? '进度已存进你的档案，下次接着学' : '进度已保存，下次接着学');
    host.markDirty();
    updateDot();
    if (w) w(CANCEL);
  }
  async function run(s) {
    const a = s.adapter;
    if (a && a.state() !== 'ready') {
      // it flies in (or, called just as it took off, comes round again): the camera stays as it was until it has landed
      startLine((a.state() === 'leaving' && s.g.returning) || s.g.coming || '……', { voice: false, after: null });
      if (await waitFor(s, () => a.state() === 'ready', 60) === CANCEL) return;
    }
    // (should it still not have come, the lesson goes on without the camera closing in)
    if (a && a.state() === 'ready') {
      s.view = a.view(host.rigYaw());
      host.focus(s.view);
      if (await waitFor(s, null, 0.35) === CANCEL) return;
    }
    if (s.review) await reviewFlow(s);
    else if (s.lesson) await lessonFlow(s, true);
    else await menuFlow(s);
    if (!s.closed) closeTalk(false);
  }
  function greeting(g) {
    const h = host.hours();
    for (const x of g.hello || []) if ((h >= x.from && h < x.to) || (h + 24 >= x.from && h + 24 < x.to)) return x.text;
    return '想学点什么？';
  }
  async function menuFlow(s) {
    const g = s.g, ls = lessonsOf(g), ms = misses(g);
    const opts = ls.map(L => {
      const r = prog(L);
      return { text: L.title + (r.done ? '（已学会）' : r.step > 0 ? '（学到一半）' : '') };
    });
    if (ms.length) opts.push({ text: `把答错的题再练一遍（${ms.length} 题）` });
    opts.push({ text: g.later || '下次再说' });
    const i = await question(withName(unfinished(g) ? greeting(g) : g.allDone || greeting(g)), opts, false);
    if (i === CANCEL) return;
    if (ms.length && i === ls.length) { s.review = ms; await reviewFlow(s); return; }
    if (i >= ls.length) { await say(g.bye || '好。'); return; }
    s.lesson = ls[i]; s.lid = s.lesson.id;
    await lessonFlow(s, false);
  }
  async function lessonFlow(s, direct) {
    const L = s.lesson, led = ledger(), r = prog(L);
    let from = r.done ? 0 : r.step || 0;
    if (from >= L.steps.length) from = 0;
    s.slips = from === 0 ? 0 : r.slips;
    if (from === 0) led.start(L);
    s.started = true;
    const open = from > 0 ? s.g.resume : direct ? s.g.start : '';
    if (open && await say(direct ? withName(open) : open) === CANCEL) return;
    for (let i = from; i < L.steps.length; i++) {
      if (i > from) led.step(L, i);
      progress(i / L.steps.length);
      const st = L.steps[i];
      let res = null;
      if (st.say) res = await say(st.say);
      else if (st.ask) res = await ask(st, L, i, false);
      else if (st.card) res = await card(st.card);
      if (res === CANCEL || s.closed) return;
    }
    progress(1);
    s.finished = true;
    await complete(s);
  }
  /** The questions got wrong, asked again (an answer here counts for the wrong-answer list, not for any lesson's stars). */
  async function reviewFlow(s) {
    const g = s.g, items = s.review;
    if (await say(withName(g.review || '我们把上次没答对的题，再过一遍。')) === CANCEL) return;
    for (let k = 0; k < items.length; k++) {
      const L = C().lessons[items[k].lesson], st = L && L.steps[items[k].step];
      if (!st || !st.ask) continue;
      progress(k / items.length);
      s.lid = null; s.lesson = L;
      if (await ask(st, L, items[k].step, true) === CANCEL || s.closed) return;
    }
    progress(1);
    s.finished = true;
    react('done');
    host.sfx('chime');
    await say(g.reviewDone || '都答对了。记住了，这些就是你的了。');
  }
  async function ask(step, L, index, review) {
    const s = S.sess;
    const options = step.options.map(o => ({ text: o.text, ok: !!o.ok, reply: o.reply, off: false }));
    let again = false;
    for (;;) {
      const i = await question(step.ask, options, again);
      if (i === CANCEL) return CANCEL;
      const o = options[i];
      ledger().answer(L, index, i, o.ok, !again, review);
      markPick(i, o.ok);
      react(o.ok ? 'yes' : 'no');
      if (o.ok) { host.sfx('chime'); return say(o.reply || '对。', { keep: true }); }
      if (!again && !review && s) s.slips = (s.slips || 0) + 1;
      o.off = true; again = true;
      if (await say(o.reply || '再想想。', { keep: true }) === CANCEL) return CANCEL;
    }
  }
  async function complete(s) {
    const L = s.lesson, g = s.g, n = quizCount(L), slips = s.slips || 0;
    const got = slips === 0 ? 3 : slips <= n / 2 ? 2 : 1;
    const res = ledger().done(L, got);
    const gifts = [];
    if (res.badge) gifts.push(`徽章「${res.badge}」`);
    // the new resident comes in now (a splash in front of the guardian), so closing early never loses it
    let m = null;
    if (res.first && L.reward && L.reward.kind) {
      m = host.grant(L.reward.kind, L.reward.name, s.adapter && s.adapter.rewardAt ? s.adapter.rewardAt(new THREE.Vector3()) : null);
      if (m) { gifts.push(`${L.reward.what || ''}「${m.name}」`); if (s.adapter && s.adapter.welcome) s.adapter.welcome(m); }
    }
    host.persist();
    updateDot();
    react('done');
    host.sfx('chime');
    if (await banner(got, gifts.length ? '获得　' + gifts.join('　·　') : '') === CANCEL) return;
    if (m && g.gift && await say(fill(g.gift, { what: L.reward.what || '', name: m.name })) === CANCEL) return;
    if (L.outro) await say(L.outro);
  }
  function react(kind) { const s = S.sess; if (s && s.adapter) s.adapter.react(kind); }

  /* ---------- lines, choices, the card and the banner ---------- */
  function renderText(text, narr) {
    el.text.className = narr ? 'text narr' : 'text';
    el.text.textContent = '';
    const frag = document.createDocumentFragment(), spans = [];
    String(text).split('**').forEach((part, i) => {
      const parent = i % 2 ? frag.appendChild(node('b')) : frag;
      for (const ch of Array.from(part)) {
        if (ch === '\n') { parent.appendChild(node('br')); continue; }
        const sp = node('span', 'h', ch);
        parent.appendChild(sp);
        spans.push(sp);
      }
    });
    // the last few characters stay together, so a wrapped line never ends with one or two of them alone
    const tail = spans.slice(-4);
    if (spans.length > 8 && tail.every(sp => sp.parentNode === tail[0].parentNode)) {
      const nw = node('span', 'nw');
      tail[0].parentNode.insertBefore(nw, tail[0]);
      for (const sp of tail) nw.appendChild(sp);
    }
    el.text.appendChild(frag);
    return spans;
  }
  /** Show a line: typed out (spoken by the guardian, or narration), then `after`: 'next' (tap to go on), 'opts' (the
   *  choices appear) or nothing. */
  function startLine(text, { voice = true, after = 'next', keep = false, instant = false } = {}) {
    const s = S.sess;
    if (!keep) clearOpts();
    // a question keeps its text close above its choices (an answer's reply too, above the answer)
    if (after === 'opts') el.box.classList.add('ask'); else if (!keep) el.box.classList.remove('ask');
    showNext(false);
    s.line = { spans: renderText(text, !voice), shown: 0, acc: 0, hold: 0.15, done: false, voice };
    s.after = after;
    if (voice && s.adapter) s.adapter.speak(true);
    if (instant || S.speed >= 1000) finishLine();
  }
  function finishLine() {
    const s = S.sess, L = s && s.line;
    if (!L || L.done) return;
    for (let i = L.shown; i < L.spans.length; i++) L.spans[i].className = '';
    L.shown = L.spans.length;
    L.done = true;
    if (L.voice && s.adapter) s.adapter.speak(false);
    if (s.after === 'next') showNext(true);
    else if (s.after === 'opts') renderOpts(s.options);
  }
  function say(text, opt) {
    const s = S.sess;
    if (!s || s.closed) return Promise.resolve(CANCEL);
    return new Promise(res => { s.wake = res; startLine(text, opt); });
  }
  function question(text, options, instant) {
    const s = S.sess;
    if (!s || s.closed) return Promise.resolve(CANCEL);
    return new Promise(res => { s.wake = res; s.options = options; startLine(text, { after: 'opts', instant }); });
  }
  function waitFor(s, cond, secs) {
    if (s.closed) return Promise.resolve(CANCEL);
    return new Promise(res => { s.wake = res; s.waitCond = cond; s.waitT = secs; s.after = 'wait'; });
  }
  function card(c) {
    const s = S.sess;
    if (!s || s.closed) return Promise.resolve(CANCEL);
    return new Promise(res => {
      s.wake = res; s.line = null; s.after = 'card';
      showNext(false); clearOpts();
      el.box.classList.remove('ask');
      el.text.className = 'text keypts';
      el.text.textContent = '';
      el.text.appendChild(renderCard(c));
      el.opts.appendChild(button('pill primary got', '记住了', () => advance()));
      el.opts.hidden = false;
    });
  }
  function banner(n, gifts) {
    const s = S.sess;
    if (!s || s.closed) return Promise.resolve(CANCEL);
    el.bStars.textContent = '';
    el.bStars.appendChild(stars(n));
    el.bGifts.textContent = gifts;
    el.bGifts.hidden = !gifts;
    el.banner.classList.add('show');
    el.talk.classList.add('dim');
    return new Promise(res => { s.wake = res; s.after = 'banner'; s.bannerT = 3.6; s.line = null; showNext(false); clearOpts(); el.text.textContent = ''; })
      .then(v => { el.banner.classList.remove('show'); el.talk.classList.remove('dim'); return v; });
  }
  function renderOpts(options) {
    clearOpts();
    options.forEach((o, i) => {
      const b = button('opt', undefined, () => choose(i));
      b.disabled = !!o.off;
      b.appendChild(node('span', 'k', KEYS[i] || String(i + 1)));
      b.appendChild(node('span', 'tx')).appendChild(keepTail(o.text, 3));
      el.opts.appendChild(b);
    });
    el.opts.hidden = false;
  }
  function markPick(i, ok) {
    Array.prototype.forEach.call(el.opts.children, (b, j) => {
      if (j === i) { b.classList.add(ok ? 'ok' : 'no'); b.disabled = true; } else b.hidden = true;
    });
  }
  function clearOpts() { el.opts.textContent = ''; el.opts.hidden = true; }
  function showNext(on) { el.next.classList.toggle('on', !!on); }
  function progress(f) { el.bar.style.width = (Math.max(0, Math.min(1, f)) * 100).toFixed(1) + '%'; }
  function choose(i) {
    const s = S.sess;
    if (!s || s.after !== 'opts' || !s.line || !s.line.done) return false;
    const o = s.options[i];
    if (!o || o.off) return false;
    s.after = null;
    const w = s.wake;
    s.wake = null;
    if (w) w(i);
    return true;
  }
  /** A tap, Space or Enter: finish the line being typed, or go on. */
  function advance() {
    const s = S.sess;
    if (!s) return;
    if (s.line && !s.line.done) { finishLine(); return; }
    if (s.after === 'next' || s.after === 'card' || (s.after === 'banner' && s.bannerT < 2.8)) wakeUp(s);
  }
  function wakeUp(s, v) { s.after = null; const w = s.wake; s.wake = null; if (w) w(v); }

  /* ---------- every frame ---------- */
  function tick(dt) {
    if (S.mode !== 'closed' && performance.now() - host.lastInput() > IDLE_CLOSE) {
      if (S.mode === 'board') closeBoard(); else closeTalk(true);
    }
    const s = S.sess;
    if (s) {
      if (s.view && s.adapter) s.adapter.look(s.view.target);
      const L = s.line;
      if (L && !L.done) {
        L.hold -= dt;
        if (L.hold <= 0) {
          L.acc += dt * CPS * S.speed;
          while (L.acc >= 1 && L.shown < L.spans.length) {
            const sp = L.spans[L.shown++];
            sp.className = '';
            L.acc -= 1;
            const p = PAUSE[sp.textContent];
            if (p && L.shown < L.spans.length) { L.hold = p / S.speed; L.acc = 0; break; }
          }
          if (L.shown >= L.spans.length) finishLine();
        }
      }
      if (s.after === 'wait') {
        s.waitT -= dt;
        if ((s.waitCond && s.waitCond()) || s.waitT <= 0) wakeUp(s);
      } else if (s.after === 'banner') {
        s.bannerT -= dt;
        if (s.bannerT <= 0) wakeUp(s);
      }
    }
    updateMark();
  }
  /** The marker over a guardian standing in the world with lessons for whoever is here (only while the HUD is up). */
  function updateMark() {
    const w = host.world(), a = w && w.inst && w.inst.guardian;
    let on = false;
    if (a && S.mode === 'closed' && !host.idle() && a.state() === 'ready') {
      const g = guardian(a.id);
      const p = g && waiting(g) ? host.toScreen(a.anchor(_anchor)) : null;
      if (p && p.x > 24 && p.x < innerWidth - 24 && p.y > 60 && p.y < innerHeight - 40) {
        on = true;
        S.markGid = g.id;
        el.mark.style.transform = `translate3d(${p.x.toFixed(1)}px,${p.y.toFixed(1)}px,0)`;
      }
    }
    if (on !== S.markOn) {
      S.markOn = on;
      el.mark.classList.toggle('on', on);
      const d = data();
      if (on && !d.guideHinted) { d.guideHinted = true; host.markDirty(); host.toast(`${guardian(S.markGid).name}来了 · 点它，可以跟它学东西`); }
    }
  }
  /** The company's lessons, the learner or their record changed (lib/school.js). */
  function onSchool(what) {
    if (what === 'expired') host.toast('登录已过期，请重新登录');
    else if (what === 'revoked') host.toast('这台设备已从公司学习里移除，现在显示示范课');
    // a lesson under way belongs to someone who is no longer here, or to lessons no longer on this screen
    const s = S.sess;
    if (s && (s.lid || s.review) && (what === 'who' || what === 'signout' || what === 'expired' || what === 'revoked' || what === 'device')) closeTalk(true);
    if (S.mode === 'board') {
      if (what === 'archive') { if (S.pane === 'me') renderMe(); else if (S.pane === 'lessons') renderBoard(); }
      else if (S.pane === 'lessons' && company()) renderBoard(); // (in place: someone reading the board keeps their place)
      else if (S.pane === 'lessons' || (S.pane === 'me' && !learner()) || !company()) showLessons();
      else if (S.pane === 'me') renderMe();
      else if (S.pane === 'who' && what === 'content') renderWho();
    }
    updateDot();
  }

  /* ---------- input ---------- */
  /** A tap on the world: goes on with the conversation, or talks with a guardian that was tapped. */
  function tap(x, y) {
    if (S.mode === 'talk') { advance(); return true; }
    if (S.mode !== 'closed') return true;
    const c = host.pick(x, y);
    const g = c && c.guardian ? guardian(c.guardian) : null;
    if (g) { openTalk(g, null); return true; }
    return false;
  }
  function key(e) {
    if (S.mode === 'board') {
      if (S.pane === 'pin') {
        if (/^[0-9]$/.test(e.key)) { pinDigit(e.key); return true; }
        if (e.key === 'Backspace') { pinBack(); return true; }
        if (e.key === 'Escape') { renderWho(); return true; }
        return true;
      }
      if (e.key === 'Escape') { if (S.pane !== 'lessons') { S.afterLogin = null; showLessons(); } else closeBoard(); return true; }
      return /^[0-9 ]$/.test(e.key); // the board is in front: no world switching or feeding behind it
    }
    if (S.mode !== 'talk') return false;
    if (e.key === 'Escape') { closeTalk(true); return true; }
    if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); advance(); return true; }
    const k = e.key.length === 1 ? e.key.toLowerCase() : '';
    const i = k ? '1234'.indexOf(k) >= 0 ? '1234'.indexOf(k) : 'abcd'.indexOf(k) : -1;
    if (i >= 0) { choose(i); return true; }
    return /^[0-9]$/.test(e.key);
  }

  el.btn.addEventListener('click', () => { host.wake(); if (S.mode === 'board') closeBoard(); else openBoard(); });
  el.boardClose.addEventListener('click', () => { host.wake(); closeBoard(); });
  el.board.addEventListener('click', e => { if (e.target === el.board) closeBoard(); });
  el.talk.addEventListener('click', () => { host.wake(); advance(); });
  el.close.addEventListener('click', e => { e.stopPropagation(); host.wake(); closeTalk(true); });
  el.mark.addEventListener('click', () => { host.wake(); const g = guardian(S.markGid); if (g && S.mode === 'closed') openTalk(g, null); });
  updateDot();

  return {
    tick, tap, key, onSchool,
    get open() { return S.mode !== 'closed'; },
    get talking() { return S.mode === 'talk'; },
    /** name and title of a guardian (the hover label) */
    who: id => guardian(id),
    /** before a world is put away: end any conversation in it (progress is kept) */
    leaveWorld() { if (S.mode === 'talk') closeTalk(true); el.mark.classList.remove('on'); S.markOn = false; },
    /** once a world is up: a lesson (or a review) picked on the board for it starts now */
    worldReady() {
      const p = S.pending, w = host.world();
      S.pending = null;
      const g = p && guardian(p.gid);
      if (g && w && w.meta.id === g.world) openTalk(g, p.lid || null, p.review || null);
    },
    // test hooks (tools/qa/lesson.cjs, tools/qa/school.cjs)
    test: {
      state() {
        const s = S.sess, a = company() && learner() ? school.archive() : null;
        return {
          mode: S.mode, pane: S.pane, company: company(), learner: learner() ? learner().name : null,
          lesson: s ? s.lid : null, review: !!(s && s.review), after: s ? s.after : null, typing: !!(s && s.line && !s.line.done),
          text: el.text.textContent, options: Array.prototype.map.call(el.opts.querySelectorAll('.opt'), b => ({ text: b.textContent, off: b.disabled, hidden: b.hidden })),
          guardian: s && s.adapter ? s.adapter.state() : null, mark: S.markOn,
          saved: JSON.parse(JSON.stringify(company() ? (a ? a.progress : {}) : data().lessons)), badges: ledger().badges().slice(),
          misses: a ? a.misses.length : 0,
        };
      },
      speed(v) { S.speed = v; },
      openBoard, closeBoard, start: startLesson, talk: gid => openTalk(guardian(gid), null),
      next: advance, pick: choose, close: () => closeTalk(true),
      lessons: () => Object.keys(C().lessons).map(id => ({ id, title: C().lessons[id].title })),
    },
  };
}
