#!/usr/bin/env node
// Motion probe. Steps a world through the test harness's simulate() (no rendering, so it is quick even on
// software GL), tracks everything that moves (scene objects and InstancedMesh instances) and reports
// per-mover motion statistics, at one or more time steps so frame-rate dependence shows up.
//
// NODE_PATH=$(npm root -g) node motion.cjs <outdir> <world> [options]
//   --fps 60,30      time steps to compare (frames per second); default 60,30
//   --secs 20        seconds recorded per run (after warm-up); default 20
//   --warm 4         seconds simulated before recording; default 4
//   --hours 12       time of day; default 12
//   --q low          quality tier (high|medium|low); default low (the iPad / phone tier)
//   --feed 6         feed at this many seconds into the recording (5 taps around the screen centre); off by default
//   --max 400        most movers tracked (InstancedMesh: at most 24 instances each); default 400
//   --seed 777       world seed; default 777 (Math.random is seeded too, so runs repeat exactly)
//
// Per mover (path = scene-graph path, #i = instance index):
//   spd50/spd95  median / 95th-percentile speed (world units per second)
//   rot95/rotMax angular speed (rad/s) 95th percentile / max
//   snaps        steps that rotate more than 0.6 rad (34°) at once — a visible snap at any frame rate
//   jumps        steps that move more than 6× the 90th-percentile step and > 0.25 units — a teleport / pop
//   acc50/acc99  acceleration magnitude percentiles (units/s²); a large acc99/acc50 means jerky motion
//   axis         the local axis that best follows the direction of travel (+z, -x …)
//   mis/mis90    mean / 90th-percentile angle (deg) between that axis and the direction of travel while moving;
//                high values = sliding sideways or backwards, body not following its path
//   side%        share of moving steps more than 45° off that axis
// Then per mover across time steps: mean speed and mean turn-rate ratios (lowest fps / highest fps) and the change of
// the mean misalignment; differences beyond ±20 % (or 10°) are flagged as frame-rate dependence. With --feed the
// comparison covers the time before the feeding: the race for the pellets that follows parts two runs at different
// time steps (another fish wins a pellet by one step) whether or not anything depends on the frame rate.
// Writes <outdir>/<world>_<fps>.json and prints a ranked summary.
const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const THREE_DIR = path.join(__dirname, 'node_modules', 'three');
const OUT = process.argv[2];
const WORLD = process.argv[3];
if (!OUT || !WORLD) { console.error('usage: motion.cjs <outdir> <world> [--fps 60,30] [--secs 20] [--warm 4] [--hours 12] [--q low] [--feed s] [--max 400] [--seed 777]'); process.exit(2); }
const args = {};
for (let i = 4; i < process.argv.length; i++) { const a = process.argv[i]; if (a.startsWith('--')) { args[a.slice(2)] = process.argv[i + 1]; i++; } }
const FPS = (args.fps || '60,30').split(',').map(Number);
const CFG = { secs: +(args.secs || 20), warm: +(args.warm || 4), feed: args.feed !== undefined ? +args.feed : -1, max: +(args.max || 400) };
const HOURS = +(args.hours || 12), Q = args.q || 'low', SEED = +(args.seed || 777);
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

// runs inside the page: warm up, pick movers, record, compute statistics
async function probe(cfg) {
  const I = window.__idle, cur = I.current, THREE = cur.env.THREE;
  const scene = cur.inst.scene, dt = cfg.dt;
  I.simulate(cfg.warm, dt);
  scene.updateMatrixWorld(true);
  const all = [];
  // a fish's blended fin pass (lib/fish.js addFinPass) shares the fish's instance data: not a mover of its own
  scene.traverse(o => { if (!o.isBone && !o.isLight && !o.isCamera && !o.isScene && !o.userData.finPass) all.push(o); });
  const v = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3(), m = new THREE.Matrix4();
  const l0 = new Map(), w0 = new Map(), i0 = new Map();
  for (const o of all) {
    l0.set(o, o.position.clone());
    o.matrixWorld.decompose(v, q, s); w0.set(o, v.clone());
    if (o.isInstancedMesh && o.count <= 4000) i0.set(o, Float32Array.from(o.instanceMatrix.array.subarray(0, o.count * 16)));
  }
  I.simulate(1, dt);
  scene.updateMatrixWorld(true);
  const pathOf = o => {
    const parts = [];
    for (let x = o; x && !x.isScene; x = x.parent) {
      const idx = x.parent ? x.parent.children.indexOf(x) : 0;
      parts.push(x.name ? `${x.name}` : `${x.type}[${idx}]`);
    }
    return parts.reverse().join('/');
  };
  const movers = [];
  for (const o of all) {
    if (o.isInstancedMesh) continue;
    o.matrixWorld.decompose(v, q, s);
    if (o.position.distanceTo(l0.get(o)) > 0.005 && v.distanceTo(w0.get(o)) > 0.005) movers.push({ o, i: -1, key: pathOf(o) });
  }
  for (const [o, a0] of i0) {
    const a1 = o.instanceMatrix.array; let n = 0;
    for (let i = 0; i < Math.min(o.count, a0.length / 16) && n < 24; i++) {
      const d = Math.hypot(a1[i * 16 + 12] - a0[i * 16 + 12], a1[i * 16 + 13] - a0[i * 16 + 13], a1[i * 16 + 14] - a0[i * 16 + 14]);
      if (d > 0.005) { movers.push({ o, i, key: pathOf(o) + '#' + i }); n++; }
    }
  }
  movers.length = Math.min(movers.length, cfg.max);
  const steps = Math.round(cfg.secs / dt);
  const rec = movers.map(() => new Float64Array(steps * 7));
  const read = (mv, out, k) => {
    if (mv.i < 0) mv.o.matrixWorld.decompose(v, q, s);
    else { mv.o.getMatrixAt(mv.i, m); m.premultiply(mv.o.matrixWorld); m.decompose(v, q, s); }
    out[k * 7] = v.x; out[k * 7 + 1] = v.y; out[k * 7 + 2] = v.z;
    out[k * 7 + 3] = q.x; out[k * 7 + 4] = q.y; out[k * 7 + 5] = q.z; out[k * 7 + 6] = q.w;
  };
  const feedStep = cfg.feed >= 0 ? Math.round(cfg.feed / dt) : -1;
  let fed = 0;
  for (let k = 0; k < steps; k++) {
    if (k === feedStep) {
      const W = innerWidth, H = innerHeight;
      for (const [fx, fy] of [[0.5, 0.6], [0.42, 0.55], [0.58, 0.65], [0.5, 0.5], [0.45, 0.7]]) if (I.feedAt(W * fx, H * fy)) fed++;
    }
    I.simulate(dt, dt);
    scene.updateMatrixWorld(true);
    for (let j = 0; j < movers.length; j++) read(movers[j], rec[j], k);
  }
  const pct = (arr, p) => { if (!arr.length) return 0; const a = Float64Array.from(arr).sort(); return a[Math.min(a.length - 1, Math.floor(p * a.length))]; };
  const AX = { '+x': [1, 0, 0], '-x': [-1, 0, 0], '+y': [0, 1, 0], '-y': [0, -1, 0], '+z': [0, 0, 1], '-z': [0, 0, -1] };
  // statistics of one mover over steps [k0, k1)
  const stats = (r, k0, k1) => {
    const d = [], sp = [], rot = [], acc = [];
    let px = 0, py = 0, pz = 0, snaps = 0;
    for (let k = k0 + 1; k < k1; k++) {
      const dx = r[k * 7] - r[(k - 1) * 7], dy = r[k * 7 + 1] - r[(k - 1) * 7 + 1], dz = r[k * 7 + 2] - r[(k - 1) * 7 + 2];
      const dd = Math.hypot(dx, dy, dz);
      d.push(dd); sp.push(dd / dt);
      const dot = Math.abs(r[k * 7 + 3] * r[(k - 1) * 7 + 3] + r[k * 7 + 4] * r[(k - 1) * 7 + 4] + r[k * 7 + 5] * r[(k - 1) * 7 + 5] + r[k * 7 + 6] * r[(k - 1) * 7 + 6]);
      const ang = 2 * Math.acos(Math.min(1, dot));
      rot.push(ang / dt);
      if (ang > 0.6) snaps++;
      if (k > k0 + 1) acc.push(Math.hypot(dx / dt - px, dy / dt - py, dz / dt - pz) / dt);
      px = dx / dt; py = dy / dt; pz = dz / dt;
    }
    const d90 = pct(d, 0.9);
    let jumps = 0;
    for (const dd of d) if (dd > Math.max(6 * d90, 0.25)) jumps++;
    // heading: which local axis follows the direction of travel
    const sp90 = pct(sp, 0.9), thr = Math.max(0.3 * sp90, 0.03);
    const sums = {}; for (const a in AX) sums[a] = [];
    for (let k = k0 + 1; k < k1; k++) {
      const dx = r[k * 7] - r[(k - 1) * 7], dy = r[k * 7 + 1] - r[(k - 1) * 7 + 1], dz = r[k * 7 + 2] - r[(k - 1) * 7 + 2];
      const dd = Math.hypot(dx, dy, dz);
      if (dd / dt < thr) continue;
      q.set(r[k * 7 + 3], r[k * 7 + 4], r[k * 7 + 5], r[k * 7 + 6]);
      for (const a in AX) { v.set(...AX[a]).applyQuaternion(q); sums[a].push((v.x * dx + v.y * dy + v.z * dz) / dd); }
    }
    let axis = null, best = -2;
    for (const a in AX) { const n = sums[a].length; if (!n) continue; const mean = sums[a].reduce((x, y) => x + y, 0) / n; if (mean > best) { best = mean; axis = a; } }
    const mis = axis ? sums[axis].map(c => Math.acos(Math.max(-1, Math.min(1, c))) * 180 / Math.PI) : [];
    const mean = a => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
    return {
      spdMean: +mean(sp).toFixed(3), rotMean: +mean(rot).toFixed(3),
      spd50: +pct(sp, 0.5).toFixed(3), spd95: +pct(sp, 0.95).toFixed(3),
      rot95: +pct(rot, 0.95).toFixed(2), rotMax: +Math.max(0, ...rot).toFixed(2), snaps, jumps,
      acc50: +pct(acc, 0.5).toFixed(2), acc99: +pct(acc, 0.99).toFixed(2),
      axis, moving: mis.length, mis: mis.length ? +(mis.reduce((x, y) => x + y, 0) / mis.length).toFixed(1) : null,
      mis90: mis.length ? +pct(mis, 0.9).toFixed(1) : null, side: mis.length ? Math.round(100 * mis.filter(a => a > 45).length / mis.length) : null,
    };
  };
  // A feeding sets off a race for the pellets; which fish reaches which pellet first turns on a single step, so
  // after it two runs at different time steps part ways (different winners, different paths) even when nothing
  // depends on the frame rate. The frame-rate comparison therefore uses the time before the feeding (`pre`); the
  // whole run still counts for snaps, jumps and sliding.
  const preSteps = feedStep >= Math.round(4 / dt) ? feedStep : 0;
  const out = [];
  for (let j = 0; j < movers.length; j++) {
    const r = rec[j];
    out.push({ key: movers[j].key, type: movers[j].o.type, start: [r[0], r[1], r[2]].map(x => +x.toFixed(2)), ...stats(r, 0, steps), pre: preSteps ? stats(r, 0, preSteps) : null });
  }
  return { movers: out, fed, steps, preSecs: preSteps * dt };
}

(async () => {
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const port = srv.address().port;
  const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 320, height: 180 }, deviceScaleFactor: 1 });
  page.setDefaultTimeout(1800000);
  const logs = [];
  page.on('console', m => { if (m.type() === 'error') logs.push(`[console] ${m.text().slice(0, 300)}`); });
  page.on('pageerror', e => logs.push(`[pageerror] ${e.message}`));
  await page.route('https://cdn.jsdelivr.net/npm/three@0.160.0/**', route => {
    const f = path.join(THREE_DIR, route.request().url().replace('https://cdn.jsdelivr.net/npm/three@0.160.0/', ''));
    if (!fs.existsSync(f)) return route.fulfill({ status: 404, body: '' });
    route.fulfill({ status: 200, contentType: 'text/javascript', body: fs.readFileSync(f) });
  });
  await page.route('https://fonts.googleapis.com/**', r => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  await page.route('https://fonts.gstatic.com/**', r => r.abort());
  // No idle camera drift (both runs see the same camera), and the page's own animation loop stopped (manualClock):
  // the probe alone steps the world, so both runs start from the same state and differ only in their time step.
  await page.addInitScript(cfg => {
    window.__IDLE_TEST__ = cfg;
    try { localStorage.clear(); } catch (e) {}
    // seeded Math.random so both runs see the same world and the same decisions
    let st = 0;
    window.__reseed = n => { st = n >>> 0; };
    window.__reseed(cfg.seed);
    Math.random = () => { st = (st + 0x6D2B79F5) >>> 0; let t = st; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }, { scene: WORLD, hours: HOURS, seed: SEED, quality: Q, noUI: true, noIdle: true, manualClock: true });
  await page.goto(`http://127.0.0.1:${port}/`);
  await page.waitForFunction(() => window.__idle && window.__idle.ready);
  await page.evaluate(() => window.__idle.ready);
  const runs = {};
  for (let n = 0; n < FPS.length; n++) {
    const fps = FPS[n];
    if (n > 0) {
      // a fresh page (the init script clears storage and reseeds), so nothing from the previous run carries
      // over: residents' hunger, size and last meal live in the saved state
      await page.goto(`http://127.0.0.1:${port}/`);
      await page.waitForFunction(() => window.__idle && window.__idle.ready);
      await page.evaluate(() => window.__idle.ready);
      await page.waitForFunction(w => window.__idle.sceneId === w, WORLD);
    }
    await page.evaluate(hh => window.__idle.setHours(hh), HOURS);
    const t0 = Date.now();
    const res = await page.evaluate(probe, { ...CFG, dt: 1 / fps });
    fs.writeFileSync(path.join(OUT, `${WORLD}_${fps}.json`), JSON.stringify(res, null, 1));
    runs[fps] = res;
    console.log(`== ${WORLD} @ ${fps} fps: ${res.movers.length} movers, ${res.steps} steps${CFG.feed >= 0 ? `, fed ${res.fed}/5` : ''} (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
    const flag = x => (x.snaps ? 3 : 0) + (x.jumps ? 3 : 0) + (x.moving > 20 && x.mis90 > 40 ? 2 : 0) + (x.acc50 > 0 && x.acc99 / x.acc50 > 25 ? 1 : 0);
    const ranked = res.movers.slice().sort((a, b) => flag(b) - flag(a) || (b.mis90 || 0) - (a.mis90 || 0));
    console.log('  key | type | spd50 spd95 | rot95 rotMax snaps jumps | acc50 acc99 | axis mis mis90 side% (moving steps)');
    for (const x of ranked.slice(0, 40)) console.log(`  ${x.key} | ${x.type} | ${x.spd50} ${x.spd95} | ${x.rot95} ${x.rotMax} ${x.snaps} ${x.jumps} | ${x.acc50} ${x.acc99} | ${x.axis} ${x.mis} ${x.mis90} ${x.side}% (${x.moving})`);
    if (ranked.length > 40) console.log(`  … ${ranked.length - 40} more in ${WORLD}_${fps}.json`);
  }
  if (FPS.length > 1) {
    const hi = Math.max(...FPS), lo = Math.min(...FPS);
    // before the feeding when there is one (see `pre` in probe())
    const pick = x => x.pre || x;
    const A = new Map(runs[hi].movers.map(x => [x.key, pick(x)])), B = new Map(runs[lo].movers.map(x => [x.key, pick(x)]));
    const rows = [];
    for (const [k, a] of A) {
      const b = B.get(k); if (!b) continue;
      // means, not percentiles: distance and turning per second are the same at any time step for motion that is
      // smooth, and only per-step jitter or a per-frame rate makes them differ. (A median or 95th percentile of a
      // fish that hovers and now and then darts lands on the edge of the darts at one frame rate and not at the
      // other, and flagged fish whose motion matched step for step.)
      const sr = a.spdMean > 1e-3 ? b.spdMean / a.spdMean : null, rr = a.rotMean > 1e-2 ? b.rotMean / a.rotMean : null;
      const dm = a.mis !== null && b.mis !== null ? b.mis - a.mis : null;
      const bad = (sr !== null && Math.abs(sr - 1) > 0.2) || (rr !== null && Math.abs(rr - 1) > 0.2) || (dm !== null && Math.abs(dm) > 10);
      rows.push({ k, sr, rr, dm, bad });
    }
    const bad = rows.filter(r => r.bad);
    const pre = runs[hi].preSecs ? ` over the ${runs[hi].preSecs.toFixed(0)} s before the feeding` : '';
    console.log(`== frame-rate dependence (${lo} fps vs ${hi} fps${pre}): ${bad.length} of ${rows.length} matched movers differ`);
    for (const r of bad.slice(0, 40)) console.log(`  ${r.k}: speed×${r.sr === null ? '-' : r.sr.toFixed(2)} turn×${r.rr === null ? '-' : r.rr.toFixed(2)} misalign${r.dm === null ? ' -' : (r.dm >= 0 ? ' +' : ' ') + r.dm.toFixed(1) + '°'}`);
  }
  if (logs.length) console.log(logs.slice(0, 10).join('\n'));
  await browser.close();
  srv.close();
})().catch(e => { console.error(e); process.exit(1); });
