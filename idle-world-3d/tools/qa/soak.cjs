#!/usr/bin/env node
// Long-run soak test: the iPad shows one world all day, so a world must look and behave the same after hours as in
// its first minute. This steps a world through hours of play in time-lapse (the page's own loop is stopped; the
// probe steps the world at 1/30 s, the clock of day moving with it), drops food now and then, and every few
// simulated minutes renders frames and samples:
//   nan/inf    NaN or infinite pixels in the HDR scene buffer (a creature or a shader that has blown up)
//   flicker    temporal flicker of the final image (per mille, as flicker.cjs)
//   geo/tex/prog  renderer memory: geometries, textures, shader programs (anything that keeps growing is a leak)
//   heap       JS heap after a forced GC (MB)
//   objs/vis   scene objects, and meshes drawn (a creature left visible, or never shown again)
// and flags growth, NaN and page errors.
// NODE_PATH=$(npm root -g) node soak.cjs <outdir> <world> [--hours 3] [--start 5.5] [--every 10] [--q low] [--gl1 1] [--t0 0]
//   --hours    simulated hours; --start: the hour of day it begins at; --every: minutes between samples
//   --t0       start the world clock as if the page had been open that many seconds already
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
const THREE_DIR = path.join(__dirname, 'node_modules', 'three');
const OUT = process.argv[2], WORLD = process.argv[3];
if (!OUT || !WORLD) { console.error('usage: soak.cjs <outdir> <world> [--hours 3] [--start 5.5] [--every 10] [--q low] [--gl1 1] [--t0 0]'); process.exit(2); }
const args = {};
for (let i = 4; i < process.argv.length; i++) if (process.argv[i].startsWith('--')) { args[process.argv[i].slice(2)] = process.argv[i + 1]; i++; }
const HOURS = +(args.hours || 3), START = +(args.start ?? 5.5), EVERY = +(args.every || 10), Q = args.q || 'low', GL1 = args.gl1 !== undefined, T0 = +(args.t0 || 0);
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
  const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--js-flags=--expose-gc', '--enable-precise-memory-info', ...(GL1 ? ['--disable-webgl2'] : [])] });
  const ctx = await browser.newContext({
    viewport: { width: 480, height: 270 }, deviceScaleFactor: 1,
    ...(GL1 ? { userAgent: 'Mozilla/5.0 (iPad; CPU OS 14_8 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.1.2 Mobile/15E148 Safari/604.1' } : {}),
  });
  const page = await ctx.newPage();
  page.setDefaultTimeout(0);
  const errors = [];
  page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`[${m.type()}] ${m.text().slice(0, 240)}`); });
  page.on('pageerror', e => errors.push('[pageerror] ' + e.message));
  await page.route('https://cdn.jsdelivr.net/npm/three@0.160.0/**', route => {
    const f = path.join(THREE_DIR, route.request().url().replace('https://cdn.jsdelivr.net/npm/three@0.160.0/', ''));
    if (!fs.existsSync(f)) return route.fulfill({ status: 404, body: '' });
    route.fulfill({ status: 200, contentType: 'text/javascript', body: fs.readFileSync(f) });
  });
  await page.route('https://fonts.googleapis.com/**', r => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  await page.route('https://fonts.gstatic.com/**', r => r.abort());
  await page.addInitScript(cfg => {
    window.__IDLE_TEST__ = cfg;
    try { localStorage.clear(); } catch (e) {}
  }, { scene: WORLD, hours: START, seed: 777, quality: Q, noUI: true, noIdle: true, manualClock: true, t0: T0 });
  await page.goto(`http://127.0.0.1:${port}/`);
  await page.waitForFunction(() => window.__idle && window.__idle.ready);
  await page.evaluate(() => window.__idle.ready);
  await page.waitForFunction(w => window.__idle.sceneId === w || window.__idle.error, WORLD);
  const t0 = Date.now();
  const rows = [];
  const steps = Math.round(HOURS * 60 / EVERY);
  console.log(`== ${WORLD}: ${HOURS} h from ${START}:00 in ${EVERY}-minute blocks${T0 ? `, clock starting at ${T0} s` : ''}${GL1 ? ' [webgl1]' : ''}`);
  console.log('  sim     hour  nan inf  maxL  flicker  geo  tex prog  heap MB  objs  vis   (wall s)');
  for (let k = 0; k <= steps; k++) {
    const r = await page.evaluate(({ k, every, start }) => {
      const I = window.__idle, inst = I.current.inst, r = I.renderer;
      if (k > 0) {
        // EVERY minutes of play in one-minute slices, the clock of day moving with it; food every 20 minutes
        for (let m = 0; m < every; m++) {
          const mins = (k - 1) * every + m;
          I.setHours((start + mins / 60) % 24);
          if (mins % 20 === 10) { const W = innerWidth, H = innerHeight; for (const [fx, fy] of [[0.5, 0.6], [0.42, 0.55], [0.58, 0.65], [0.5, 0.5], [0.45, 0.7]]) I.feedAt(W * fx, H * fy); }
          I.simulate(60, 1 / 30);
        }
      }
      const d = I.diagnose({ frames: 3, w: 160, h: 90 });
      if (window.gc) window.gc();
      let objs = 0, vis = 0;
      inst.scene.traverse(o => { objs++; if ((o.isMesh || o.isPoints || o.isLine || o.isSprite) && o.visible) { let v = true; for (let p = o.parent; p; p = p.parent) if (!p.visible) { v = false; break; } if (v) vis++; } });
      const mem = r.info.memory;
      return { hour: +((start + k * every / 60) % 24).toFixed(2), nan: d.nan, inf: d.inf, maxL: d.maxL, flicker: d.flickerPermille, geo: mem.geometries, tex: mem.textures, prog: (r.info.programs || []).length,
        heap: performance.memory ? +(performance.memory.usedJSHeapSize / 1048576).toFixed(1) : -1, objs, vis, err: I.error || null };
    }, { k, every: EVERY, start: START });
    r.sim = k * EVERY;
    rows.push(r);
    console.log(`  ${String(r.sim).padStart(4)} min ${r.hour.toFixed(2).padStart(5)}  ${String(r.nan).padStart(3)} ${String(r.inf).padStart(3)} ${String(r.maxL).padStart(5)}  ${String(r.flicker).padStart(7)} ${String(r.geo).padStart(4)} ${String(r.tex).padStart(4)} ${String(r.prog).padStart(4)}  ${String(r.heap).padStart(7)} ${String(r.objs).padStart(5)} ${String(r.vis).padStart(4)}   (${((Date.now() - t0) / 1000).toFixed(0)})`);
    if (r.err) { console.log('  world error: ' + r.err.slice(0, 400)); break; }
  }
  fs.writeFileSync(path.join(OUT, `${WORLD}_soak.json`), JSON.stringify({ rows, errors }, null, 1));
  // verdict: the end against the highest value of the first half (a creature's textures and programs upload when it is
  // first drawn, which can be minutes in: that is growth that stops, not a leak)
  const half = rows.slice(0, Math.max(2, Math.ceil(rows.length / 2))), b = rows[rows.length - 1];
  const a = {}; for (const k of ['geo', 'tex', 'prog', 'objs', 'heap']) a[k] = Math.max(...half.map(x => x[k]));
  const grow = (k, tol) => b[k] > a[k] * (1 + tol) + (k === 'heap' ? 2 : 0);
  const flags = [];
  if (rows.some(x => x.nan || x.inf)) flags.push('NaN/Inf pixels');
  for (const [k, tol] of [['geo', 0.02], ['tex', 0.02], ['prog', 0.02], ['objs', 0.02], ['heap', 0.15]]) if (grow(k, tol)) flags.push(`${k} grew ${a[k]} -> ${b[k]} after the first half`);
  if (rows.some(x => x.err)) flags.push('world error');
  // (the browser's own notices are not the world's: WebGL 1 deprecation, driver stalls from the probe's read-backs)
  const pageErr = errors.filter(e => !/fed \d\/\d|WebGL 1 support was deprecated|GL Driver Message|KHR_parallel_shader_compile/.test(e));
  if (pageErr.length) flags.push(`${pageErr.length} console errors/warnings`);
  console.log(`== ${WORLD}: ${flags.length ? 'FLAGS: ' + flags.join('; ') : 'steady (no NaN, no growth, no errors)'}  [${((Date.now() - t0) / 1000).toFixed(0)} s]`);
  for (const e of pageErr.slice(0, 8)) console.log('  ' + e);
  await browser.close(); srv.close();
})().catch(e => { console.error(e); process.exit(1); });
