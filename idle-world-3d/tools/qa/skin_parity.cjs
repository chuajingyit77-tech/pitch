#!/usr/bin/env node
// WebGL 1 vs WebGL 2 parity of skinned (bone-animated) creatures. For each world, the same seeded world is
// stepped to the same moment in two browsers (WebGL 2, and Safari 14 / WebGL 1 emulation), every SkinnedMesh is
// rendered alone from a fixed camera aimed at it, and the two silhouettes are compared (IoU = intersection over
// union; 1 = identical pose). Writes <outdir>/<world>_<n>.png (left WebGL 2, right WebGL 1, bottom XOR).
// NODE_PATH=$(npm root -g) node skin_parity.cjs <outdir> [worlds...]
//   env EVAL='<js>': page code run before the capture (a world's hook to bring on a creature that is hidden between
//   visits, e.g. EVAL='__idle.current.inst.debugGiant(32)'); only creatures actually drawn are compared.
//   env HOURS=21: the time of day (default 12), for creatures that come out only at night.
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
const THREE_DIR = path.join(__dirname, 'node_modules', 'three');
const OUT = process.argv[2] || 'skin_parity'; fs.mkdirSync(OUT, { recursive: true });
const WORLDS = process.argv.slice(3).length ? process.argv.slice(3) : ['meadow', 'island', 'cloudsea'];
const S = 160;
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg' };
const srv = http.createServer((req, res) => {
  const p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/' || p === '/index.html') {
    res.writeHead(200, { 'content-type': MIME['.html'] });
    res.end('<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0}[hidden]{display:none!important}</style></head><body>' + fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8') + '</body></html>');
    return;
  }
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
});

async function capture(port, world, gl1) {
  const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', ...(gl1 ? ['--disable-webgl2'] : [])] });
  const ctx = await browser.newContext({
    viewport: { width: 400, height: 300 }, deviceScaleFactor: 1,
    ...(gl1 ? { userAgent: 'Mozilla/5.0 (iPad; CPU OS 14_8 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.1.2 Mobile/15E148 Safari/604.1' } : {}),
  });
  const page = await ctx.newPage();
  page.setDefaultTimeout(1800000);
  const logs = [];
  page.on('console', m => { if (m.type() === 'error') logs.push(m.text().split('\n').filter(l => /ERROR|error/.test(l)).slice(0, 3).join(' | ').slice(0, 300)); });
  page.on('pageerror', e => logs.push('[pageerror] ' + e.message));
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
    let st = 4242;
    Math.random = () => { st = (st + 0x6D2B79F5) >>> 0; let t = st; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    // no frame loop: the world only moves when the probe steps it, so both browsers see the same moment
    window.requestAnimationFrame = () => 0;
  }, { scene: world, hours: +(process.env.HOURS || 12), seed: 777, quality: 'low', noUI: true });
  await page.goto(`http://127.0.0.1:${port}/`);
  await page.waitForFunction(() => window.__idle && window.__idle.ready);
  await page.evaluate(() => window.__idle.ready);
  await page.waitForFunction(w => window.__idle.sceneId === w || window.__idle.error, world);
  const res = await page.evaluate(({ S, code }) => {
    const I = window.__idle, inst = I.current.inst, THREE = I.current.env.THREE, r = I.renderer;
    I.simulate(3, 1 / 60);
    // a world's hook (EVAL), e.g. to bring on a giant that is hidden between its visits
    if (code) { (0, eval)(code); I.simulate(0.5, 1 / 60); }
    const scene = inst.scene;
    scene.updateMatrixWorld(true);
    // only creatures that are drawn: a mesh under a hidden group (a prewarm copy, a giant between visits) renders
    // nothing in either browser, and its "identical" empty silhouettes proved nothing
    const shown = o => { for (let x = o; x; x = x.parent) if (!x.visible) return false; return true; };
    const skinned = [];
    let hidden = 0;
    scene.traverse(o => { if (o.isSkinnedMesh) { if (shown(o)) skinned.push(o); else hidden++; } });
    const rt = new THREE.WebGLRenderTarget(S, S);
    const cam = new THREE.PerspectiveCamera(30, 1, 0.01, 1000);
    const px = new Uint8Array(S * S * 4);
    const bg = scene.background, fog = scene.fog;
    const out = [];
    for (const m of skinned.slice(0, 8)) {
      m.computeBoundingSphere();
      const sph = m.boundingSphere.clone().applyMatrix4(m.matrixWorld);
      if (!(sph.radius > 0) || !isFinite(sph.radius)) { out.push({ name: m.name, bad: 'sphere' }); continue; }
      const dir = new THREE.Vector3(0.6, 0.45, 0.65).normalize();
      cam.position.copy(sph.center).addScaledVector(dir, sph.radius / Math.sin(15 * Math.PI / 180) * 1.05);
      cam.lookAt(sph.center);
      cam.near = sph.radius * 0.05; cam.far = sph.radius * 20; cam.updateProjectionMatrix();
      // only this mesh (layer 31)
      const prevMask = m.layers.mask; m.layers.enable(31); cam.layers.set(31);
      scene.background = null; scene.fog = null;
      r.setRenderTarget(rt); r.setClearColor(0x000000, 0); r.clear();
      r.render(scene, cam);
      r.readRenderTargetPixels(rt, 0, 0, S, S, px);
      r.setRenderTarget(null);
      m.layers.mask = prevMask; scene.background = bg; scene.fog = fog;
      let cover = 0; const mask = new Array(S * S);
      for (let i = 0; i < S * S; i++) { const a = px[i * 4 + 3] > 8 || px[i * 4] + px[i * 4 + 1] + px[i * 4 + 2] > 6; mask[i] = a ? 1 : 0; cover += mask[i]; }
      let path = []; for (let x = m; x && !x.isScene; x = x.parent) path.push(x.name || x.type);
      out.push({ name: path.reverse().join('/'), bones: m.skeleton.bones.length, cover, mask: mask.join('') });
    }
    rt.dispose();
    return { webgl2: r.capabilities.isWebGL2, n: skinned.length, hidden, out };
  }, { S, code: process.env.EVAL || '' });
  await browser.close();
  return { ...res, logs };
}

(async () => {
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const port = srv.address().port;
  const { PNG } = (() => { try { return require('pngjs'); } catch (e) { return {}; } })();
  for (const w of WORLDS) {
    const t0 = Date.now();
    const a = await capture(port, w, false), b = await capture(port, w, true);
    console.log(`== ${w}: WebGL2=${a.webgl2} (${a.n} skinned${a.hidden ? `, ${a.hidden} hidden skipped` : ''}) vs WebGL2=${b.webgl2} (${b.n} skinned)  [${((Date.now() - t0) / 1000).toFixed(0)} s]`);
    for (const l of [...a.logs, ...b.logs].filter(Boolean).slice(0, 6)) console.log('   log: ' + l);
    for (let i = 0; i < Math.max(a.out.length, b.out.length); i++) {
      const x = a.out[i], y = b.out[i];
      if (!x || !y || !x.mask || !y.mask) { console.log(`  #${i} missing/bad`, x && x.bad, y && y.bad); continue; }
      let inter = 0, uni = 0;
      for (let k = 0; k < S * S; k++) { const p = x.mask[k] === '1', q = y.mask[k] === '1'; if (p && q) inter++; if (p || q) uni++; }
      const iou = uni ? inter / uni : 1;
      console.log(`  #${i} ${x.name} bones=${x.bones} cover ${x.cover} vs ${y.cover}  IoU=${iou.toFixed(3)}${iou < 0.9 ? '   <-- MISMATCH' : ''}`);
      if (PNG) {
        const png = new PNG({ width: S * 2, height: S * 2 });
        for (let yy = 0; yy < S; yy++) for (let xx = 0; xx < S; xx++) {
          const k = (S - 1 - yy) * S + xx; // flip: GL rows start at the bottom
          const p = x.mask[k] === '1', q = y.mask[k] === '1';
          const put = (X, Y, v) => { const o = (Y * S * 2 + X) * 4; png.data[o] = v[0]; png.data[o + 1] = v[1]; png.data[o + 2] = v[2]; png.data[o + 3] = 255; };
          put(xx, yy, p ? [230, 230, 230] : [20, 20, 30]);
          put(xx + S, yy, q ? [230, 230, 230] : [20, 20, 30]);
          put(xx, yy + S, p !== q ? [255, 40, 40] : p ? [90, 90, 90] : [20, 20, 30]);
          put(xx + S, yy + S, [20, 20, 30]);
        }
        fs.writeFileSync(path.join(OUT, `${w}_${i}.png`), PNG.sync.write(png));
      }
    }
  }
  srv.close();
})().catch(e => { console.error(e); process.exit(1); });
