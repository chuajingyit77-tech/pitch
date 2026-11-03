#!/usr/bin/env node
// The company's lessons on a screen, end to end, against the local stand-in for the learning backend (fakebase.cjs),
// as Safari 14 on the iPad Air 3 (WebGL 1, 1112×834 at 2×):
//   the screen connected with a setup code typed in Settings · the board with the company's lessons, nobody signed in
//   · a lesson picked: the names, the PIN pad, a wrong PIN, the right one · the lesson played through with the heron
//   (greeting by name, a wrong answer, the card, the completion) · what the backend recorded · the board and the
//   learning record (学习档案) · the wrong answer answered again with the heron · a lesson half done while the network
//   is down, sent when it comes back · the shared screen signing its learner out after a while without a touch · the
//   screen taken off by an admin: back to the demo lessons.
// Then a phone held upright (390×844 at 2×) opening a team-code link (#join=…): a personal screen, signed in, staying
// signed in.
// Ends PASS when every check holds and there were no page or shader errors. Screenshots of every stage in <outdir>.
//
// NODE_PATH=$(npm root -g) node school.cjs <outdir> [--hours 15] [--seed 777] [--gl2] [--skip-phone]
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path'), os = require('os');
const { execFileSync } = require('child_process');
const fakebase = require('./fakebase.cjs');
const ROOT = path.resolve(__dirname, '..', '..');
const THREE_DIR = path.join(__dirname, 'node_modules', 'three');
const OUT = path.resolve(process.argv[2] || 'school-out');
const args = {};
for (let i = 3; i < process.argv.length; i++) if (process.argv[i].startsWith('--')) { const k = process.argv[i].slice(2); const v = process.argv[i + 1]; if (v === undefined || v.startsWith('--')) args[k] = true; else { args[k] = v; i++; } }
const GL2 = !!args.gl2, HOURS = +(args.hours || 15), SEED = +(args.seed || 777);
fs.mkdirSync(OUT, { recursive: true });
const IPAD = 'Mozilla/5.0 (iPad; CPU OS 14_8 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.1.2 Mobile/15E148 Safari/604.1';
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 14_8 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.1.2 Mobile/15E148 Safari/604.1';
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg' };
const FONTS = path.join(os.tmpdir(), 'qijing-fonts');
fs.mkdirSync(FONTS, { recursive: true });
function fetchCached(url, ua) {
  const f = path.join(FONTS, url.replace(/[^a-z0-9.]+/gi, '_').slice(-180));
  if (!fs.existsSync(f)) {
    try { execFileSync('curl', ['-sS', '-m', '30', '-A', ua, '-o', f, url]); } catch (e) { return null; }
  }
  return fs.readFileSync(f);
}
const srv = http.createServer((req, res) => {
  const p = decodeURIComponent(req.url.split('?')[0]);
  const f = path.join(ROOT, p === '/' ? 'play.html' : p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
});

let failed = 0, checks = 0;
const ok = (cond, what, got) => { checks++; console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${what}${!cond && got !== undefined ? ' — ' + JSON.stringify(got).slice(0, 300) : ''}`); if (!cond) failed++; };

(async () => {
  fakebase.init();
  const fb = await fakebase.start();
  const api = async (fn, body) => (await fb.rpc(fn, body))[1];
  const logs = [];
  let browser;
  try {
    // ---- the company: an admin, staff in four departments, a screen for the office, a team code for phones
    const [{ c: invite }] = await fb.sql(`select qj.new_invite('test') c`);
    const adm = (await api('admin_claim', { invite_code: invite, login_name: 'owner', password: 'secret-pass-1', display_name: '老板' })).session;
    const people = [['小明', '客服', '1234'], ['阿杰', '客服', '2468'], ['韩梅梅', '客服', '8642'], ['小红', '销售', '5678'], ['李雷', '销售', '9753'], ['王芳', '财务', '1357'], ['陈晨', '仓储', '1122']];
    const ids = {};
    for (const [name, dept, pin] of people) ids[name] = (await api('admin_save_employee', { token: adm, employee: { name, dept, pin } })).id;
    const office = await api('admin_device', { token: adm, device_label: '前台 iPad' });
    const team = await api('admin_join_code', { token: adm, code_label: '员工手机', uses: 5 });
    const lessons = await fb.sql(`select id, slug, title from qj.lessons order by sort`);
    const LID = Object.fromEntries(lessons.map(l => [l.slug, l.id]));

    await new Promise(r => srv.listen(0, '127.0.0.1', r));
    browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', ...(GL2 ? [] : ['--disable-webgl2'])] });
    let offline = false;

    async function openPage(phone, hash) {
      const ua = phone ? IPHONE : IPAD;
      const ctx = await browser.newContext({ viewport: phone ? { width: 390, height: 844 } : { width: 1112, height: 834 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, userAgent: ua });
      const page = await ctx.newPage();
      page.setDefaultTimeout(0);
      page.on('console', m => {
        if (m.type() !== 'error' && !(m.type() === 'warning' && /shader|WebGL|program/i.test(m.text()))) return;
        if (/KHR_parallel|GPU stall|GL Driver|deprecated in r153/.test(m.text())) return;
        const at = (m.location() && m.location().url) || '';
        if (offline && at.startsWith(fb.url)) return; // the backend unreachable on purpose
        logs.push(`[${phone ? 'phone' : 'ipad'} ${m.type()}] ` + m.text().slice(0, 300));
      });
      page.on('pageerror', e => logs.push('[pageerror] ' + e.message));
      await page.route('https://cdn.jsdelivr.net/npm/three@0.160.0/**', route => {
        const f = path.join(THREE_DIR, route.request().url().replace('https://cdn.jsdelivr.net/npm/three@0.160.0/', ''));
        if (!fs.existsSync(f)) return route.fulfill({ status: 404, body: '' });
        route.fulfill({ status: 200, contentType: 'text/javascript', body: fs.readFileSync(f) });
      });
      await page.route(/https:\/\/fonts\.(googleapis|gstatic)\.com\/.*/, route => {
        const url = route.request().url(), body = fetchCached(url, ua);
        if (!body) return route.fulfill({ status: 200, contentType: 'text/css', body: '' });
        route.fulfill({ status: 200, contentType: url.includes('googleapis') ? 'text/css' : 'font/woff2', body, headers: { 'access-control-allow-origin': '*' } });
      });
      await page.addInitScript(cfg => {
        window.__IDLE_TEST__ = { scene: 'koi', hours: cfg.hours, seed: cfg.seed, quality: 'low', noIdle: true, manualClock: true, backend: { url: cfg.url, key: 'sb_publishable_test' }, signOut: 3600e3 };
        try { if (!sessionStorage.getItem('qa-kept')) { localStorage.clear(); sessionStorage.setItem('qa-kept', '1'); } } catch (e) {}
      }, { hours: HOURS, seed: SEED, url: fb.url });
      await page.goto(`http://127.0.0.1:${srv.address().port}/${hash || ''}`);
      await page.waitForFunction(() => window.__idle && window.__idle.ready);
      await page.evaluate(() => window.__idle.ready);
      await page.waitForFunction(() => window.__idle.sceneId === 'koi' || window.__idle.error);
      await page.evaluate(() => document.fonts && document.fonts.ready);
      return page;
    }

    // helpers for one page
    function driver(page, tag) {
      const T = 1 / 30;
      const frames = (n, render = false) => page.evaluate(([n, dt, render]) => { for (let i = 0; i < n; i++) window.__idle.frame(dt, render && i === n - 1); }, [n, T, render]);
      const G = () => page.evaluate(() => window.__idle.guide.state());
      const SC = () => page.evaluate(() => window.__idle.school.state());
      const call = (fn, ...a) => page.evaluate(([fn, a]) => window.__idle.guide[fn](...a), [fn, a]);
      let shot = 0;
      async function snap(name) {
        await frames(1, true);
        await page.waitForTimeout(700); // CSS transitions
        await frames(1, true);
        const f = path.join(OUT, `${tag}_${String(shot++).padStart(2, '0')}_${name}.png`);
        await page.screenshot({ path: f });
        const s = await G();
        console.log(`  ${path.basename(f)}  [${s.mode}/${s.pane}${s.learner ? ' ' + s.learner : ''}${s.after ? ' ' + s.after : ''}${s.guardian ? ' heron ' + s.guardian : ''}] ${s.text.slice(0, 50)}`);
      }
      async function speak(secs = 1.2) { await frames(Math.round(secs / T)); const s = await G(); if (s.typing) await call('next'); }
      async function until(want) {
        for (let k = 0; k < 80; k++) {
          const s = await G();
          if (s.mode !== 'talk') return s;
          if (s.typing) { await speak(0.6); continue; }
          if (s.after === want) return s;
          if (s.after === 'next' || s.after === 'card') { await call('next'); await frames(6); continue; }
          await frames(10);
        }
        return G();
      }
      const click = sel => page.locator(sel).first().click();
      const pinType = async digits => { for (const d of digits) await page.locator('#panePin .pad .k', { hasText: new RegExp(`^${d}$`) }).click(); };
      const waitFor = async (fn, what, secs = 20) => {
        for (let t = 0; t < secs * 10; t++) { if (await fn()) return true; await page.waitForTimeout(100); }
        console.log(`  (timed out waiting for ${what})`);
        return false;
      };
      return { frames, G, SC, call, snap, speak, until, click, pinType, waitFor, T };
    }

    /* ======================= the office iPad ======================= */
    console.log('iPad (shared screen):');
    const page = await openPage(false);
    const d = driver(page, 'ipad');
    await d.frames(60);
    ok(!(await d.G()).company, 'not connected yet: demo lessons');

    // connect with the setup code typed in Settings (in lower case, with a space: as people type)
    await d.click('#btnSettings');
    await page.waitForTimeout(500);
    await page.fill('#schoolCode', 'zzzz zzzz');
    await d.click('#schoolJoin');
    await d.waitFor(async () => (await page.textContent('#schoolMsg')).includes('不对'), 'wrong code message');
    await d.snap('settings_wrong_code');
    ok((await page.textContent('#schoolMsg')).includes('登记码不对'), 'a wrong code is explained');
    await page.fill('#schoolCode', office.code.toLowerCase().replace('-', ' '));
    await d.click('#schoolJoin');
    await d.waitFor(async () => !!(await d.SC()).device, 'registration');
    await d.waitFor(async () => (await d.SC()).lessons > 0, 'lessons');
    await d.snap('settings_connected');
    const sc0 = await d.SC();
    ok(sc0.device && sc0.device.label === '前台 iPad' && !sc0.device.personal && sc0.lessons === 2 && sc0.staff === 7, 'connected: the office screen, 2 lessons, 7 names', sc0);
    ok((await page.textContent('#schoolDev')).includes('前台 iPad'), 'settings show the connection');
    await d.click('#btnClose');

    // the board: the company's lessons, nobody signed in
    await d.click('#btnLearn');
    await d.snap('board_nobody');
    let g = await d.G();
    ok(g.company && !g.learner && g.pane === 'lessons', 'board: company lessons, nobody signed in', g);
    ok(await page.isVisible('#meBar') && (await page.textContent('#meBar')).includes('还没登录'), 'board asks who is learning');

    // a lesson picked: who are you, the PIN pad, a wrong PIN, then the right one
    await d.click('#boardList .ls .bt .pill.primary');
    await page.waitForTimeout(300);
    ok((await d.G()).pane === 'who', 'picking a lesson asks who is learning first');
    await d.snap('who');
    const names = await page.$$eval('#paneWho .nm-btn .n', bs => bs.map(b => b.textContent));
    const depts = await page.$$eval('#paneWho .dh', bs => bs.map(b => b.textContent));
    ok(names.length === 7 && depts.join() === '财务,仓储,客服,销售', 'names grouped by department, in pinyin order', { names, depts });
    ok(!(await page.isVisible('#meBar')), 'the names pane says who it asks for itself (no sign-in bar)');
    await page.locator('#paneWho .nm-btn', { hasText: '小明' }).click();
    await page.waitForTimeout(300);
    ok((await d.G()).pane === 'pin' && (await page.textContent('#boardTitle')) === '小明', 'PIN pad for 小明');
    await d.snap('pin');
    await d.pinType('0000');
    await d.waitFor(async () => (await page.textContent('#panePin .pin-msg')).includes('再试'), 'wrong PIN message');
    await d.snap('pin_wrong');
    ok((await page.textContent('#panePin .pin-msg')).includes('还可以再试 4 次'), 'a wrong PIN: 4 tries left');
    await d.pinType('12');
    await d.snap('pin_typing');
    await d.pinType('34');
    await d.waitFor(async () => (await d.G()).mode === 'talk', 'the lesson to start after signing in');
    g = await d.G();
    ok(g.learner === '小明' && g.mode === 'talk' && g.lesson === LID.complaint, 'signed in, the lesson picked starts', g);

    // the lesson with the heron, as in lesson.cjs (a wrong answer at the first question)
    await d.frames(Math.round(4.5 / d.T));
    await d.snap('coming');
    for (let k = 0; k < 60 && (await d.G()).guardian !== 'ready'; k++) await d.frames(15);
    await d.speak(1.6);
    g = await d.G();
    ok(/^小明，/.test(g.text), 'the heron greets the learner by name', g.text);
    await d.snap('closeup');
    let s1 = await d.until('opts');
    await d.frames(20);
    await d.snap('question');
    const wrong = s1.options.findIndex(o => !/抱歉/.test(o.text)), right = s1.options.findIndex(o => /抱歉/.test(o.text));
    await d.call('pick', wrong);
    await d.speak(1.4);
    await d.call('next');
    await d.frames(10);
    await d.call('pick', right);
    await d.speak(1.0);
    await d.call('next');
    const s2 = await d.until('opts');
    await d.call('pick', s2.options.findIndex(o => /三点/.test(o.text)));
    await d.speak(0.8);
    await d.call('next');
    await d.until('card');
    await d.call('next');
    await d.frames(Math.round(0.9 / d.T));
    await d.snap('complete');
    await d.frames(Math.round(3.4 / d.T));
    await d.until('__end');
    await d.frames(Math.round(2.5 / d.T));

    // what the backend has
    await d.waitFor(async () => (await d.SC()).queue === 0, 'the record to be sent');
    const [rec1] = await fb.sql(`select p.done, p.stars, p.runs, p.seconds, (select count(*)::int from qj.answers a where a.employee_id = p.employee_id) answers,
      (select array_agg(badge) from qj.badges b where b.employee_id = p.employee_id) badges from qj.progress p where p.employee_id = $1 and p.lesson_id = $2`, [ids['小明'], LID.complaint]);
    ok(rec1 && rec1.done && rec1.stars === 2 && rec1.runs === 1 && rec1.answers === 3 && rec1.badges.join() === '接待之道', 'recorded: done, 2 stars, 3 answers, the badge', rec1);
    const arch1 = await api('admin_employee_report', { token: adm, employee: ids['小明'] });
    ok(arch1.archive.misses.length === 1 && arch1.archive.misses[0].step === 3, 'the wrong answer is on the list', arch1.archive.misses);

    // the board for 小明, and the learning record
    await d.call('openBoard');
    await d.snap('board_signed_in');
    ok((await page.textContent('#meBar')).includes('小明') && (await page.$$('#boardList .ls.done')).length === 1, 'board: 小明, one lesson learned');
    await page.locator('#meBar .pill', { hasText: '我的档案' }).click();
    await page.waitForTimeout(300);
    await d.snap('me');
    const tiles = await page.$$eval('#paneMe .tile b', bs => bs.map(b => b.textContent));
    ok((await d.G()).pane === 'me' && tiles[0] === '1 / 2' && tiles[1] === '★ 2' && tiles[2] === '50%', 'learning record: 1 of 2, ★ 2, 50% right first time', tiles);
    ok((await page.$$('#paneMe .miss')).length === 1, 'one question to review');

    // the wrong answer, answered again with the heron
    await page.locator('#paneMe .miss .pill', { hasText: '再答一次' }).click();
    await d.waitFor(async () => (await d.G()).mode === 'talk', 'the review');
    for (let k = 0; k < 60 && (await d.G()).guardian !== 'ready'; k++) await d.frames(15);
    const rq = await d.until('opts');
    ok(rq.review && /货是坏的/.test(rq.text), 'review: the heron asks the question again', rq.text);
    await d.snap('review_question');
    await d.call('pick', rq.options.findIndex(o => /抱歉/.test(o.text)));
    await d.speak(1.0);
    await d.call('next');
    await d.until('__end');
    await d.frames(Math.round(2 / d.T));
    await d.waitFor(async () => (await d.SC()).queue === 0, 'the review to be sent');
    const arch2 = await api('admin_employee_report', { token: adm, employee: ids['小明'] });
    ok(arch2.archive.misses.length === 0 && arch2.answers.filter(a => a.review).length === 1, 'reviewed: off the list (the answer kept as a review)', arch2.archive.misses);

    // the network goes down halfway through the second lesson; what was done reaches the backend when it is back
    offline = true;
    await page.route(fb.url + '/**', r => r.abort('internetdisconnected'));
    await d.call('start', LID.phishing);
    for (let k = 0; k < 60 && (await d.G()).guardian !== 'ready'; k++) await d.frames(15);
    const q3 = await d.until('opts');
    await d.call('pick', q3.options.findIndex(o => /电话/.test(o.text)));
    await d.speak(1.0);
    await d.call('next');
    await d.frames(10);
    await d.call('close');
    await d.frames(30);
    await page.waitForTimeout(2500);
    const waiting = (await d.SC()).queue;
    ok(waiting >= 3, 'offline: the lesson waits on the screen', waiting);
    await d.call('openBoard');
    await d.snap('board_offline');
    ok((await page.textContent('#boardList')).includes('学到一半'), 'offline: the board shows where it stopped');
    await d.call('closeBoard');
    await page.unroute(fb.url + '/**');
    offline = false;
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    await d.waitFor(async () => (await d.SC()).queue === 0, 'the waiting record to be sent', 40);
    const [rec2] = await fb.sql(`select p.step, p.done from qj.progress p where p.employee_id = $1 and p.lesson_id = $2`, [ids['小明'], LID.phishing]);
    const n2 = await fb.sql(`select count(*)::int n from qj.answers where employee_id = $1 and lesson_id = $2`, [ids['小明'], LID.phishing]);
    ok(rec2 && rec2.step > 0 && !rec2.done && n2[0].n === 1, 'back online: the half-done lesson and its answer are recorded once', { rec2, answers: n2[0].n });

    // a shared screen signs its learner out after a while without a touch (4 s in this test, 3 minutes for real; until
    // now an hour, as the test drives the lessons without touching the screen)
    await page.evaluate(() => window.__idle.school.signOut(4000));
    await page.waitForTimeout(5000);
    await d.waitFor(async () => !(await d.SC()).who, 'the sign-out', 10);
    ok(!(await d.SC()).who, 'shared screen: signed out when nobody touched it');
    await d.call('openBoard');
    await d.snap('board_after_signout');
    ok((await page.textContent('#meBar')).includes('还没登录'), 'board: nobody signed in again');
    await d.call('closeBoard');

    // an admin takes the screen off: back to the demo lessons
    await api('admin_device', { token: adm, device: office.id, active: false });
    await page.evaluate(() => window.__idle.school.api.refresh());
    await d.waitFor(async () => !(await d.SC()).device, 'the screen to be let go');
    await d.call('openBoard');
    await d.snap('board_revoked');
    g = await d.G();
    ok(!g.company && (await page.textContent('#boardList')).includes('示范'), 'taken off: the demo lessons again', g);
    await d.call('closeBoard');
    await page.context().close();

    /* ======================= a phone of one's own ======================= */
    if (!args['skip-phone']) {
      console.log('phone (personal, joined with a team-code link):');
      const ph = await openPage(true, `#join=${team.code}`);
      const p = driver(ph, 'phone');
      await p.waitFor(async () => (await p.SC()).lessons > 0, 'joining with the link');
      const pc = await p.SC();
      ok(pc.device && pc.device.personal && pc.device.label === '员工手机 1', 'joined with the link: a personal screen', pc);
      ok(!(await ph.evaluate(() => location.hash)), 'the code left the address');
      await p.frames(30);
      await p.click('#btnLearn');
      await p.snap('board_nobody');
      await ph.locator('#meBar .pill', { hasText: '登录' }).click();
      await ph.waitForTimeout(300);
      await p.snap('who');
      await ph.locator('#paneWho .nm-btn', { hasText: '小红' }).click();
      await ph.waitForTimeout(300);
      await p.snap('pin');
      await p.pinType('5678');
      await p.waitFor(async () => (await p.G()).learner === '小红', 'signing in');
      await p.snap('board_signed_in');
      ok((await p.G()).pane === 'lessons' && (await ph.textContent('#meBar')).includes('小红'), 'signed in on the phone: back to the lessons');
      await ph.locator('#meBar .pill', { hasText: '我的档案' }).click();
      await ph.waitForTimeout(300);
      await p.snap('me');
      await p.call('closeBoard');
      await ph.evaluate(() => window.__idle.school.signOut(4000));
      await ph.waitForTimeout(5000);
      await p.frames(5);
      ok((await p.SC()).who && (await p.SC()).who.name === '小红', 'personal screen: still signed in after a while');
      // a lesson begun on the phone
      await p.call('start', LID.complaint);
      for (let k = 0; k < 60 && (await p.G()).guardian !== 'ready'; k++) await p.frames(15);
      await p.speak(1.6);
      await p.snap('talk');
      const pq = await p.until('opts');
      await p.snap('question');
      ok(/^小红，/.test((await p.G()).text) || pq.options.length === 3, 'the lesson runs on the phone');
      await p.call('close');
      await p.frames(20);
      await p.waitFor(async () => (await p.SC()).queue === 0, 'the phone record to be sent');
      const [rec3] = await fb.sql(`select p.step from qj.progress p where p.employee_id = $1 and p.lesson_id = $2`, [ids['小红'], LID.complaint]);
      ok(rec3 && rec3.step > 0, 'the phone recorded where 小红 stopped', rec3);
      await ph.context().close();
    }
  } catch (e) {
    failed++; console.log('  ERROR', e.stack);
  } finally {
    if (browser) await browser.close();
    srv.close();
    await fb.stop();
  }
  for (const l of [...new Set(logs)].slice(0, 20)) console.log('  ' + l);
  console.log(failed || logs.length ? `FAIL: ${failed} of ${checks} checks failed; ${logs.length} console problems` : `PASS: ${checks} checks, no console problems`);
  process.exit(failed || logs.length ? 1 : 0);
})();
