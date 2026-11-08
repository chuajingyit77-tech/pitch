#!/usr/bin/env node
// The cloud sea's guardian, the old tortoise, on a screen connected to the company (a local stand-in for the learning
// backend, with made-up lessons: one for everyone kept by the heron, two finance lessons taught by the tortoise), as
// Safari 14 on the iPad Air 3 (WebGL 1, 1112×834 at 2×) and on a phone held upright (390×844 at 2×):
//   iPad: someone from 财务部 signs in by the koi pond; the heron offers the next lesson on their path, taught in the
//   cloud sea (下一课：…（去云海找太极龟）), and its own · picking it takes them to the cloud sea: the tortoise is at his
//   tai chi on the jade terrace; he turns to the camera (stepping round, his feet never sliding) and bows as it closes
//   in · the lesson: his lines (the beak works), a wrong answer (a slow shake of the head, a palm raised), the right
//   one (a nod, a stroke of the beard), the card, the banner (the great circle and a ball of qi between his palms that
//   rises and bursts), the gift (a crane flies in and lands on the terrace beside him, keeping clear of the camera) ·
//   his own menu after: the next finance lesson, the wrong answer to answer again, the board, later · released, he goes
//   back to his tai chi, turned the way he practises · his motion (body, head, hands, feet: all in his bones, which the
//   motion probe does not follow) is the same at 30 and 60 fps through a scripted lesson.
//   phone: the second lesson started from the board goes to the cloud sea and the tortoise; his head clear of the
//   dialogue on a tall screen too.
//   The board, signed in: the tortoise's lessons first (they come next on his path), marked 你的岗位课, his portrait.
//   Throughout: his head above the dialogue's top edge on screen, no page errors.
// Ends PASS when every check holds. Screenshots in <outdir>.
//
// NODE_PATH=$(npm root -g) node tortoise.cjs <outdir>
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path'), os = require('os');
const { execFileSync } = require('child_process');
const fakebase = require('./fakebase.cjs');
const ROOT = path.resolve(__dirname, '..', '..');
const THREE_DIR = path.join(__dirname, 'node_modules', 'three');
const OUT = path.resolve(process.argv[2] || 'tortoise-out');
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
    { ask: '收款之前，最要紧的是哪一件？', options: [{ text: '对过合同和发票', ok: true, reply: '对，先对清楚，再收。' }, { text: '先收了再说', reply: '不对，先对清楚，再收。' }, { text: '什么都不用做', reply: '不对，收款前要对账。' }] },
    { card: { title: '要点', items: [['听', '先听客户说完'], ['记', '下一步写进记录'], ['约', '约好下次的时间']] } },
  ],
  outro: '去吧，明天见。',
});
const LESSONS = [
  lesson('heron', '进阶 · 测试', ['进阶 · 名企之道', '全员'], 201),
  lesson('tortoise', '财务 · 收款之前', ['岗位课', '财务'], 360, { kind: 'crane', name: '小鹤', what: '仙鹤' }),
  lesson('tortoise', '财务 · 月底对账', ['岗位课', '财务'], 361),
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
    await api('admin_save_employee', { token: adm, employee: { name: '小明', dept: '财务部', pin: '1357' } });
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
      // where the tortoise's head is on screen, and the dialogue's top edge
      const look = () => page.evaluate(() => {
        const I = window.__idle, inst = I.current.inst, a = inst.guardian, THREE = I.current.env.THREE;
        if (!a || a.id !== 'tortoise') return null;
        const p = a.anchor(new THREE.Vector3()); p.y -= 0.38;
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
      const toCloudsea = async () => {
        await page.waitForFunction(() => window.__idle.sceneId === 'cloudsea' || window.__idle.error, null, { timeout: 240000 });
        await frames(3);
      };
      // the master: how far he is from facing the camera, and his feet (world, on the terrace)
      const master = () => page.evaluate(() => {
        const I = window.__idle, g = I.current.inst.debug.guardian, cam = I.current.inst.camera;
        const toCam = Math.atan2(cam.position.x - g.home.x, cam.position.z - g.home.z), d = toCam - g.yawS.x;
        return { off: Math.abs(Math.atan2(Math.sin(d), Math.cos(d))), homeOff: Math.abs(Math.atan2(Math.sin(g.yawS.x - g.homeYaw), Math.cos(g.yawS.x - g.homeYaw))),
          feet: g.feet.map(f => ({ x: f.p.x, z: f.p.z, lift: !!f.lift })), mood: g.mood && g.mood.kind, orb: g.orb.visible, talking: g.talking, wTai: g.wTai.x };
      });
      const headClear = async (what) => {
        const L = await look();
        ok(!!L && L.headY < L.boxTop - 8 && L.headY > 24 && L.headX > 0 && L.headX < L.w, `${what}: its head on screen above the dialogue`, L);
      };

      await page.evaluate(() => window.__idle.guide.openBoard());
      await page.waitForTimeout(300);
      await signIn('小明', '1357');
      if (dev === 'ipad') {
        // the board: the guardian whose lessons come next on 小明's path first, marked as his role's
        const secs = await page.evaluate(() => [...document.querySelectorAll('#boardList .gsec .gd')].map(g => ({ nm: g.querySelector('.nm').textContent, tt: g.querySelector('.tt').textContent, img: (g.querySelector('.pt').style.backgroundImage || '').slice(0, 60) })));
        ok(secs.length === 2 && /^太极龟你的岗位课$/.test(secs[0].nm) && secs[1].nm === '老苍鹭', 'the board: the tortoise (his role\'s guardian) first, then the heron', secs);
        ok(/云海/.test(secs[0].tt) && /tortoise\.jpg/.test(secs[0].img), 'the tortoise lives in the cloud sea, with his portrait', secs[0]);
        await shot('board');
      }
      await page.evaluate(() => window.__idle.guide.closeBoard());

      if (dev === 'ipad') {
        // the heron: the next lesson on 小明's path is in the cloud sea
        await call('talk', 'heron');
        let s = await until('opts');
        const opts = s.options.map(o => o.text).join(' | ');
        ok(opts === 'A下一课：财务 · 收款之前（去云海找太极龟） | B我这里的课：进阶 · 测试 | C看全部课程 | D下次再说', 'the heron: the next lesson is the tortoise\'s, in the cloud sea; its own as well', opts);
        await shot('heron_handoff');
        await call('pick', 0);
        await frames(2);
        ok((await G()).mode !== 'talk' || (await G()).lesson === ids[1], 'the heron lets them go');
        await toCloudsea();
        // he is here already, at his tai chi: the lesson starts and the camera closes in while he turns to it and bows
        s = await G();
        ok(s.mode === 'talk' && s.lesson === ids[1], 'in the cloud sea the lesson is under way with the tortoise', s.lesson);
        ok(s.guardian === 'ready', 'the tortoise is there (he is always on his terrace)', s.guardian);
        await frames(20);
        await shot('turning');
        // turning on the spot he steps round: a foot moves only while it is lifted
        const m0 = await master();
        let slid = 0, prev = m0.feet;
        for (let k = 0; k < 45; k++) {
          await frames(2);
          const m = await master();
          m.feet.forEach((f, i) => { const d = Math.hypot(f.x - prev[i].x, f.z - prev[i].z); if (d > 1e-4 && !f.lift && !prev[i].lift) slid++; });
          prev = m.feet;
        }
        ok(slid === 0, 'turning, his feet stay planted between steps', slid);
        const m1 = await master();
        ok(m1.off < 0.25 && m1.talking && m1.wTai < 0.3, 'he has turned to the camera from his practice', m1);
        await frames(40);
        s = await until('next');
        await headClear('his first line');
        await shot('closeup_line');
        // the question: wrong, then right
        s = await until('opts');
        ok(s.options.length === 3 && /收款之前/.test(s.text), 'the question', s.text);
        await headClear('the question');
        await shot('question');
        await call('pick', s.options.findIndex(o => /先收了再说/.test(o.text)));
        await frames(20);
        ok((await master()).mood === 'no', 'a wrong answer: he shakes his head, a palm raised');
        await shot('wrong');
        s = await until('opts');
        await call('pick', s.options.findIndex(o => /对过合同和发票/.test(o.text)));
        await frames(24);
        ok((await master()).mood === 'yes', 'the right answer: he nods and strokes his beard');
        await shot('right');
        // the card, then the banner: the great circle and the ball of qi
        s = await until('card');
        ok(s.after === 'card', 'the card of key points');
        const before = await page.evaluate(() => window.__idle.current.env.members.map(m => m.kind + ':' + m.name));
        await headClear('the card');
        await shot('card');
        await call('next');
        await frames(3);
        ok((await master()).mood === 'done', 'the lesson learnt: the great circle', (await master()).mood);
        await frames(87);
        ok((await master()).orb, 'a ball of qi glows between his palms', await master());
        await shot('banner_qi');
        s = await until('next');
        for (let k = 0; k < 20 && !/云海里多了一位新朋友/.test((await G()).text); k++) { await call('next'); await frames(8); }
        const gift = await G();
        ok(/云海里多了一位新朋友：仙鹤「小鹤」/.test(gift.text), 'the gift: a crane', gift.text);
        const after = await page.evaluate(() => window.__idle.current.env.members.map(m => m.kind + ':' + m.name));
        ok(after.includes('crane:小鹤') && !before.includes('crane:小鹤'), 'a crane called 小鹤 lives in the cloud sea now', after);
        // it flies in to land on the terrace beside him (in the picture, never across the camera)
        const land = await page.evaluate(() => {
          const D = window.__idle.current.inst.debug, g = D.guardian;
          const c = D.sys.cranes.find(c => c.member && c.member.name === '小鹤');
          return c ? { state: c.state, d: +c.land.spot.distanceTo(g.home).toFixed(2) } : null;
        });
        ok(land && (land.state === 'approach' || land.state === 'glide') && land.d < 4, 'it is coming in to land beside the tortoise', land);
        let gap = Infinity;
        for (let k = 0; k < 24; k++) {
          gap = Math.min(gap, await page.evaluate(() => {
            const I = window.__idle, cam = I.current.inst.camera;
            let min = Infinity;
            for (const m of I.current.inst.creatures()) if (m.member && m.member.name === '小鹤') min = Math.min(min, m.pos.distanceTo(cam.position));
            return min;
          }));
          await frames(10);
        }
        ok(gap > 1.5, 'on its way it keeps clear of the close-up camera', +gap.toFixed(2));
        await shot('gift');
        s = await until('opts');
        ok(s.mode !== 'talk', 'the lesson over, the talk is put away', s.mode);
        await frames(30);
        ok((await G()).saved[ids[1]] && (await G()).saved[ids[1]].done, 'the lesson is in 小明\'s record, learnt', (await G()).saved[ids[1]]);
        // his own menu now
        await call('talk', 'tortoise');
        s = await until('opts');
        const o2 = s.options.map(o => o.text).join(' | ');
        ok(o2 === 'A下一课：财务 · 月底对账 | B把答错的题再练一遍（1 题） | C看全部课程 | D下次再说', 'the tortoise\'s own menu: the next finance lesson, the wrong answer, the board, later', o2);
        await frames(60); // (the camera comes back in from the cloud sea's own view)
        await headClear('his menu');
        await shot('tortoise_menu');
        await call('pick', 3);
        s = await until('opts');
        ok(s.mode !== 'talk', '下次再说: he says goodbye', s.mode);
        // released, he goes back to his tai chi, turned the way he practises
        await frames(240);
        const m2 = await master();
        ok(!m2.talking && m2.homeOff < 0.2 && m2.wTai > 0.8, 'released, he is back at his tai chi', m2);
        await shot('back_to_taichi');
        // his motion is the same at 30 and 60 fps (the motion probe follows objects, and his moves are all in his bones):
        // two of him play the same scripted lesson, one at each rate, and his body, head, hands and feet are compared
        const fr = await page.evaluate(async () => {
          const I = window.__idle, THREE = I.current.env.THREE;
          const { TortoiseGuardian, TORTOISE_BONES: B } = await import(new URL('scenes/cloudsea/guardian.js', location.href).href);
          const { makeRng } = await import(new URL('lib/util.js', location.href).href);
          const EV = [[3, g => g.talk(true)], [6, g => { g.speaking = true; }], [8.5, g => { g.speaking = false; }], [9, g => g.react('yes')], [12, g => g.react('no')], [15, g => g.react('done')], [25, g => g.release()]];
          const run = fps => {
            const scene = new THREE.Scene(), cam = new THREE.PerspectiveCamera(42, 1.33, 0.1, 100);
            cam.position.set(1.5, 1.6, 3.5); cam.lookAt(0, 1, 0); cam.updateMatrixWorld();
            const env = { q: 1, seed: 7, shadows: false, renderer: I.renderer, sfx: () => {} };
            const world = { taijiSpot: () => ({ p: new THREE.Vector3(0, 0, 0), yaw: 0 }), groundAt: () => 0, blocked: () => false };
            const g = new TortoiseGuardian({ env, scene, camera: cam, shared: null, world, fx: null, rng: makeRng(5), night: () => 0 });
            const out = [], dt = 1 / fps;
            let k = 0;
            for (let i = 1; i <= 30 * fps; i++) {
              const t = i / fps;
              while (k < EV.length && EV[k][0] <= t - dt * 0.5) { EV[k][1](g); k++; }
              g.update(dt, t);
              if (i % (fps / 10) === 0) out.push([B.BODY, B.HEAD, B.HAND[0], B.HAND[1], B.FOOT[0], B.FOOT[1]].map(b => g.mesh.localToWorld(g.bones[b].position.clone())));
            }
            g.dispose();
            return out;
          };
          const a = run(60), b = run(30), names = ['body', 'head', 'handL', 'handR', 'footL', 'footR'], max = {};
          a.forEach((row, i) => row.forEach((p, j) => { max[names[j]] = Math.max(max[names[j]] || 0, +p.distanceTo(b[i][j]).toFixed(4)); }));
          return max;
        });
        ok(Object.values(fr).every(d => d < 0.005), 'his motion is the same at 30 and 60 fps (body, head, hands, feet within 5 mm)', fr);
        // the record to the backend, for the phone
        for (let t = 0; t < 100 && (await page.evaluate(() => window.__idle.school.state().queue)); t++) { await page.evaluate(() => window.__idle.school.api.flush()); await page.waitForTimeout(100); }
      } else {
        // the phone: the second lesson from the board goes to the cloud sea and the tortoise
        await page.evaluate(id => window.__idle.guide.start(id), ids[2]);
        await toCloudsea();
        ok((await G()).guardian === 'ready', 'on the phone: the tortoise is there', (await G()).guardian);
        await frames(150);
        let s = await until('next');
        await headClear('on the phone, his first line');
        await shot('closeup_line');
        s = await until('opts');
        await headClear('on the phone, the question');
        await shot('question');
        await call('pick', s.options.findIndex(o => /对过合同和发票/.test(o.text)));
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
