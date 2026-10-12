#!/usr/bin/env node
// Screenshot of play.html as Safari 14 on an iPad Air 3 (WebGL 1, 1112×834 CSS px at 2×), at a fixed hour and seed.
// NODE_PATH=$(npm root -g) node ipadshot.cjs <out.png> <world> [hours=16.5] [dprOverride]
// dprOverride emulates a smaller drawing buffer (0.734 ≈ the old 0.5-megapixel "lite" picture).
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
const THREE_DIR = path.join(__dirname, 'node_modules', 'three');
const [OUTPNG, WORLD, HOURS = '16.5', DPR] = process.argv.slice(2);
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg' };
const srv = http.createServer((req, res) => {
  const p = decodeURIComponent(req.url.split('?')[0]);
  const f = path.join(ROOT, p === '/' ? 'play.html' : p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
});
(async () => {
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const port = srv.address().port;
  const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--disable-webgl2'] });
  const ctx = await browser.newContext({
    viewport: { width: 1112, height: 834 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true,
    userAgent: 'Mozilla/5.0 (iPad; CPU OS 14_8 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.1.2 Mobile/15E148 Safari/604.1',
  });
  const page = await ctx.newPage();
  page.setDefaultTimeout(1800000);
  const logs = [];
  page.on('console', m => { if (m.type() === 'error') logs.push(m.text().slice(0, 200)); });
  page.on('pageerror', e => logs.push('[pageerror] ' + e.message));
  await page.route('https://cdn.jsdelivr.net/npm/three@0.160.0/**', route => {
    const f = path.join(THREE_DIR, route.request().url().replace('https://cdn.jsdelivr.net/npm/three@0.160.0/', ''));
    if (!fs.existsSync(f)) return route.fulfill({ status: 404, body: '' });
    route.fulfill({ status: 200, contentType: 'text/javascript', body: fs.readFileSync(f) });
  });
  await page.route('https://fonts.googleapis.com/**', r => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  await page.route('https://fonts.gstatic.com/**', r => r.abort());
  await page.addInitScript(cfg => {
    window.__IDLE_TEST__ = { scene: cfg.world, hours: cfg.hours, seed: 12345, quality: 'low', noUI: true };
    try { localStorage.clear(); } catch (e) {}
    if (cfg.dpr) Object.defineProperty(window, 'devicePixelRatio', { get: () => cfg.dpr });
  }, { world: WORLD, hours: +HOURS, dpr: DPR ? +DPR : 0 });
  await page.goto(`http://127.0.0.1:${port}/`);
  await page.waitForFunction(() => window.__idle && window.__idle.ready);
  await page.evaluate(() => window.__idle.ready);
  await page.waitForFunction(w => window.__idle.sceneId === w || window.__idle.error, WORLD);
  await page.evaluate(() => window.__idle.simulate(3));
  await page.waitForTimeout(4000);
  const buf = await page.evaluate(() => { const gl = window.__idle.renderer.getContext(); return [gl.drawingBufferWidth, gl.drawingBufferHeight]; });
  await page.screenshot({ path: OUTPNG });
  const err = await page.evaluate(() => window.__idle.error);
  console.log(`${WORLD}@${HOURS}${DPR ? ' dpr ' + DPR : ''}: buffer ${buf.join('x')}${err ? ' ERROR ' + err.slice(0, 200) : ''}${logs.length ? ' | ' + logs.slice(0, 3).join(' | ') : ''}`);
  await browser.close(); srv.close();
})().catch(e => { console.error(e); process.exit(1); });
