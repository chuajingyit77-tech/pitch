#!/usr/bin/env node
// Does a guardian's talk fit every screen? A connected screen (Safari 14's engine, WebGL 1) with a made-up lesson as
// long as the longest content the company's lessons have (an 81-character line, a 65-character question, three
// options of 81 characters in all with one of 38, a 49-character reply, a card of six points in 116 characters) and
// lesson titles of 15 characters. At each of: the line, the question, the reply to a wrong answer, the heron's menu
// with all five choices (carry on, the next one, the wrong answer, the board, later), the card and the banner, the
// page is looked at on ten screens, from the iPad to the smallest phones, upright and held sideways, as much of each
// as shows below Safari's bars. Every check: the guardian's name above the box, the box and its choices all on screen
// (8 px clear of the top). Ends PASS when every check holds and there were no page errors. Screenshots of the small
// screens in <outdir>.
//
// NODE_PATH=$(npm root -g) node talkfit.cjs <outdir>
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path'), os = require('os');
const { execFileSync } = require('child_process');
const fakebase = require('./fakebase.cjs');
const ROOT = path.resolve(__dirname, '..', '..');
const THREE_DIR = path.join(__dirname, 'node_modules', 'three');
const OUT = path.resolve(process.argv[2] || 'talkfit-out');
fs.mkdirSync(OUT, { recursive: true });
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 14_8 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.1.2 Mobile/15E148 Safari/604.1';
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg' };
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
const ok = (cond, what, got) => { checks++; if (!cond) { failed++; console.log(`  FAIL ${what}${got !== undefined ? ' — ' + JSON.stringify(got).slice(0, 300) : ''}`); } };

// made-up text, cut to a length (punctuation where a real line has it)
const TXT = '客户第一次来问的时候，先别急着报价，把他要解决的问题、预算、时间和决定的人都问清楚，记在客户档案里，再约第二次见面，把方案讲给能拍板的人听，这样成交才稳当。';
const cut = (n, end = '。') => Array.from(TXT.repeat(4)).slice(0, n - 1).join('') + end;
const title = s => Array.from(s + '的流程与要点和常见的错误以及处理方法').slice(0, 15).join('');
const LONG = {
  guardian: 'heron', title: title('第0天 · 最长'), keys: '一 · 二 · 三', about: '一节和最长的课一样长的课。', minutes: 3, badge: '量尺', tags: ['新员工七天训练', '第0天'], sort: 100,
  steps: [
    { say: cut(81) },
    { ask: cut(65, '？'), options: [{ text: cut(38), reply: cut(49) }, { text: cut(22), ok: true, reply: cut(30) }, { text: cut(21), reply: cut(40) }] },
    { card: { title: '要点', items: [['先问清', cut(24)], ['再报价', cut(20)], ['记档案', cut(16)], ['约二次', cut(14)], ['找拍板', cut(12)], ['跟到底', cut(12)]] } },
  ],
  outro: '去吧。',
};
const short = (t, i) => ({
  guardian: 'heron', title: title(t), keys: '一', about: '一节短课。', minutes: 3, badge: `测试${i}`, tags: ['新员工七天训练', `第${i}天`], sort: 100 + i,
  steps: [{ say: '这是一节测试用的课。' }, { ask: '哪一个是对的？', options: [{ text: '这个', ok: true, reply: '对。' }, { text: '那个', reply: '不对。' }, { text: '都不是', reply: '不对。' }] }],
});
// [name, width, height]: what shows of each screen (below Safari's bars where it has them)
const SCREENS = [
  ['ipad-sideways', 1112, 764], ['ipad-upright', 834, 1112], ['phone-upright', 390, 664], ['se-upright', 375, 548],
  ['android-upright', 360, 560], ['se1-upright', 320, 460],
  ['phone-sideways', 844, 390], ['phone-sideways-bars', 844, 340], ['se-sideways', 667, 325], ['android-sideways', 640, 300],
];
const SHOTS = /^(se1-upright|se-upright|se-sideways|android-sideways)$/;

(async () => {
  fakebase.init();
  const fb = await fakebase.start();
  const api = async (fn, body) => (await fb.rpc(fn, body))[1];
  let browser;
  try {
    const [{ c: invite }] = await fb.sql(`select qj.new_invite('test') c`);
    const adm = (await api('admin_claim', { invite_code: invite, login_name: 'owner', password: 'secret-pass-1', display_name: '老板' })).session;
    for (const L of [LONG, short('第1天 · 认识公司', 1), short('第2天 · 项目流程', 2), short('第3天 · 记录', 3), short('第4天 · 合同', 4)]) {
      const [{ id }] = await fb.sql(`select qj.import_draft($1::jsonb, null) id`, [JSON.stringify(L)]);
      if (!(await api('admin_lesson_status', { token: adm, lesson: id, status: 'published' })).ok) throw new Error('publishing ' + L.title);
    }
    // a long name (it is said before the heron's line)
    await api('admin_save_employee', { token: adm, employee: { name: '欧阳晓明', dept: '销售部', pin: '1234' } });
    const screen = await api('admin_device', { token: adm, device_label: 'talkfit' });
    await new Promise(r => srv.listen(0, '127.0.0.1', r));
    browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--disable-webgl2'] });
    const BASE = { width: 390, height: 664 };
    const ctx = await browser.newContext({ viewport: BASE, deviceScaleFactor: 2, hasTouch: true, isMobile: true, userAgent: IPHONE });
    const page = await ctx.newPage();
    const logs = [];
    page.on('pageerror', e => logs.push('[pageerror] ' + e.message));
    page.on('console', m => { if (m.type() === 'error' && !/GPU stall|GL Driver|KHR_parallel/.test(m.text())) logs.push('[error] ' + m.text().slice(0, 200)); });
    await page.route('https://cdn.jsdelivr.net/npm/three@0.160.0/**', route => {
      const f = path.join(THREE_DIR, route.request().url().replace('https://cdn.jsdelivr.net/npm/three@0.160.0/', ''));
      if (!fs.existsSync(f)) return route.fulfill({ status: 404, body: '' });
      route.fulfill({ status: 200, contentType: 'text/javascript', body: fs.readFileSync(f) });
    });
    await page.route(/https:\/\/fonts\.(googleapis|gstatic)\.com\/.*/, route => {
      const url = route.request().url(), body = fetchCached(url, IPHONE);
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
    await page.waitForFunction(() => window.__idle.sceneId === 'koi' || window.__idle.error);
    await page.evaluate(() => document.fonts && document.fonts.ready);
    await page.evaluate(code => window.__idle.school.api.register(code, 'test'), screen.code).catch(() => {});
    for (let t = 0; t < 300 && (await page.evaluate(() => window.__idle.school.state().lessons)) === 0; t++) await page.waitForTimeout(100);
    ok((await page.evaluate(() => window.__idle.school.state().lessons)) === 7, 'the screen has the 7 lessons');
    await page.evaluate(() => window.__idle.guide.openBoard());
    await page.waitForTimeout(300);
    await page.locator('#meBar .pill', { hasText: '登录' }).click();
    await page.waitForTimeout(300);
    await page.locator('#paneWho .nm-btn', { hasText: '欧阳晓明' }).click();
    await page.waitForTimeout(300);
    for (const dg of '1234') await page.locator('#panePin .pad .k', { hasText: new RegExp(`^${dg}$`) }).click();
    for (let t = 0; t < 100 && !(await page.evaluate(() => window.__idle.guide.state().learner)); t++) await page.waitForTimeout(100);
    await page.evaluate(() => window.__idle.guide.closeBoard());

    // the page's own loop is stopped: frames are stepped here
    const T = 1 / 30;
    const frames = (n, render = false) => page.evaluate(([n, dt, render]) => { for (let i = 0; i < n; i++) window.__idle.frame(dt, render && i === n - 1); }, [n, T, render]);
    const G = () => page.evaluate(() => window.__idle.guide.state());
    const call = (fn, ...a) => page.evaluate(([fn, a]) => window.__idle.guide[fn](...a), [fn, a]);
    // on through lines until the state wanted: 'opts' (the choices up), 'next' (a line said in full), 'card', 'banner'
    const until = async want => {
      for (let k = 0; k < 150; k++) {
        const s = await G();
        if (s.mode !== 'talk') return s;
        if (s.typing) { await frames(18); if ((await G()).typing) await call('next'); continue; }
        if (s.after === want) return s;
        if (s.after === 'next' || s.after === 'card') { await call('next'); await frames(6); continue; }
        await frames(10);
      }
      return G();
    };
    const measure = async state => {
      for (const [name, width, height] of SCREENS) {
        await page.setViewportSize({ width, height });
        await frames(1, true);
        await page.waitForTimeout(state === 'banner' ? 900 : 200);
        const m = await page.evaluate(banner => {
          const els = banner ? [document.querySelector('#banner .eb'), document.querySelector('#banner .rw:not([hidden])') || document.getElementById('bannerStars')]
            : [document.querySelector('#talk .who'), document.getElementById('talkBox'), ...[...document.querySelectorAll('#talkOpts > *')].filter(e => !e.hidden)];
          const rs = els.filter(Boolean).map(e => e.getBoundingClientRect());
          return { top: Math.round(Math.min(...rs.map(r => r.top))), bottom: Math.round(Math.max(...rs.map(r => r.bottom))), left: Math.round(Math.min(...rs.map(r => r.left))), right: Math.round(Math.max(...rs.map(r => r.right))), n: rs.length };
        }, state === 'banner');
        const fits = m.top >= 8 && m.bottom <= height && m.left >= 0 && m.right <= width;
        ok(fits, `${state} on ${name} (${width}×${height})`, m);
        console.log(`  ${fits ? 'ok  ' : 'FAIL'} ${state.padEnd(7)} ${name.padEnd(20)} ${width}×${height}  ${m.top}..${m.bottom}`);
        if (SHOTS.test(name)) await page.screenshot({ path: path.join(OUT, `${state}_${name}.png`) });
      }
      await page.setViewportSize(BASE);
      await frames(1, true);
    };

    console.log('the heron called, the next lesson (the long one):');
    await call('talk', 'heron');
    let s = await until('opts');
    ok(s.options.length === 3 && /下一课：第0天/.test(s.options[0].text), 'the heron offers the long lesson next', s.options);
    await call('pick', 0);
    s = await until('next');
    ok(Array.from(s.text).length === 81, 'its first line: 81 characters', s.text);
    await measure('line');
    await call('next'); await frames(3);
    s = await until('opts');
    ok(s.options.length === 3, 'the question', s.text);
    await measure('ask');
    await call('pick', 0); // wrong: the 49-character reply
    s = await until('next');
    await measure('reply');
    await call('next'); await frames(3);
    await until('opts');
    await call('close'); await frames(30); // put down halfway, with a wrong answer
    await call('talk', 'heron');
    s = await until('opts');
    ok(s.options.length === 5, 'called again: five choices', s.options.map(o => o.text));
    await measure('menu');
    await call('pick', 0); // carry on
    await until('opts');
    await call('pick', 1); // right
    s = await until('card');
    ok(s.after === 'card', 'the card of six points');
    await measure('card');
    await call('next');
    s = await until('banner');
    ok(s.after === 'banner', 'the banner');
    await measure('banner');
    ok(logs.length === 0, 'no page errors', logs);
    await ctx.close();
  } catch (e) { failed++; console.log('  ERROR', e.stack); }
  finally { if (browser) await browser.close(); srv.close(); await fb.stop(); }
  console.log(failed ? `FAIL: ${failed} of ${checks} checks` : `PASS: ${checks} checks`);
  process.exit(failed ? 1 : 0);
})();
