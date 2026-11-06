#!/usr/bin/env node
// The island's guardian, the dolphin, on a screen connected to the company (a local stand-in for the learning
// backend, with made-up lessons: one for everyone kept by the heron, two sales lessons taught by the dolphin), as
// Safari 14 on the iPad Air 3 (WebGL 1, 1112×834 at 2×) and on a phone held upright (390×844 at 2×):
//   iPad: someone from sales signs in by the koi pond; the heron offers the next lesson on their path, taught on the
//   island (下一课：…（去晴岛找海豚）), and its own · picking it takes them to the island: the dolphin swims in to the
//   dock while the narration says it is coming, lifts its head out and the camera closes in low over the water · the
//   lesson: its lines (the beak chatters), a wrong answer (it shakes its head), the right one (it nods), the card,
//   the banner (it leaps clear of the water), the gift (a turtle comes into the water beside it) · its own menu
//   after: the next sales lesson, the wrong answer to answer again, the board, later.
//   phone: the second lesson started from the board goes to the island and the dolphin; its head clear of the
//   dialogue on a tall screen too.
//   The board, signed in: the dolphin's lessons first (they come next on his path), marked 你的岗位课, its portrait.
//   Throughout: its head above the dialogue's top edge on screen, the camera above the swell, no page errors.
// Ends PASS when every check holds. Screenshots in <outdir>.
//
// NODE_PATH=$(npm root -g) node dolphin.cjs <outdir>
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path'), os = require('os');
const { execFileSync } = require('child_process');
const fakebase = require('./fakebase.cjs');
const ROOT = path.resolve(__dirname, '..', '..');
const THREE_DIR = path.join(__dirname, 'node_modules', 'three');
const OUT = path.resolve(process.argv[2] || 'dolphin-out');
fs.mkdirSync(OUT, { recursive: true });
const IPAD = 'Mozilla/5.0 (iPad; CPU OS 14_8 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.1.2 Mobile/15E148 Safari/604.1';
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 14_8 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.1.2 Mobile/15E148 Safari/604.1';
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.glb': 'model/gltf-binary' };
const FONTS = path.join(os.tmpdir(), 'qijing-fonts');
fs.mkdirSync(FONTS, { recursive: true });
function fetchCached(url, ua) {
  const f = path.join(FONTS, url.replace(/[^a-z0-9.]+/gi, '_').slice(-180));
  if (!fs.existsSync(f)) { try { execFileSync('curl', ['-sS', '-m', '30', '-A', ua, '-o', f, url]); } catch (e) { return null; } }
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
const ok = (cond, what, got) => { checks++; console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${what}${!cond && got !== undefined ? ' — ' + JSON.stringify(got).slice(0, 400) : ''}`); if (!cond) failed++; };

const lesson = (guardian, title, tags, sort, reward) => ({
  guardian, title, keys: '一 · 二 · 三', about: '一节用来测试守护者的课。', minutes: 3, badge: `测试${sort}`, tags, sort, reward: reward || null,
  steps: [
    { say: '这是一节测试用的课，**先听我说完**。' },
    { say: '第二句话：客户说完以后，记下下一步再收工。' },
    { ask: '收工前，最要紧的是哪一件？', options: [{ text: '记下客户的下一步', ok: true, reply: '对，下一步写清楚，明天才接得上。' }, { text: '先发报价', reply: '报价不急，先把下一步记下来。' }, { text: '什么都不用做', reply: '不对，收工前要把下一步记下来。' }] },
    { card: { title: '要点', items: [['听', '先听客户说完'], ['记', '下一步写进记录'], ['约', '约好下次的时间']] } },
  ],
  outro: '去吧，明天见。',
});
const LESSONS = [
  lesson('heron', '进阶 · 测试', ['进阶 · 名企之道', '全员'], 201),
  lesson('dolphin', '销售 · 收工前检查', ['岗位课', '销售'], 320, { kind: 'turtle', name: '小绿', what: '海龟' }),
  lesson('dolphin', '销售 · 验收以后', ['岗位课', '销售'], 321),
];

(async () => {
  fakebase.init();
  const fb = await fakebase.start();
  const api = async (fn, body) => (await fb.rpc(fn, body))[1];
  let browser;
  try {
    const [{ c: invite }] = await fb.sql(`select qj.new_invite('test') c`);
    const adm = (await api('admin_claim', { invite_code: invite, login_name: 'owner', password: 'secret-pass-1', display_name: '老板' })).session;
    const ids = [];
    for (const L of LESSONS) {
      const [{ id }] = await fb.sql(`select qj.import_draft($1::jsonb, null) id`, [JSON.stringify(L)]);
      const r = await api('admin_lesson_status', { token: adm, lesson: id, status: 'published' });
      if (!r.ok) throw new Error('publishing ' + L.title + ': ' + JSON.stringify(r));
      ids.push(id);
    }
    await api('admin_save_employee', { token: adm, employee: { name: '小明', dept: '销售部', pin: '1234' } });
    await new Promise(r => srv.listen(0, '127.0.0.1', r));
    browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--disable-webgl2'] });
    for (const [dev, vp, ua] of [['ipad', { width: 1112, height: 834 }, IPAD], ['phone', { width: 390, height: 844 }, IPHONE]]) {
      console.log(`== ${dev}`);
      const screen = await api('admin_device', { token: adm, device_label: dev });
      const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: 2, hasTouch: true, isMobile: true, userAgent: ua });
      const page = await ctx.newPage();
      const logs = [];
      page.on('pageerror', e => logs.push('[pageerror] ' + e.message));
      page.on('console', m => { if (m.type() === 'error' && !/GPU stall|GL Driver|KHR_parallel/.test(m.text())) logs.push('[error] ' + m.text().slice(0, 200)); });
      page.on('response', r => { if (r.status() >= 400) logs.push(`[${r.status()}] ${r.url().replace(/^https?:\/\/[^/]+/, '')}`); });
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
        window.__IDLE_TEST__ = { scene: 'koi', hours: 15, seed: 777, quality: 'low', noIdle: true, manualClock: true, backend: { url: cfg.url, key: 'sb_publishable_test' }, signOut: 3600e3 };
        try { localStorage.clear(); } catch (e) {}
      }, { url: fb.url });
      await page.goto(`http://127.0.0.1:${srv.address().port}/`);
      await page.waitForFunction(() => window.__idle && window.__idle.ready);
      await page.evaluate(() => window.__idle.ready);
      await page.waitForFunction(() => window.__idle.sceneId === 'koi' || window.__idle.error, null, { timeout: 180000 });
      await page.evaluate(() => document.fonts && document.fonts.ready);
      await page.evaluate(code => window.__idle.school.api.register(code, 'test'), screen.code).catch(() => {});
      for (let t = 0; t < 300 && (await page.evaluate(() => window.__idle.school.state().lessons)) === 0; t++) await page.waitForTimeout(100);
      ok((await page.evaluate(() => window.__idle.school.state().lessons)) === 2 + LESSONS.length, `the screen has the ${2 + LESSONS.length} lessons`);

      // the page's own loop is stopped: frames are stepped here (now and then a touch keeps the talk from being put away)
      const T = 1 / 30;
      let touches = 0;
      const frames = (n, render = false) => page.evaluate(([n, dt, render]) => { for (let i = 0; i < n; i++) window.__idle.frame(dt, render && i === n - 1); }, [n, T, render]);
      const G = () => page.evaluate(() => window.__idle.guide.state());
      const call = (fn, ...a) => page.evaluate(([fn, a]) => window.__idle.guide[fn](...a), [fn, a]);
      const touch = () => page.mouse.move(2 + (touches++ % 2), 2);
      const until = async (want, cap = 300) => {
        for (let k = 0; k < cap; k++) {
          if (k % 20 === 0) await touch();
          const s = await G();
          if (s.mode !== 'talk') return s;
          if (s.typing) { await frames(18); if ((await G()).typing) await call('next'); continue; }
          if (s.after === want) return s;
          if (s.after === 'next' || s.after === 'card') { await call('next'); await frames(6); continue; }
          await frames(10);
        }
        return G();
      };
      let shotN = 0;
      const shot = async name => { await frames(1, true); await page.waitForTimeout(500); await frames(1, true); await page.screenshot({ path: path.join(OUT, `${dev}_${String(shotN++).padStart(2, '0')}_${name}.png`) }); };
      // where the dolphin's head is on screen, the dialogue's top edge, the camera's height and the swell under it
      const look = () => page.evaluate(() => {
        const I = window.__idle, inst = I.current.inst, a = inst.guardian, THREE = I.current.env.THREE;
        if (!a || a.id !== 'dolphin') return null;
        const p = a.anchor(new THREE.Vector3()); p.y -= 0.42;
        const cam = inst.camera; cam.updateMatrixWorld();
        const q = p.clone().project(cam);
        const box = document.getElementById('talkBox').getBoundingClientRect();
        const talkOpen = document.getElementById('talk').classList.contains('open');
        return { headY: (1 - q.y) / 2 * innerHeight, headX: (q.x + 1) / 2 * innerWidth, boxTop: talkOpen ? box.top : innerHeight, camY: cam.position.y, state: a.state(), w: innerWidth };
      });
      const signIn = async (name, pin) => {
        await page.locator('#meBar .pill', { hasText: '登录' }).click();
        await page.waitForTimeout(300);
        await page.locator('#paneWho .nm-btn', { hasText: name }).click();
        await page.waitForTimeout(300);
        for (const dg of pin) await page.locator('#panePin .pad .k', { hasText: new RegExp(`^${dg}$`) }).click();
        for (let t = 0; t < 100 && (await page.evaluate(() => window.__idle.guide.state().learner)) !== name; t++) await page.waitForTimeout(100);
        await page.waitForTimeout(300);
      };
      const toIsland = async () => {
        await page.waitForFunction(() => window.__idle.sceneId === 'island' || window.__idle.error, null, { timeout: 240000 });
        await frames(3);
      };
      const headClear = async (what) => {
        const L = await look();
        ok(!!L && L.headY < L.boxTop - 8 && L.headY > 24 && L.headX > 0 && L.headX < L.w, `${what}: its head on screen above the dialogue`, L);
        ok(!!L && L.camY > 0.65, `${what}: the camera above the swell`, L && L.camY);
      };

      await page.evaluate(() => window.__idle.guide.openBoard());
      await page.waitForTimeout(300);
      await signIn('小明', '1234');
      if (dev === 'ipad') {
        // the board: the guardian whose lessons come next on 小明's path first, marked as his role's
        const secs = await page.evaluate(() => [...document.querySelectorAll('#boardList .gsec .gd')].map(g => ({ nm: g.querySelector('.nm').textContent, tt: g.querySelector('.tt').textContent, img: (g.querySelector('.pt').style.backgroundImage || '').slice(0, 60) })));
        ok(secs.length === 2 && /^海豚你的岗位课$/.test(secs[0].nm) && secs[1].nm === '老苍鹭', 'the board: the dolphin (his role\'s guardian) first, then the heron', secs);
        ok(/晴岛/.test(secs[0].tt) && /dolphin\.jpg/.test(secs[0].img), 'the dolphin lives on 晴岛, with its portrait', secs[0]);
        await shot('board');
      }
      await page.evaluate(() => window.__idle.guide.closeBoard());

      if (dev === 'ipad') {
        // the heron: the next lesson on 小明's path is on the island
        await call('talk', 'heron');
        let s = await until('opts');
        const opts = s.options.map(o => o.text).join(' | ');
        ok(opts === 'A下一课：销售 · 收工前检查（去晴岛找海豚） | B我这里的课：进阶 · 测试 | C看全部课程 | D下次再说', 'the heron: the next lesson is the dolphin\'s, on the island; its own as well', opts);
        await shot('heron_handoff');
        await call('pick', 0);
        await frames(2);
        ok((await G()).mode !== 'talk' || (await G()).lesson === ids[1], 'the heron lets them go');
        await toIsland();
        // the dolphin is called in: it swims in while the narration says so
        s = await G();
        ok(s.mode === 'talk' && s.lesson === ids[1], 'on the island the lesson is under way with the dolphin', s.lesson);
        ok(/海豚正往码头游过来/.test(s.text) || s.guardian === 'ready', 'the narration: the dolphin is coming', s.text);
        await frames(90);
        await shot('coming');
        for (let k = 0; k < 120 && (await G()).guardian !== 'ready'; k++) { await frames(10); if (k % 6 === 0) await touch(); }
        ok((await G()).guardian === 'ready', 'it has come and holds its head out at the dock', (await G()).guardian);
        await frames(45);
        s = await until('next');
        await headClear('its first line');
        await shot('closeup_line');
        // the question: wrong, then right
        s = await until('opts');
        ok(s.options.length === 3 && /收工前/.test(s.text), 'the question', s.text);
        await headClear('the question');
        await shot('question');
        await call('pick', s.options.findIndex(o => /先发报价/.test(o.text)));
        await frames(12);
        ok(await page.evaluate(() => { const d = window.__idle.current.inst._debug.dolphin; return !!(d.mood && d.mood.kind === 'no'); }), 'a wrong answer: it shakes its head');
        await shot('wrong');
        s = await until('opts');
        await call('pick', s.options.findIndex(o => /下一步/.test(o.text)));
        await frames(10);
        ok(await page.evaluate(() => { const d = window.__idle.current.inst._debug.dolphin; return !!(d.mood && d.mood.kind === 'yes'); }), 'the right answer: it nods');
        await shot('right');
        // the card, then the banner: it leaps (or, with no room for a run, spins high out of the water)
        s = await until('card');
        ok(s.after === 'card', 'the card of key points');
        const before = await page.evaluate(() => window.__idle.current.env.members.map(m => m.kind + ':' + m.name));
        await headClear('the card');
        await shot('card');
        await call('next');
        await frames(3);
        const jumped = await page.evaluate(() => { const d = window.__idle.current.inst._debug.dolphin; return d.leap ? 'leap' : d.mood && d.mood.kind === 'spin' ? 'spin' : null; });
        ok(!!jumped, 'the lesson learnt: it leaps', jumped);
        await frames(66);
        await shot('banner_leap');
        await frames(18);
        await shot('leap_air');
        s = await until('next');
        for (let k = 0; k < 20 && !/海里多了一位新朋友/.test((await G()).text); k++) { await call('next'); await frames(8); }
        const gift = await G();
        ok(/海里多了一位新朋友：海龟「小绿」/.test(gift.text), 'the gift: a turtle', gift.text);
        const after = await page.evaluate(() => window.__idle.current.env.members.map(m => m.kind + ':' + m.name));
        ok(after.includes('turtle:小绿') && !before.includes('turtle:小绿'), 'a turtle called 小绿 lives on the island now', after);
        await shot('gift');
        s = await until('opts');
        ok(s.mode !== 'talk', 'the lesson over, the talk is put away', s.mode);
        await frames(30);
        ok((await G()).saved[ids[1]] && (await G()).saved[ids[1]].done, 'the lesson is in 小明\'s record, learnt', (await G()).saved[ids[1]]);
        // its own menu now
        await call('talk', 'dolphin');
        s = await until('opts');
        const o2 = s.options.map(o => o.text).join(' | ');
        ok(o2 === 'A下一课：销售 · 验收以后 | B把答错的题再练一遍（1 题） | C看全部课程 | D下次再说', 'the dolphin\'s own menu: the next sales lesson, the wrong answer, the board, later', o2);
        await frames(60); // (the camera comes back in from the island's own view)
        await headClear('its menu');
        await shot('dolphin_menu');
        await call('pick', 3);
        s = await until('opts');
        ok(s.mode !== 'talk', '下次再说: it says goodbye', s.mode);
        // the record to the backend, for the phone
        for (let t = 0; t < 100 && (await page.evaluate(() => window.__idle.school.state().queue)); t++) { await page.evaluate(() => window.__idle.school.api.flush()); await page.waitForTimeout(100); }
      } else {
        // the phone: the second lesson from the board goes to the island and the dolphin
        await page.evaluate(id => window.__idle.guide.start(id), ids[2]);
        await toIsland();
        for (let k = 0; k < 150 && (await G()).guardian !== 'ready'; k++) { await frames(10); if (k % 6 === 0) await touch(); }
        ok((await G()).guardian === 'ready', 'on the phone: the dolphin has come', (await G()).guardian);
        await frames(45);
        let s = await until('next');
        await headClear('on the phone, its first line');
        await shot('closeup_line');
        s = await until('opts');
        await headClear('on the phone, the question');
        await shot('question');
        await call('pick', s.options.findIndex(o => /下一步/.test(o.text)));
        s = await until('card');
        await headClear('on the phone, the card');
        await shot('card');
      }
      ok(logs.length === 0, 'no page errors', logs);
      await ctx.close();
    }
  } catch (e) { failed++; console.log('  ERROR', e.stack); }
  finally { if (browser) await browser.close(); srv.close(); await fb.stop(); }
  console.log(failed ? `FAIL: ${failed} of ${checks} checks` : `PASS: ${checks} checks`);
  process.exit(failed ? 1 : 0);
})();
