// 栖境 — lessons from the worlds' guardians (the content is in lessons/index.js).
//
// An animal that lives in a world (the koi pond's old heron) teaches short lessons the way a game's NPCs do. A board
// lists the guardians and their lessons; picking one, or tapping the guardian where it stands in its world, calls it
// in. The camera closes in on it and it talks, line by line. It asks questions with a few answers to choose from (a
// wrong answer is explained, then the question comes again), shows a card of the key points and, the first time a
// lesson is finished, gives a badge and a new resident for its world. Progress, stars and badges are kept with the rest
// of this computer's world; a lesson put down halfway carries on from there next time.
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
const EMPTY = { step: 0, done: false, stars: 0 };

export function createGuide(host) {
  const $ = id => document.getElementById(id);
  const el = {
    btn: $('btnLearn'), dot: $('learnDot'), mark: $('guideMark'),
    board: $('board'), list: $('boardList'), badges: $('boardBadges'), boardClose: $('boardClose'),
    talk: $('talk'), box: $('talkBox'), name: $('talkName'), title: $('talkTitle'), bar: $('talkBar'), text: $('talkText'),
    opts: $('talkOpts'), next: $('talkNext'), close: $('talkClose'),
    banner: $('banner'), bStars: $('bannerStars'), bGifts: $('bannerGifts'),
  };
  // mode: 'closed' | 'board' | 'talk'; sess: the conversation under way; pending: a lesson waiting for its world
  const S = { mode: 'closed', sess: null, pending: null, markOn: false, markGid: null, speed: 1 };
  const _anchor = new THREE.Vector3();

  /* ---------- saved progress ---------- */
  function data() {
    const d = host.save();
    if (!d.lessons || typeof d.lessons !== 'object') d.lessons = {};
    if (!Array.isArray(d.badges)) d.badges = [];
    return d;
  }
  const peek = id => data().lessons[id] || EMPTY;
  function rec(id) { const d = data(); return d.lessons[id] || (d.lessons[id] = { step: 0, done: false, stars: 0 }); }
  const guardian = id => GUARDIANS.find(g => g.id === id) || null;
  const guardianOf = lid => GUARDIANS.find(g => g.lessons.indexOf(lid) >= 0) || null;
  const unfinished = g => g.lessons.some(id => LESSONS[id] && !peek(id).done);
  const quizCount = L => L.steps.filter(s => s.ask).length;
  const cardOf = L => { for (let i = L.steps.length - 1; i >= 0; i--) if (L.steps[i].card) return L.steps[i].card; return null; };
  const fill = (t, m) => String(t || '').replace(/\{(\w+)\}/g, (_, k) => (m && m[k] != null ? m[k] : ''));
  function worldName(id) { const w = host.worlds.find(x => x.id === id); return w ? `${w.name} · ${w.sub}` : ''; }
  function adapterFor(gid) {
    const w = host.world();
    const a = w && w.inst && w.inst.guardian;
    return a && a.id === gid ? a : null;
  }
  function updateDot() { el.dot.hidden = !GUARDIANS.some(unfinished); }

  /* ---------- small DOM helpers ---------- */
  function node(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }
  const stars = n => { const f = node('span', 'stars'); f.appendChild(node('b', '', '★'.repeat(n))); f.appendChild(node('i', '', '★'.repeat(3 - n))); return f; };
  /** text whose last few characters stay together: a wrapped line never ends with one or two of them alone */
  function keepTail(text, n = 4) {
    const chars = Array.from(String(text)), f = document.createDocumentFragment();
    if (chars.length <= n + 2) { f.appendChild(document.createTextNode(chars.join(''))); return f; }
    f.appendChild(document.createTextNode(chars.slice(0, -n).join('')));
    f.appendChild(node('span', 'nw', chars.slice(-n).join('')));
    return f;
  }
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

  /* ---------- the board ---------- */
  function renderBoard() {
    el.list.textContent = '';
    const here = host.world() ? host.world().meta.id : '';
    for (const g of GUARDIANS) {
      const sec = node('section', 'gsec');
      const head = node('div', 'gd');
      const pt = node('div', 'pt');
      if (g.portrait) pt.style.backgroundImage = `url("${host.asset(g.portrait)}")`;
      const info = node('div', 'gi');
      info.appendChild(node('div', 'nm', g.name));
      info.appendChild(node('div', 'tt', `${g.title} · 住在${worldName(g.world)}`));
      head.appendChild(pt); head.appendChild(info);
      sec.appendChild(head);
      for (const id of g.lessons) if (LESSONS[id]) sec.appendChild(lessonItem(id, LESSONS[id], g.world === here));
      el.list.appendChild(sec);
    }
    el.badges.textContent = '';
    const have = data().badges;
    for (const g of GUARDIANS) for (const id of g.lessons) {
      const L = LESSONS[id];
      if (!L || !L.badge) continue;
      const got = have.indexOf(L.badge) >= 0;
      const seal = node('div', got ? 'seal' : 'seal no', got ? L.badge : '？');
      seal.title = got ? `${L.badge}（学会「${L.title}」）` : `学会「${L.title}」可得`;
      el.badges.appendChild(seal);
    }
  }
  function lessonItem(id, L, here) {
    const r = peek(id);
    const box = node('article', r.done ? 'ls done' : 'ls');
    const tl = node('div', 'tl');
    tl.appendChild(node('span', '', L.title));
    if (L.demo) tl.appendChild(node('span', 'tag', '示范'));
    box.appendChild(tl);
    if (L.keys) box.appendChild(node('div', 'ky', L.keys));
    if (L.about) box.appendChild(node('div', 'ab', L.about));
    const meta = [];
    if (L.minutes) meta.push(`约 ${L.minutes} 分钟`);
    const n = quizCount(L);
    if (n) meta.push(`${n} 道题`);
    const gifts = [];
    if (L.badge) gifts.push(`徽章「${L.badge}」`);
    if (L.reward) gifts.push(`${L.reward.what || ''}「${L.reward.name}」`);
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
      const k = node('button', 'pill ghost glass', '要点');
      k.type = 'button';
      k.addEventListener('click', () => {
        host.wake();
        if (shown) { shown.remove(); shown = null; k.setAttribute('aria-expanded', 'false'); return; }
        shown = renderCard(card);
        box.appendChild(shown);
        k.setAttribute('aria-expanded', 'true');
      });
      bt.appendChild(k);
    }
    const go = node('button', 'pill primary', r.done ? '重温' : r.step > 0 ? '继续' : here ? '开始' : '前往学习');
    go.type = 'button';
    go.addEventListener('click', () => { host.wake(); startLesson(id); });
    bt.appendChild(go);
    row.appendChild(st); row.appendChild(bt);
    box.appendChild(row);
    return box;
  }
  function openBoard() {
    if (S.mode === 'talk') return;
    renderBoard();
    S.mode = 'board';
    el.board.classList.add('open');
    el.board.setAttribute('aria-hidden', 'false');
  }
  function closeBoard() {
    if (S.mode !== 'board') return;
    S.mode = 'closed';
    el.board.classList.remove('open');
    el.board.setAttribute('aria-hidden', 'true');
  }
  /** From the board: talk with the lesson's guardian, going to its world first if it lives in another. */
  function startLesson(lid) {
    const g = guardianOf(lid);
    if (!g || !LESSONS[lid]) return;
    closeBoard();
    const w = host.world();
    if (!w || w.meta.id !== g.world) {
      if (host.loading()) return;
      S.pending = { gid: g.id, lid };
      host.enterWorld(g.world);
      return;
    }
    openTalk(g, lid);
  }

  /* ---------- the conversation ---------- */
  function openTalk(g, lid) {
    if (S.mode === 'board') closeBoard();
    if (S.sess) closeTalk(false);
    const a = adapterFor(g.id);
    const s = S.sess = { g, adapter: a, lid: lid || null, lesson: lid ? LESSONS[lid] : null, closed: false, started: false, finished: false, line: null, after: null, wake: null, view: null };
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
    if (saved && s.lid && s.started && !s.finished) host.toast('进度已保存，下次接着学');
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
    if (s.lesson) await lessonFlow(s, true);
    else await menuFlow(s);
    if (!s.closed) closeTalk(false);
  }
  function greeting(g) {
    const h = host.hours();
    for (const x of g.hello || []) if ((h >= x.from && h < x.to) || (h + 24 >= x.from && h + 24 < x.to)) return x.text;
    return '想学点什么？';
  }
  async function menuFlow(s) {
    const g = s.g, ids = g.lessons.filter(id => LESSONS[id]);
    const opts = ids.map(id => {
      const r = peek(id);
      return { text: LESSONS[id].title + (r.done ? '（已学会）' : r.step > 0 ? '（学到一半）' : '') };
    });
    opts.push({ text: g.later || '下次再说' });
    const i = await question(unfinished(g) ? greeting(g) : g.allDone || greeting(g), opts, false);
    if (i === CANCEL) return;
    if (i >= ids.length) { await say(g.bye || '好。'); return; }
    s.lid = ids[i]; s.lesson = LESSONS[s.lid];
    await lessonFlow(s, false);
  }
  async function lessonFlow(s, direct) {
    const L = s.lesson, r = rec(s.lid);
    let from = r.done ? 0 : r.step || 0;
    if (from >= L.steps.length) from = 0;
    if (from === 0) r.slips = 0;
    s.started = true;
    const open = from > 0 ? s.g.resume : direct ? s.g.start : '';
    if (open && await say(open) === CANCEL) return;
    for (let i = from; i < L.steps.length; i++) {
      r.step = i;
      host.markDirty();
      progress(i / L.steps.length);
      const st = L.steps[i];
      let res = null;
      if (st.say) res = await say(st.say);
      else if (st.ask) res = await ask(st, r);
      else if (st.card) res = await card(st.card);
      if (res === CANCEL || s.closed) return;
    }
    progress(1);
    s.finished = true;
    await complete(s);
  }
  async function ask(step, r) {
    const options = step.options.map(o => ({ text: o.text, ok: !!o.ok, reply: o.reply, off: false }));
    let again = false;
    for (;;) {
      const i = await question(step.ask, options, again);
      if (i === CANCEL) return CANCEL;
      const o = options[i];
      markPick(i, o.ok);
      react(o.ok ? 'yes' : 'no');
      if (o.ok) { host.sfx('chime'); return say(o.reply || '对。', { keep: true }); }
      if (!again) { r.slips = (r.slips || 0) + 1; host.markDirty(); }
      o.off = true; again = true;
      if (await say(o.reply || '再想想。', { keep: true }) === CANCEL) return CANCEL;
    }
  }
  async function complete(s) {
    const L = s.lesson, r = rec(s.lid), d = data(), g = s.g;
    const first = !r.done, n = quizCount(L), slips = r.slips || 0;
    const got = slips === 0 ? 3 : slips <= n / 2 ? 2 : 1;
    r.done = true; r.stars = Math.max(r.stars || 0, got); r.step = 0; r.slips = 0; r.at = Date.now(); r.runs = (r.runs || 0) + 1;
    const gifts = [];
    if (first && L.badge && d.badges.indexOf(L.badge) < 0) { d.badges.push(L.badge); gifts.push(`徽章「${L.badge}」`); }
    // the new resident comes in now (a splash in front of the guardian), so closing early never loses it
    let m = null;
    if (first && L.reward) {
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
      const b = node('button', 'pill primary got', '记住了');
      b.type = 'button';
      b.addEventListener('click', e => { e.stopPropagation(); host.wake(); advance(); });
      el.opts.appendChild(b);
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
      const b = node('button', 'opt');
      b.type = 'button';
      b.disabled = !!o.off;
      b.appendChild(node('span', 'k', KEYS[i] || String(i + 1)));
      b.appendChild(node('span', 'tx')).appendChild(keepTail(o.text, 3));
      b.addEventListener('click', e => { e.stopPropagation(); host.wake(); choose(i); });
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
  /** The marker over a guardian standing in the world with lessons still to teach (only while the HUD is up). */
  function updateMark() {
    const w = host.world(), a = w && w.inst && w.inst.guardian;
    let on = false;
    if (a && S.mode === 'closed' && !host.idle() && a.state() === 'ready') {
      const g = guardian(a.id);
      const p = g && unfinished(g) ? host.toScreen(a.anchor(_anchor)) : null;
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
      if (e.key === 'Escape') { closeBoard(); return true; }
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
    tick, tap, key,
    get open() { return S.mode !== 'closed'; },
    get talking() { return S.mode === 'talk'; },
    /** name and title of a guardian (the hover label) */
    who: id => guardian(id),
    /** before a world is put away: end any conversation in it (progress is kept) */
    leaveWorld() { if (S.mode === 'talk') closeTalk(true); el.mark.classList.remove('on'); S.markOn = false; },
    /** once a world is up: a lesson picked on the board for it starts now */
    worldReady() {
      const p = S.pending, w = host.world();
      S.pending = null;
      const g = p && guardian(p.gid);
      if (g && w && w.meta.id === g.world) openTalk(g, p.lid);
    },
    // test hooks (tools/qa/lesson.cjs)
    test: {
      state() {
        const s = S.sess;
        return {
          mode: S.mode, lesson: s ? s.lid : null, after: s ? s.after : null, typing: !!(s && s.line && !s.line.done),
          text: el.text.textContent, options: Array.prototype.map.call(el.opts.querySelectorAll('.opt'), b => ({ text: b.textContent, off: b.disabled, hidden: b.hidden })),
          guardian: s && s.adapter ? s.adapter.state() : null, mark: S.markOn, saved: JSON.parse(JSON.stringify(data().lessons)), badges: data().badges.slice(),
        };
      },
      speed(v) { S.speed = v; },
      openBoard, closeBoard, start: startLesson, talk: gid => openTalk(guardian(gid), null),
      next: advance, pick: choose, close: () => closeTalk(true),
    },
  };
}
