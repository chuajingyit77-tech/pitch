#!/usr/bin/env node
// Plays a guardian's lesson through, as Safari 14 on an iPad Air 3 (WebGL 1, 1112×834 at 2×) or, with --phone, as
// Safari on an iPhone held upright (390×844 at 2×), with screenshots of every stage: the HUD, the board, the guardian
// flying in, the close-up as it speaks, a question, a wrong answer and its explanation, the question again, the right
// answer, the card of key points, the completion banner as the new resident splashes in, the guardian's gift, the view
// given back, and the board afterwards (stars, badge, the card). Then a second lesson from the guardian itself (a tap
// on it: its menu), put down halfway, and the board showing where it stopped.
// Checks: the saved progress, stars and badge, the new resident (its kind and name), and no page or shader errors.
// Fonts come from Google Fonts as on the iPad (fetched with curl through the proxy, cached in the temp folder).
//
// NODE_PATH=$(npm root -g) node lesson.cjs <outdir> [--phone] [--hours 15] [--seed 777] [--gl2]
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path'), os = require('os');
const { execFileSync } = require('child_process');
const ROOT = path.resolve(__dirname, '..', '..');
const THREE_DIR = path.join(__dirname, 'node_modules', 'three');
const OUT = path.resolve(process.argv[2] || 'lesson-out');
const args = {};
for (let i = 3; i < process.argv.length; i++) if (process.argv[i].startsWith('--')) { const k = process.argv[i].slice(2); const v = process.argv[i + 1]; if (v === undefined || v.startsWith('--')) args[k] = true; else { args[k] = v; i++; } }
const PHONE = !!args.phone, GL2 = !!args.gl2, HOURS = +(args.hours || 15), SEED = +(args.seed || 777);
fs.mkdirSync(OUT, { recursive: true });
const UA = PHONE
  ? 'Mozilla/5.0 (iPhone; CPU iPhone OS 14_8 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.1.2 Mobile/15E148 Safari/604.1'
  : 'Mozilla/5.0 (iPad; CPU OS 14_8 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.1.2 Mobile/15E148 Safari/604.1';
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg' };
const FONTS = path.join(os.tmpdir(), 'qijing-fonts');
fs.mkdirSync(FONTS, { recursive: true });
function fetchCached(url) {
  const f = path.join(FONTS, url.replace(/[^a-z0-9.]+/gi, '_').slice(-180));
  if (!fs.existsSync(f)) {
    try { execFileSync('curl', ['-sS', '-m', '30', '-A', UA, '-o', f, url]); } catch (e) { return null; }
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
(async () => {
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', ...(GL2 ? [] : ['--disable-webgl2'])] });
  const ctx = await browser.newContext({
    viewport: PHONE ? { width: 390, height: 844 } : { width: 1112, height: 834 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, userAgent: UA,
  });
  const page = await ctx.newPage();
  page.setDefaultTimeout(0);
  const logs = [];
  page.on('console', m => {
    if (m.type() !== 'error' && !(m.type() === 'warning' && /shader|WebGL|program/i.test(m.text()))) return;
    if (/KHR_parallel|GPU stall|GL Driver|deprecated in r153/.test(m.text())) return;
    logs.push(`[${m.type()}] ` + m.text().slice(0, 300));
  });
  page.on('pageerror', e => logs.push('[pageerror] ' + e.message));
  await page.route('https://cdn.jsdelivr.net/npm/three@0.160.0/**', route => {
    const f = path.join(THREE_DIR, route.request().url().replace('https://cdn.jsdelivr.net/npm/three@0.160.0/', ''));
    if (!fs.existsSync(f)) return route.fulfill({ status: 404, body: '' });
    route.fulfill({ status: 200, contentType: 'text/javascript', body: fs.readFileSync(f) });
  });
  await page.route(/https:\/\/fonts\.(googleapis|gstatic)\.com\/.*/, route => {
    const url = route.request().url(), body = fetchCached(url);
    if (!body) return route.fulfill({ status: 200, contentType: 'text/css', body: '' });
    route.fulfill({ status: 200, contentType: url.includes('googleapis') ? 'text/css' : 'font/woff2', body, headers: { 'access-control-allow-origin': '*' } });
  });
  await page.addInitScript(cfg => {
    window.__IDLE_TEST__ = { scene: 'koi', hours: cfg.hours, seed: cfg.seed, quality: 'low', noIdle: true, manualClock: true };
    try { localStorage.clear(); } catch (e) {}
  }, { hours: HOURS, seed: SEED });
  await page.goto(`http://127.0.0.1:${srv.address().port}/`);
  await page.waitForFunction(() => window.__idle && window.__idle.ready);
  await page.evaluate(() => window.__idle.ready);
  await page.waitForFunction(() => window.__idle.sceneId === 'koi' || window.__idle.error);
  await page.evaluate(() => document.fonts && document.fonts.ready);

  const T = 1 / 30;
  const frames = (n, render = false) => page.evaluate(([n, dt, render]) => { for (let i = 0; i < n; i++) window.__idle.frame(dt, render && i === n - 1); }, [n, T, render]);
  const G = () => page.evaluate(() => window.__idle.guide.state());
  const call = (fn, ...a) => page.evaluate(([fn, a]) => window.__idle.guide[fn](...a), [fn, a]);
  let shot = 0;
  async function snap(name) {
    await frames(1, true);
    await page.waitForTimeout(700); // CSS transitions
    await frames(1, true);
    const f = path.join(OUT, `${String(shot++).padStart(2, '0')}_${name}.png`);
    await page.screenshot({ path: f });
    const s = await G();
    console.log(`  ${path.basename(f)}  [${s.mode}${s.lesson ? ' ' + s.lesson : ''} ${s.after || ''}${s.guardian ? ' heron ' + s.guardian : ''}] ${s.text.slice(0, 60)}`);
  }
  /** let the current line type out at speaking speed for `secs`, then finish it */
  async function speak(secs = 1.2) { await frames(Math.round(secs / T)); const s = await G(); if (s.typing) await call('next'); }
  /** go on through spoken lines until a question (or a card, or the end) */
  async function until(want) {
    for (let k = 0; k < 60; k++) {
      const s = await G();
      if (s.mode !== 'talk') return s;
      if (s.typing) { await speak(0.6); continue; }
      if (s.after === want) return s;
      if (s.after === 'next' || s.after === 'card') { await call('next'); await frames(6); continue; }
      await frames(10);
    }
    return G();
  }
  const residents = () => page.evaluate(() => window.__idle.current.env.members.map(m => `${m.kind}:${m.name}`));
  const before = await residents();
  await frames(60);
  await snap('hud');

  // the board, then the first lesson from it: the heron is called in
  await call('openBoard');
  await snap('board');
  await call('start', 'complaint');
  await frames(Math.round(4.5 / T));
  await snap('coming');
  for (let k = 0; k < 60 && (await G()).guardian !== 'ready'; k++) await frames(15);
  console.log(`  heron ready: ${(await G()).guardian}`);
  await speak(1.6);
  await snap('closeup');

  // first question: a wrong answer (explained), the question again, the right answer
  await until('opts');
  await frames(20);
  await snap('question');
  const s1 = await G();
  const wrong = s1.options.findIndex(o => !/抱歉/.test(o.text));
  const right = s1.options.findIndex(o => /抱歉/.test(o.text));
  await call('pick', wrong);
  await speak(1.4);
  await snap('wrong');
  await call('next');
  await frames(10);
  await snap('again');
  await call('pick', right);
  await speak(1.4);
  await snap('right');
  await call('next');

  // second question (right first time), then the card
  let s2 = await until('opts');
  const right2 = s2.options.findIndex(o => /三点/.test(o.text));
  await call('pick', right2);
  await speak(0.8);
  await call('next');
  await until('card');
  await snap('card');
  await call('next');
  await frames(Math.round(0.9 / T));
  await snap('complete');
  await frames(Math.round(3.4 / T));
  await speak(1.0);
  await snap('gift');
  await until('__end');
  await frames(Math.round(2.5 / T));
  await snap('after');
  await call('openBoard');
  await snap('board_done');
  await page.evaluate(() => { const b = [...document.querySelectorAll('#boardList .ls.done .bt .pill.ghost')][0]; if (b) b.click(); });
  await snap('board_card');
  await call('closeBoard');

  // the second lesson from the heron's own menu (a tap on it), put down after its first question
  await call('talk', 'heron');
  await frames(Math.round(0.6 / T));
  await speak(1.2);
  await snap('menu');
  const m = await G();
  await call('pick', m.options.findIndex(o => /钓鱼/.test(o.text)));
  await until('opts');
  await snap('phishing_q');
  await call('close');
  await frames(Math.round(1.5 / T));
  await call('openBoard');
  await snap('board_resume');
  await call('closeBoard');

  const end = await G();
  const after = await residents();
  const err = await page.evaluate(() => window.__idle.error);
  const added = after.filter(x => !before.includes(x));
  console.log(`saved: ${JSON.stringify(end.saved)}`);
  console.log(`badges: ${JSON.stringify(end.badges)} | residents ${before.length} -> ${after.length}, new: ${added.join(', ')}`);
  const ok = end.saved.complaint && end.saved.complaint.done && end.saved.complaint.stars === 2 && end.badges.includes('接待之道')
    && added.some(x => x === 'ogon:金麟') && end.saved.phishing && end.saved.phishing.step > 0 && !end.saved.phishing.done;
  console.log(`${ok ? 'PASS' : 'FAIL'}${err ? ' page error: ' + err.slice(0, 300) : ''}; ${logs.length} console problems`);
  for (const l of [...new Set(logs)].slice(0, 20)) console.log('  ' + l);
  await browser.close(); srv.close();
  process.exit(ok && !err && !logs.length ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
