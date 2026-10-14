#!/usr/bin/env node
// Stability probe: for each world/hour, NaN/Inf in the HDR buffer and temporal flicker of the final image.
// NODE_PATH=$(npm root -g) node flicker.cjs [outdir] reef:13 reef:23 koi:21.5 ...
// env: VW/VH viewport (default 640x360), Q=high|medium|low quality tier, VIEW='{"yaw":..,"pitch":..,"dist":..}',
//      GL1=1 for the iPad's WebGL 1 path, EVAL='<js>' run in the page once each world is up (a world's test hook,
//      e.g. EVAL='__idle.current.inst.debugGiant(0)' to measure with its giant passing), T0=259200 to start the
//      world clock as if the page had been open for 3 days (float32 precision of clocks that do not wrap)
// Writes <id>_<hour>[_Q].png (screenshot) and <id>_<hour>[_Q]_flicker.png (red = pixels that flickered).
// Metrics: nan/inf (+nanAt) count in the raw HDR scene render; maxL = brightest raw HDR luminance (+maxAt [x,y]
// screen fractions, top-left origin); over32 = pixels brighter than 32; flickerPermille = per-mille of pixels that
// swing up then down by >0.12 between consecutive 60 fps frames; meanDelta = mean per-pixel change per frame;
// globalJump = largest frame-to-frame change of mean screen brightness (a whole-screen flash).
// The page's own animation loop is stopped (manualClock): the probe alone steps the world, so runs repeat exactly.
const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const THREE_DIR = path.join(__dirname, 'node_modules', 'three');
const OUT = process.argv[2] || path.join(process.cwd(), 'qa-out', 'flicker');
const JOBS = process.argv.slice(3).map(j => { const [id, h] = j.split(':'); return { id, h: +h }; });
const VW = +(process.env.VW || 640), VH = +(process.env.VH || 360);
fs.mkdirSync(OUT, { recursive: true });
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg' };
const srv = http.createServer((req, resp) => {
  const p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/' || p === '/index.html') {
    resp.writeHead(200, { 'content-type': MIME['.html'] });
    resp.end('<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><style>body{margin:0}[hidden]{display:none!important}</style></head><body>' + fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8') + '</body></html>');
    return;
  }
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { resp.writeHead(404); resp.end(); return; }
  resp.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(resp);
});
(async () => {
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const port = srv.address().port;
  // GL1=1: measure the iPad's path (Safari 14: WebGL 1, FXAA instead of MSAA, no alpha-to-coverage)
  const GL1 = !!process.env.GL1;
  const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', ...(GL1 ? ['--disable-webgl2'] : [])] });
  const page = await browser.newPage({ viewport: { width: VW, height: VH }, deviceScaleFactor: 1,
    ...(GL1 ? { userAgent: 'Mozilla/5.0 (iPad; CPU OS 14_8 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.1.2 Mobile/15E148 Safari/604.1', hasTouch: true, isMobile: true } : {}) });
  page.setDefaultTimeout(900000);
  let logs = [];
  page.on('console', m => { if (m.type() === 'error') logs.push(`[console] ${m.text().slice(0, 300)}`); });
  page.on('pageerror', e => logs.push(`[pageerror] ${e.message}`));
  await page.route('https://cdn.jsdelivr.net/npm/three@0.160.0/**', route => {
    const f = path.join(THREE_DIR, route.request().url().replace('https://cdn.jsdelivr.net/npm/three@0.160.0/', ''));
    if (!fs.existsSync(f)) return route.fulfill({ status: 404, body: '' });
    route.fulfill({ status: 200, contentType: 'text/javascript', body: fs.readFileSync(f) });
  });
  await page.route('https://fonts.googleapis.com/**', r => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  await page.route('https://fonts.gstatic.com/**', r => r.abort());
  await page.addInitScript(cfg => { window.__IDLE_TEST__ = cfg; try { localStorage.clear(); } catch (e) {} }, { scene: JOBS[0].id, hours: JOBS[0].h, seed: 777, quality: process.env.Q || 'high', noUI: true, manualClock: true, t0: +(process.env.T0 || 0) });
  await page.goto(`http://127.0.0.1:${port}/`);
  await page.waitForFunction(() => window.__idle && window.__idle.ready);
  await page.evaluate(() => window.__idle.ready);
  let cur = JOBS[0].id;
  for (const { id, h } of JOBS) {
    await page.evaluate(hh => window.__idle.setHours(hh), h);
    if (id !== cur) { await page.evaluate(wid => window.__idle.enterWorld(wid), id); cur = id; }
    await page.evaluate(() => window.__idle.simulate(3));
    if (process.env.EVAL) await page.evaluate(code => { (0, eval)(code); window.__idle.simulate(0.5); }, process.env.EVAL);
    if (process.env.VIEW) await page.evaluate(v => { window.__idle.setView(v); window.__idle.simulate(1.5); }, JSON.parse(process.env.VIEW));
    const r = await page.evaluate(() => window.__idle.diagnose({ frames: 8, heatmap: true }));
    const tag = `${id}_${h}${process.env.Q ? '_' + process.env.Q : ''}${GL1 ? '_gl1' : ''}`;
    await page.screenshot({ path: path.join(OUT, `${tag}.png`) });
    if (r && r.map) { fs.writeFileSync(path.join(OUT, `${tag}_flicker.png`), Buffer.from(r.map.split(',')[1], 'base64')); delete r.map; }
    console.log(`${id}@${h}${process.env.Q ? ' [' + process.env.Q + ']' : ''}${GL1 ? ' [webgl1]' : ''}: ${JSON.stringify(r)}`);
    if (logs.length) { console.log('  ' + logs.slice(0, 6).join('\n  ')); logs = []; }
  }
  await browser.close();
  srv.close();
})().catch(e => { console.error(e); process.exit(1); });
