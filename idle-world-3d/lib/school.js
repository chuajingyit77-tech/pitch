// 栖境 — the company's lessons and every employee's learning record (the learning backend: lessons/backend.js).
//
// A screen registered with a code (设置 → 公司学习, or a link ending in #join=XXXX-XXXX) shows the company's published
// lessons instead of the demo ones, and the people who use it sign in with their name and a 4-digit PIN to learn. What
// they do in a lesson goes into their learning record (学习档案) as it happens. While the screen is offline it waits
// here, and it is sent when the network comes back, each batch once. The lessons, the guardians' lines and the staff
// list are kept here too, so a screen that starts offline still has its lessons.
//
// A shared screen (the office iPad) signs its learner out after a few minutes without a touch; a phone or computer of
// one's own (registered with a team code) stays signed in.
import { GUARDIANS } from '../lessons/index.js';

const KEY = 'qijing-school-v1', BOOT_KEY = 'qijing-school-boot-v1';
const REFRESH = 10 * 60e3;   // the lessons and the staff list, again every 10 minutes
const SIGN_OUT = 3 * 60e3;   // a shared screen: its learner is signed out after 3 minutes without a touch
const CHECK = 10 * 60e3;     // a signed-in session is checked with the backend when it was last heard from this long ago
const BATCH = 100;           // events per request
const KEEP = 5000;           // events kept for a screen that stays offline (the oldest go first)
const TIMEOUT = 15e3;
const EMPTY = { step: 0, done: false, stars: 0, slips: 0, runs: 0 };

export function createSchool({ backend, lastInput, onChange, signOut = SIGN_OUT }) {
  let signOutAfter = signOut;
  const S = { busy: false, nextFlush: 0, retry: 0, lastRefresh: 0, refreshing: null, checking: null, view: null, content: null };
  let st = read(KEY) || {};
  if (!Array.isArray(st.queue)) st.queue = [];
  let boot = st.dev ? read(BOOT_KEY) : null;
  if (st.queue.length) S.nextFlush = Date.now() + 2000;

  function read(k) { try { return JSON.parse(localStorage.getItem(k)) || null; } catch (e) { return null; } }
  function write(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  const persist = () => write(KEY, st);
  function changed(what) {
    S.view = null;
    if (what !== 'archive' && what !== 'who' && what !== 'signout') S.content = null;
    try { if (onChange) onChange(what); } catch (e) { console.error('[school]', e); }
  }
  const soon = ms => { const t = Date.now() + ms; S.nextFlush = S.nextFlush ? Math.min(S.nextFlush, t) : t; };
  function newId() {
    const a = new Uint8Array(15);
    try { crypto.getRandomValues(a); } catch (e) { for (let i = 0; i < a.length; i++) a[i] = (Math.random() * 256) | 0; }
    let s = '';
    for (let i = 0; i < a.length; i++) s += (a[i] % 36).toString(36);
    return 'b' + Date.now().toString(36) + s;
  }

  /** One call of the backend: its answer ({ ok, ... }), or an exception when it could not be reached. */
  async function rpc(fn, body) {
    const ctl = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = ctl ? setTimeout(() => ctl.abort(), TIMEOUT) : 0;
    try {
      const r = await fetch(`${backend.url}/rest/v1/rpc/${fn}`, {
        method: 'POST', cache: 'no-store', signal: ctl ? ctl.signal : undefined,
        headers: { apikey: backend.key, 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!r.ok) throw new Error(`${fn}: HTTP ${r.status}`);
      return await r.json();
    } finally { clearTimeout(timer); }
  }

  /* ---------- the screen ---------- */
  /** Register this screen with a setup code or a team code. */
  async function register(code) {
    const c = String(code || '').toUpperCase().replace(/[^0-9A-Z]/g, '');
    if (c.length !== 8) return { ok: false, error: 'code' };
    let r;
    try { r = await rpc('kiosk_register', { setup_code: c, device_label: '' }); } catch (e) { return { ok: false, error: 'net' }; }
    if (!r.ok) return r;
    st = { dev: { token: r.token, id: r.device.id, label: r.device.label, personal: !!r.device.personal }, me: null, queue: [] };
    boot = null;
    persist(); write(BOOT_KEY, null);
    changed('device');
    await refresh();
    return { ok: true, device: device() };
  }
  /** Forget the registration here (the records are in the backend; anything not sent yet is sent first if it can be). */
  async function forget() {
    if (st.me) logout();
    await flush();
    st = { queue: [] }; boot = null;
    persist(); write(BOOT_KEY, null);
    changed('device');
  }
  /** The backend no longer knows this screen (an admin took it off). */
  function revoked() {
    st = { queue: [] }; boot = null;
    persist(); write(BOOT_KEY, null);
    changed('revoked');
  }
  /** The lessons, the guardians and the staff list, from the backend. */
  function refresh() {
    if (!st.dev) return Promise.resolve(false);
    if (S.refreshing) return S.refreshing;
    S.lastRefresh = Date.now();
    S.refreshing = (async () => {
      try {
        const dev = st.dev;
        const r = await rpc('kiosk_bootstrap', { device_token: dev.token });
        if (st.dev !== dev) return false;
        if (!r.ok) { if (r.error === 'device') revoked(); return false; }
        boot = { at: Date.now(), guardians: r.guardians || [], lessons: r.lessons || [], staff: r.staff || [] };
        write(BOOT_KEY, boot);
        if (r.device) { dev.label = r.device.label; dev.personal = !!r.device.personal; persist(); }
        // someone signed in who is no longer on the staff list
        if (st.me && !boot.staff.some(p => p.id === st.me.emp.id)) { st.me = null; persist(); changed('who'); }
        changed('content');
        return true;
      } catch (e) { return false; } finally { S.refreshing = null; }
    })();
    return S.refreshing;
  }
  function device() { return st.dev ? { id: st.dev.id, label: st.dev.label, personal: !!st.dev.personal } : null; }

  /** The guardians and the lessons this screen teaches: { company: true, guardians, lessons: { id: lesson } }, or null
   *  when the screen is not registered (the demo lessons then). Each guardian keeps the lines of its own in
   *  lessons/index.js for what the backend leaves out. */
  function content() {
    if (!st.dev || !boot) return null;
    if (S.content) return S.content;
    const guardians = [], lessons = {};
    for (const g of boot.guardians || []) {
      const own = GUARDIANS.find(x => x.id === g.id) || {};
      guardians.push(Object.assign({}, own, g.lines || {}, {
        id: g.id, world: g.world || own.world, name: g.name || own.name || g.id, title: g.title || '', portrait: g.portrait || own.portrait, lessons: [],
      }));
    }
    for (const l of boot.lessons || []) {
      const g = guardians.find(x => x.id === l.guardian);
      if (!g || !Array.isArray(l.steps) || !l.steps.length) continue;
      lessons[l.id] = l;
      g.lessons.push(l.id);
    }
    S.content = { company: true, guardians: guardians.filter(g => g.lessons.length), lessons };
    return S.content;
  }

  /* ---------- the learner ---------- */
  async function login(emp, pin) {
    if (!st.dev) return { ok: false, error: 'device' };
    let r;
    try { r = await rpc('kiosk_login', { device_token: st.dev.token, employee: emp.id, pin }); } catch (e) { return { ok: false, error: 'net' }; }
    if (r.ok) {
      const e = (r.archive && r.archive.employee) || emp;
      st.me = { token: r.session, emp: { id: e.id, name: e.name, dept: e.dept || '' }, archive: r.archive, checked: Date.now() };
      persist();
      changed('who');
      soon(300);
    } else if (r.error === 'device') revoked();
    else if (r.error === 'who') refresh();
    return r;
  }
  function logout(auto) {
    const me = st.me;
    if (!me) return;
    st.me = null;
    persist();
    changed(auto ? 'signout' : 'who');
    if (st.dev) rpc('kiosk_logout', { device_token: st.dev.token, session_token: me.token }).catch(() => {});
    soon(500); // what is still waiting from the session goes now (the backend takes it for a week after it ended)
  }
  /** Ask the backend for the learner's record (other screens may have added to it); a session that has ended signs out. */
  function check() {
    const me = st.me;
    if (!me || !st.dev) return Promise.resolve();
    if (S.checking) return S.checking;
    S.checking = (async () => {
      try {
        const r = await rpc('kiosk_archive', { device_token: st.dev.token, session_token: me.token });
        if (st.me !== me) return;
        if (r.ok) { me.archive = r.archive; me.checked = Date.now(); persist(); changed('archive'); }
        else if (r.error === 'session') { st.me = null; persist(); changed('expired'); }
        else if (r.error === 'device') revoked();
      } catch (e) {} finally { S.checking = null; }
    })();
    return S.checking;
  }
  const lessonOf = id => boot && (boot.lessons || []).find(l => l.id === id);

  /** The learner's record as it stands here: the backend's, with what has not been sent yet. */
  function archive() {
    if (!st.me) return null;
    if (S.view) return S.view;
    const a = JSON.parse(JSON.stringify(st.me.archive || {}));
    a.progress = a.progress || {}; a.badges = a.badges || []; a.misses = a.misses || [];
    a.answered = a.answered || 0; a.right = a.right || 0;
    for (const q of st.queue) if (q.t === st.me.token) apply(a, q.e);
    S.view = a;
    return a;
  }
  // what the backend will make of an event (backend/004_record_batches.sql: kiosk_record), done here at once
  function apply(a, e) {
    const p = a.progress[e.lesson] || (a.progress[e.lesson] = { version: e.version, step: 0, done: false, stars: 0, slips: 0, runs: 0, seconds: 0 });
    if (e.type === 'start') { p.version = e.version; p.step = 0; p.slips = 0; p.startedAt = e.at; }
    else if (e.type === 'step') { p.version = e.version; p.step = e.step; }
    else if (e.type === 'answer') {
      if (e.first && !e.review) { a.answered++; if (e.correct) a.right++; else p.slips = (p.slips || 0) + 1; }
      if (e.first) {
        a.misses = a.misses.filter(m => !(m.lesson === e.lesson && m.step === e.step));
        if (!e.correct) a.misses.unshift({ lesson: e.lesson, step: e.step, choice: e.choice, at: e.at });
      }
    } else if (e.type === 'done') {
      if (p.startedAt) p.seconds = (p.seconds || 0) + Math.min(7200, Math.max(0, Math.round((Date.parse(e.at) - Date.parse(p.startedAt)) / 1000)));
      p.startedAt = null;
      p.done = true; p.stars = Math.max(p.stars || 0, e.stars || 0); p.step = 0; p.slips = 0; p.runs = (p.runs || 0) + 1;
      p.version = e.version; p.doneVersion = e.version;
      const L = lessonOf(e.lesson);
      if (e.badge && L && L.badge && a.badges.indexOf(L.badge) < 0) a.badges.push(L.badge);
    }
  }
  function record(e) {
    if (!st.me) return;
    e.at = new Date().toISOString();
    st.queue.push({ t: st.me.token, e });
    if (st.queue.length > KEEP) st.queue.splice(0, st.queue.length - KEEP);
    S.view = null;
    persist();
    soon(1500);
  }
  /** Send what is waiting, a batch at a time (each batch keeps its id until the backend has it: sent again after a lost
   *  answer, it is not counted twice). */
  async function flush() {
    if (S.busy || !st.dev || !st.queue.length) return;
    S.busy = true;
    S.nextFlush = 0;
    try {
      while (st.dev && st.queue.length) {
        const head = st.queue[0];
        if (!head.b) {
          const b = newId();
          for (let i = 0, n = 0; i < st.queue.length && n < BATCH; i++, n++) {
            const q = st.queue[i];
            if (q.t !== head.t || q.b) break;
            q.b = b;
          }
          persist();
        }
        const b = head.b, tok = head.t;
        const chunk = st.queue.filter(q => q.b === b);
        let r;
        try {
          r = await rpc('kiosk_record', { device_token: st.dev.token, session_token: tok, events: chunk.map(q => q.e), batch: b });
        } catch (e) {
          S.retry = Math.min(S.retry + 1, 6);
          soon(Math.min(300e3, 5e3 * Math.pow(2, S.retry)));
          return;
        }
        S.retry = 0;
        if (!r.ok && r.error === 'device') { revoked(); return; }
        // recorded, or refused for good (a session over a week old, an employee taken off the list): either way, gone
        st.queue = st.queue.filter(q => q.b !== b);
        if (!r.ok && r.error === 'session') st.queue = st.queue.filter(q => q.t !== tok);
        if (st.me && st.me.token === tok) {
          if (r.ok && r.archive) { st.me.archive = r.archive; st.me.checked = Date.now(); }
          else if (r.error === 'session') { st.me = null; persist(); changed('expired'); }
        }
        persist();
        changed('archive');
      }
    } finally { S.busy = false; }
  }

  /** Progress kept for the learner signed in here (lib/guide.js uses this in place of the screen's own record). */
  const ledger = {
    company: true,
    get(L) { const a = archive(), p = a && a.progress[L.id]; return p || EMPTY; },
    start(L) { record({ type: 'start', lesson: L.id, version: L.version }); },
    step(L, i) { record({ type: 'step', lesson: L.id, version: L.version, step: i }); },
    answer(L, i, choice, correct, first, review) {
      record({ type: 'answer', lesson: L.id, version: L.version, step: i, choice, correct: !!correct, first: !!first, review: !!review });
    },
    /** The lesson finished with these stars: { first } (the learner's first time through), { badge } (newly earned). */
    done(L, stars) {
      const a = archive(), p = a && a.progress[L.id];
      const first = !(p && p.done), badge = L.badge && a && a.badges.indexOf(L.badge) < 0 ? L.badge : null;
      record({ type: 'done', lesson: L.id, version: L.version, stars, badge: !!L.badge });
      return { first, badge };
    },
    badges() { const a = archive(); return a ? a.badges : []; },
    misses() { const a = archive(); return a ? a.misses : []; },
  };

  /** Every frame (cheap): the lessons now and then, what waits to be sent, and the shared screen's sign-out. */
  function tick() {
    if (!st.dev) return;
    const t = Date.now();
    if (t - S.lastRefresh > (boot ? REFRESH : 30e3)) refresh(); // (no lessons here yet: sooner)
    if (S.nextFlush && t >= S.nextFlush) flush();
    if (st.me && !st.dev.personal && performance.now() - lastInput() > signOutAfter) logout(true);
  }
  window.addEventListener('online', () => { if (st.dev) { soon(300); refresh(); } });

  return {
    register, forget, refresh, device, content, login, logout, check, archive, flush, tick, ledger,
    get registered() { return !!st.dev; },
    /** company lessons on this screen (registered, and the lessons have come at least once) */
    get active() { return !!(st.dev && boot); },
    get staff() { return (boot && boot.staff) || []; },
    get who() { return st.me ? st.me.emp : null; },
    get pending() { return st.queue.length; },
    /** a session last heard from long enough ago to be worth checking before a lesson */
    get stale() { return !!(st.me && Date.now() - (st.me.checked || 0) > CHECK); },
    test: {
      state: () => ({ device: device(), who: st.me ? st.me.emp : null, queue: st.queue.length, lessons: boot ? (boot.lessons || []).length : 0, staff: boot ? (boot.staff || []).length : 0 }),
      /** how long a shared screen waits before signing its learner out (tests that drive lessons without touches) */
      signOut(ms) { signOutAfter = ms; },
    },
  };
}
