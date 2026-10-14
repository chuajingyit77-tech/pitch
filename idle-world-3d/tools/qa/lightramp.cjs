#!/usr/bin/env node
// Light-ramp probe: how the picture changes in real time while the clock of day moves, frame by frame, through the
// page's own clock path (a stand-in Date runs at real speed; the page's loop is stopped and the probe steps it).
// daysweep.cjs finds steps between minutes; this shows what happens within the minutes: whether each minute's change
// of light lands in a burst (a pulse every minute through dawn and dusk) or spreads evenly, and whether moving sun
// and shadows make pixels shimmer.
// NODE_PATH=$(npm root -g) node lightramp.cjs <outdir> <world> [--at 18:20] [--minutes 3] [--fps 30] [--every 3]
//     [--warm 5] [--vw 320] [--vh 180] [--gl1 1] [--q low]
//   --at       the clock (page-local) when recording starts; --minutes: how long it records
//   --fps      frames per second of the stepped world; --every: render and read back every n-th frame
//   --warm     seconds run (clock moving) before recording
//   --shots    seconds into the recording to save frames at, e.g. --shots 16.9,17.0,17.5 (<world>_<at>_<s>.png)
// Writes <outdir>/<world>_<at>_ramp.csv (t, shown hours, brightness, 12 region brightnesses) and prints:
//   change     brightness change over the window: whole screen, and the region that changed most
//   tick share for the regions that changed most: the part of each minute's change that lands in the 3 s after
//              the minute ticks over (0.05 is an even ramp; near 1, the minute's change arrives as a pulse)
//   peak 1 s   the largest change within one second (whole screen / any region) against the mean per second
//   shimmer    with --every 1: pixels per mille that swing up then down between consecutive frames (>0.04, >0.12)
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
const THREE_DIR = path.join(__dirname, 'node_modules', 'three');
const OUT = process.argv[2], WORLD = process.argv[3];
if (!OUT || !WORLD) { console.error('usage: lightramp.cjs <outdir> <world> [--at 18:20] [--minutes 3] [--fps 30] [--every 3] [--warm 5] [--gl1 1]'); process.exit(2); }
const args = {};
for (let i = 4; i < process.argv.length; i++) if (process.argv[i].startsWith('--')) { args[process.argv[i].slice(2)] = process.argv[i + 1]; i++; }
const AT = (args.at || '18:20').split(':').map(Number), MIN = +(args.minutes || 3), FPS = +(args.fps || 30), EVERY = +(args.every || 3);
const WARM = +(args.warm ?? 5), VW = +(args.vw || 320), VH = +(args.vh || 180), GL1 = args.gl1 !== undefined, Q = args.q || 'low';
const SHOTS = (args.shots || '').split(',').filter(Boolean).map(Number);
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
  const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', ...(GL1 ? ['--disable-webgl2'] : [])] });
  const ctx = await browser.newContext({
    viewport: { width: VW, height: VH }, deviceScaleFactor: 1,
    ...(GL1 ? { userAgent: 'Mozilla/5.0 (iPad; CPU OS 14_8 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.1.2 Mobile/15E148 Safari/604.1' } : {}),
  });
  const page = await ctx.newPage();
  page.setDefaultTimeout(0);
  const errors = [];
  page.on('pageerror', e => errors.push('[pageerror] ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('[error] ' + m.text().slice(0, 200)); });
  await page.route('https://cdn.jsdelivr.net/npm/three@0.160.0/**', route => {
    const f = path.join(THREE_DIR, route.request().url().replace('https://cdn.jsdelivr.net/npm/three@0.160.0/', ''));
    if (!fs.existsSync(f)) return route.fulfill({ status: 404, body: '' });
    route.fulfill({ status: 200, contentType: 'text/javascript', body: fs.readFileSync(f) });
  });
  await page.route('https://fonts.googleapis.com/**', r => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  await page.route('https://fonts.gstatic.com/**', r => r.abort());
  // the page's clock of day follows Date; this one starts WARM seconds before --at and moves only when the probe steps
  await page.addInitScript(({ cfg, at, warm }) => {
    window.__IDLE_TEST__ = cfg;
    try { localStorage.clear(); } catch (e) {}
    const RealDate = Date;
    const d0 = new RealDate(); d0.setHours(at[0], at[1] || 0, at[2] || 0, 0);   // today, at --at
    let now = d0.getTime() - warm * 1000;
    class StandIn extends RealDate {
      constructor(...a) { if (a.length) super(...a); else super(now); }
      static now() { return now; }
    }
    window.Date = StandIn;
    window.__advance = ms => { now += ms; };
  }, { cfg: { scene: WORLD, seed: 777, quality: Q, noUI: true, noIdle: true, manualClock: true }, at: AT, warm: WARM });
  await page.goto(`http://127.0.0.1:${port}/`);
  await page.waitForFunction(() => window.__idle && window.__idle.ready);
  await page.evaluate(() => window.__idle.ready);
  await page.waitForFunction(w => window.__idle.sceneId === w || window.__idle.error, WORLD);
  const dt = 1 / FPS;
  // warm up with the clock moving (the shell's clock and the world's own easing settle on the moving time)
  await page.evaluate(({ n, dt }) => { for (let k = 0; k < n; k++) { window.__advance(dt * 1000); window.__idle.frame(dt, false); } }, { n: Math.round(WARM * FPS), dt });
  const t0 = Date.now();
  const total = Math.round(MIN * 60 * FPS);
  const rows = [];
  let osc04 = 0, osc12 = 0, pairs = 0, pixels = 0;
  const CHUNK = 60;
  for (let k0 = 0; k0 < total; k0 += CHUNK) {
    const r = await page.evaluate(({ k0, n, dt, every, shotFrames }) => {
      const I = window.__idle, gl = I.renderer.getContext();
      const shots = [];
      const W = gl.drawingBufferWidth, H = gl.drawingBufferHeight;
      const px = new Uint8Array(W * H * 4);
      const out = [];
      let o04 = 0, o12 = 0, pr = 0;
      const S = window.__lr || (window.__lr = { a: null, b: null });
      for (let k = k0; k < k0 + n; k++) {
        window.__advance(dt * 1000);
        const snap = shotFrames.includes(k), show = k % every === 0 || snap;
        I.frame(dt, show);
        if (snap) shots.push({ k, url: I.renderer.domElement.toDataURL('image/png') });
        if (k % every !== 0) continue;
        gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, px);
        const L = new Float32Array(W * H), reg = new Float64Array(12), cnt = new Float64Array(12);
        let sum = 0;
        for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
          const i = y * W + x, v = (0.2126 * px[i * 4] + 0.7152 * px[i * 4 + 1] + 0.0722 * px[i * 4 + 2]) / 255;
          L[i] = v; sum += v;
          const g = Math.min(2, Math.floor((1 - y / H) * 3)) * 4 + Math.min(3, Math.floor(x / W * 4)); // row 0 = top
          reg[g] += v; cnt[g]++;
        }
        if (every === 1 && S.a && S.b) {
          const a = S.a, b = S.b;
          for (let i = 0; i < L.length; i++) {
            const d1 = b[i] - a[i], d2 = L[i] - b[i];
            if (d1 * d2 < 0) { const m = Math.min(Math.abs(d1), Math.abs(d2)); if (m > 0.04) o04++; if (m > 0.12) o12++; }
          }
          pr++;
        }
        S.a = S.b; S.b = L;
        out.push({ t: (k + 1) * dt, h: I.shownHours(), L: sum / (W * H), reg: Array.from(reg, (v, g) => v / cnt[g]) });
      }
      return { out, o04, o12, pr, pixels: W * H, err: I.error || null, shots };
    }, { k0, n: Math.min(CHUNK, total - k0), dt, every: EVERY, shotFrames: SHOTS.map(s => Math.round(s * FPS) - 1) });
    for (const sh of r.shots) fs.writeFileSync(path.join(OUT, `${WORLD}_${AT.map(v => String(v).padStart(2, '0')).join('')}_${((sh.k + 1) / FPS).toFixed(2)}.png`), Buffer.from(sh.url.split(',')[1], 'base64'));
    rows.push(...r.out);
    osc04 += r.o04; osc12 += r.o12; pairs += r.pr; pixels = r.pixels;
    if (r.err) { console.log('world error: ' + r.err.slice(0, 300)); break; }
  }
  const tag = AT.map(v => String(v).padStart(2, '0')).join('');
  const csv = ['t,hours,brightness,' + Array.from({ length: 12 }, (_, g) => `r${g}`).join(',')];
  for (const r of rows) csv.push(`${r.t.toFixed(3)},${r.h.toFixed(6)},${r.L.toFixed(5)},${r.reg.map(v => v.toFixed(5)).join(',')}`);
  fs.writeFileSync(path.join(OUT, `${WORLD}_${tag}_ramp.csv`), csv.join('\n'));
  // brightness at whole seconds (the sample nearest each)
  // (row j is frame k = j * EVERY, taken (k + 1) / FPS s after recording began)
  const at = s => rows[Math.min(rows.length - 1, Math.max(0, Math.round((s * FPS - 1) / EVERY)))];
  const secs = Math.floor(MIN * 60);
  const series = [r => r.L, ...Array.from({ length: 12 }, (_, g) => r => r.reg[g])];
  const names = ['screen', ...Array.from({ length: 12 }, (_, g) => `region ${g}`)];
  const stat = series.map((f, j) => {
    const v = Array.from({ length: secs + 1 }, (_, s) => f(at(s)));
    const d = v.slice(1).map((x, i) => x - v[i]);
    const change = v[secs] - v[0];
    // the minute ticks inside the window: the stand-in clock started WARM s before --at, which is on a whole second
    const startSec = (AT[2] || 0);
    let tickPart = 0, tickAll = 0;
    for (let s = (60 - startSec) % 60; s + 60 <= secs; s += 60) { tickPart += Math.abs(v[s + 3] - v[s]); tickAll += Math.abs(v[s + 60] - v[s]); }
    const mean = d.reduce((a, x) => a + Math.abs(x), 0) / d.length;
    const peak = Math.max(...d.map(Math.abs));
    return { name: names[j], change, share: tickAll > 0 ? tickPart / tickAll : NaN, mean, peak, peakAt: d.map(Math.abs).indexOf(peak) };
  });
  const screen = stat[0], regs = stat.slice(1).sort((a, b) => Math.abs(b.change) - Math.abs(a.change));
  const hh = h => { const m = Math.round(h * 60); return `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`; };
  console.log(`== ${WORLD}${GL1 ? ' [webgl1]' : ''} from ${hh(rows[0].h)} for ${MIN} min at ${FPS} fps (shown clock ${rows[0].h.toFixed(4)} -> ${rows[rows.length - 1].h.toFixed(4)})  [${((Date.now() - t0) / 1000).toFixed(0)} s]`);
  const line = s => `${s.name.padEnd(9)} change ${s.change >= 0 ? '+' : ''}${s.change.toFixed(4)}  tick share ${isNaN(s.share) ? '  -  ' : s.share.toFixed(2)}  peak 1 s ${s.peak.toFixed(4)} at ${s.peakAt} s (mean ${s.mean.toFixed(4)})`;
  console.log('  ' + line(screen));
  for (const s of regs.slice(0, 3)) console.log('  ' + line(s));
  if (pairs) console.log(`  shimmer: ${(osc04 / (pairs * pixels) * 1000).toFixed(3)} per mille >0.04, ${(osc12 / (pairs * pixels) * 1000).toFixed(3)} >0.12 over ${pairs} frame pairs`);
  if (errors.length) console.log(errors.slice(0, 5).join('\n'));
  await browser.close(); srv.close();
})().catch(e => { console.error(e); process.exit(1); });
