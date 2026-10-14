#!/usr/bin/env node
// 24-hour light sweep: the iPad follows the real clock all day, so every change of light (dawn, dusk, lamps coming
// on, the moon, environment maps refreshing, fog and sky palettes) must glide; nothing may pop. This walks a world
// through the day a few minutes at a time (the clock set as the shell sets it, the world simulated in between so its
// own easing runs), renders a small frame each step and measures how much the picture changes from one step to the
// next: the mean brightness and the mean colour of each of 12 regions (4 x 3). A jump is a step that changes much
// more than the steps around it.
// A jump is a step that stands out from the steps on either side of it (3x the larger of them), or a spike (a step
// and its reverse); the steady steps of a fast dawn or dusk are not jumps, a lamp or a swapped environment map on top
// of them is.
// The world's own life moves on by --sim seconds a step, so a giant swimming past or a glow breathing also changes a
// step. The day is therefore walked twice (--passes), the second time 97 s further on and at 1.37 x the pace of the
// world's own time, so nothing periodic in it lines up again: a jump at the same hour in both passes comes from the
// clock; one in a single pass is a passing event of the world's life.
// NODE_PATH=$(npm root -g) node daysweep.cjs <outdir> <world> [--from 0] [--to 24] [--step 2] [--sim 1] [--gl1 1] [--shots n]
//     [--passes 2] [--from-json <world>_sweep.json]
//   --step  minutes of the day per step; --sim: seconds simulated per step; --shots n: a screenshot every n steps of the
//   first pass (default every half hour), to look at a jump
// Writes <outdir>/<world>_sweep.csv (hour, brightness, regions; first pass), <world>_sweep.json (every pass) and
// <world>_<hh.hh>.png, and prints the jumps that came from the clock, with their hours.
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
const THREE_DIR = path.join(__dirname, 'node_modules', 'three');
const OUT = process.argv[2], WORLD = process.argv[3];
if (!OUT || !WORLD) { console.error('usage: daysweep.cjs <outdir> <world> [--from 0] [--to 24] [--step 2] [--sim 1] [--gl1 1]'); process.exit(2); }
const args = {};
for (let i = 4; i < process.argv.length; i++) if (process.argv[i].startsWith('--')) { args[process.argv[i].slice(2)] = process.argv[i + 1]; i++; }
const FROM = +(args.from ?? 0), TO = +(args.to ?? 24), STEP = +(args.step || 2), SIM = +(args.sim || 1), GL1 = args.gl1 !== undefined;
const SHOTS = +(args.shots || 0);   // a screenshot every SHOTS steps (default: every half hour of the day)
const PASSES = Math.max(1, +(args.passes || 2)), OFFSET = 97;   // passes over the day; world seconds between them
const VW = 192, VH = 108;
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
  // a second look at a saved sweep: --from-json <world>_sweep.json (nothing is rendered or written)
  if (args['from-json']) return analyse(JSON.parse(fs.readFileSync(args['from-json'], 'utf8')), Date.now(), null, false);
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
  await page.addInitScript(cfg => {
    window.__IDLE_TEST__ = cfg;
    try { localStorage.clear(); } catch (e) {}
  }, { scene: WORLD, hours: FROM, seed: 777, quality: 'low', noUI: true, noIdle: true, manualClock: true });
  await page.goto(`http://127.0.0.1:${port}/`);
  await page.waitForFunction(() => window.__idle && window.__idle.ready);
  await page.evaluate(() => window.__idle.ready);
  await page.waitForFunction(w => window.__idle.sceneId === w || window.__idle.error, WORLD);
  await page.evaluate(() => window.__idle.simulate(4));
  const t0 = Date.now();
  const n = Math.round((TO - FROM) * 60 / STEP);
  const passes = [];
  for (let pass = 0; pass < PASSES; pass++) {
    if (pass) await page.evaluate(s => window.__idle.simulate(s, 1 / 30), OFFSET);
    const sim = SIM * (1 + 0.37 * pass);
    const rows = [];
    passes.push(rows);
    for (let k = 0; k <= n; k++) {
      const h = FROM + k * STEP / 60;
      const r = await page.evaluate(({ h, sim }) => {
        const I = window.__idle;
        I.setHours(((h % 24) + 24) % 24);
        I.simulate(sim, 1 / 30);
        I.renderNow();
        const gl = I.renderer.getContext();
        const W = gl.drawingBufferWidth, H = gl.drawingBufferHeight;
        const px = new Uint8Array(W * H * 4);
        gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, px);
        const reg = new Float64Array(12 * 3), cnt = new Float64Array(12);
        let L = 0;
        for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
          const i = (y * W + x) * 4, rr = px[i] / 255, gg = px[i + 1] / 255, bb = px[i + 2] / 255;
          L += 0.2126 * rr + 0.7152 * gg + 0.0722 * bb;
          const g = Math.min(2, Math.floor((1 - y / H) * 3)) * 4 + Math.min(3, Math.floor(x / W * 4)); // row 0 = top
          reg[g * 3] += rr; reg[g * 3 + 1] += gg; reg[g * 3 + 2] += bb; cnt[g]++;
        }
        for (let g = 0; g < 12; g++) for (let c = 0; c < 3; c++) reg[g * 3 + c] /= cnt[g];
        return { L: L / (W * H), reg: Array.from(reg), err: I.error || null };
      }, { h, sim });
      rows.push({ h, ...r });
      if (!pass && (SHOTS ? k % SHOTS === 0 : (Math.abs(((h * 2) % 1)) < 1e-6 || Math.abs(((h * 2) % 1) - 1) < 1e-6))) await page.screenshot({ path: path.join(OUT, `${WORLD}_${(h % 24).toFixed(3).padStart(6, '0')}.png`) });
      if (r.err) { console.log('world error: ' + r.err.slice(0, 300)); break; }
    }
  }
  return analyse(passes, t0, async () => { if (errors.length) console.log(errors.slice(0, 5).join('\n')); await browser.close(); srv.close(); });
})().catch(e => { console.error(e); process.exit(1); });

async function analyse(passes, t0, done, write = true) {
  // jumps: a step 3x the larger of the steps on either side (the screen's brightness, or any one region's), or a
  // spike: a step and its reverse, both 3x the steps outside them
  const jumpsOf = rows => {
    const series = [rows.map(r => r.L), ...Array.from({ length: 12 }, (_, g) => rows.map(r => 0.2126 * r.reg[g * 3] + 0.7152 * r.reg[g * 3 + 1] + 0.0722 * r.reg[g * 3 + 2]))];
    const out = [];
    for (let i = 1; i < rows.length; i++) {
      let hit = null;
      series.forEach((v, j) => {
        const floor = j ? 0.03 : 0.006;
        const d = k => (k >= 1 && k < v.length ? v[k] - v[k - 1] : 0);
        const a = Math.abs(d(i)), side = Math.max(Math.abs(d(i - 1)), Math.abs(d(i + 1)));
        const step = a > floor && a > 3 * side;
        const spike = a > floor && Math.abs(d(i + 1)) > floor && d(i) * d(i + 1) < 0 && Math.min(a, Math.abs(d(i + 1))) > 3 * Math.max(Math.abs(d(i - 1)), Math.abs(d(i + 2)));
        if ((step || spike) && (!hit || a > Math.abs(hit.d))) hit = { j, d: d(i), side, spike };
      });
      if (hit) out.push({ i, h: rows[i].h % 24, what: hit.j ? `region ${hit.j - 1}` : 'screen', d: hit.d, side: hit.side, spike: hit.spike });
    }
    return out;
  };
  const all = passes.map(jumpsOf);
  // from the clock: the same jump (step +-1, same region, same way, within 2x) in every pass; the rest are events of
  // the world's own life (at night two busy passes would otherwise often coincide somewhere)
  const same = (p, q) => Math.abs(q.i - p.i) <= 1 && q.what === p.what && q.d * p.d > 0 && Math.abs(q.d) < 2 * Math.abs(p.d) && Math.abs(p.d) < 2 * Math.abs(q.d);
  const pops = all[0].filter(p => all.every(js => js.some(q => same(p, q))));
  const events = all.reduce((s, js) => s + js.length, 0) - pops.length * all.length;
  const rows = passes[0];
  if (write) {
    const csv = ['hour,brightness,' + Array.from({ length: 12 }, (_, g) => `r${g}`).join(',')];
    for (const r of rows) csv.push(`${(r.h % 24).toFixed(3)},${r.L.toFixed(4)},` + Array.from({ length: 12 }, (_, g) => (0.2126 * r.reg[g * 3] + 0.7152 * r.reg[g * 3 + 1] + 0.0722 * r.reg[g * 3 + 2]).toFixed(4)).join(','));
    fs.writeFileSync(path.join(OUT, `${WORLD}_sweep.csv`), csv.join('\n'));
    // every pass, for a second look without walking the day again
    fs.writeFileSync(path.join(OUT, `${WORLD}_sweep.json`), JSON.stringify(passes.map(rows => rows.map(r => ({ h: +r.h.toFixed(4), L: +r.L.toFixed(5), reg: r.reg.map(v => +v.toFixed(5)) })))));
  }
  const hh = x => { const h = ((x % 24) + 24) % 24, m = Math.round((h - Math.floor(h)) * 60); return `${String(Math.floor(h) + (m === 60 ? 1 : 0)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`; };
  console.log(`== ${WORLD}${GL1 ? ' [webgl1]' : ''}: ${rows.length} steps of ${STEP} min (${hh(FROM)}-${hh(TO)}) x ${passes.length} passes: ${pops.length} jumps from the clock` +
    `${passes.length > 1 ? `, ${events} passing events of the world's life` : ''}  [${((Date.now() - t0) / 1000).toFixed(0)} s]`);
  for (const p of pops.slice(0, 30)) console.log(`  ${hh(p.h)}  ${p.what} ${p.d >= 0 ? '+' : ''}${p.d.toFixed(4)} (steps either side: ${p.side.toFixed(4)})${p.spike ? ', and back' : ''}`);
  if (done) await done();
}
