#!/usr/bin/env node
// Close-up screenshots of fish (or any InstancedMesh / named object) on the emulated iPad Air 3 (Safari 14,
// WebGL 1, low tier), with the full post-processing chain, to judge how creatures look up close.
// NODE_PATH=$(npm root -g) node closeup.cjs <outdir> <world> [--hours 15] [--n 3] [--dist 2.4] [--name <object name>]
//   Without --name it frames the first instances of the fish meshes (geometry with the aSwim attribute),
//   biggest fish first. The camera sits beside and above each fish (or object) and looks at it.
//   --dist is in body lengths. --gl2 1 renders as a WebGL 2 browser instead (A/B). Writes <outdir>/<world>_<k>.png.
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
const THREE_DIR = path.join(__dirname, 'node_modules', 'three');
const OUT = process.argv[2], WORLD = process.argv[3];
if (!OUT || !WORLD) { console.error('usage: closeup.cjs <outdir> <world> [--hours 15] [--n 3] [--dist 2.4] [--name obj]'); process.exit(2); }
const args = {};
for (let i = 4; i < process.argv.length; i++) if (process.argv[i].startsWith('--')) { args[process.argv[i].slice(2)] = process.argv[i + 1]; i++; }
const HOURS = +(args.hours || 15), N = +(args.n || 3), DIST = +(args.dist || 2.4);
fs.mkdirSync(OUT, { recursive: true });
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
  // --gl2 renders the same shot as a WebGL 2 browser (same size and tier) for an A/B comparison
  const GL2 = args.gl2 !== undefined;
  const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', ...(GL2 ? [] : ['--disable-webgl2'])] });
  const ctx = await browser.newContext({
    viewport: { width: 1112, height: 834 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true,
    ...(GL2 ? {} : { userAgent: 'Mozilla/5.0 (iPad; CPU OS 14_8 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.1.2 Mobile/15E148 Safari/604.1' }),
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
    window.__IDLE_TEST__ = { scene: cfg.world, hours: cfg.hours, seed: 12345, quality: 'low', noUI: true, noIdle: true };
    try { localStorage.clear(); } catch (e) {}
  }, { world: WORLD, hours: HOURS });
  await page.goto(`http://127.0.0.1:${port}/`);
  await page.waitForFunction(() => window.__idle && window.__idle.ready);
  await page.evaluate(() => window.__idle.ready);
  await page.waitForFunction(w => window.__idle.sceneId === w || window.__idle.error, WORLD);
  await page.evaluate(() => window.__idle.simulate(4));
  for (let k = 0; k < N; k++) {
    // pick the subject, then hold the camera on it for a few rendered frames
    const info = await page.evaluate(({ k, dist, name }) => {
      const I = window.__idle, inst = I.current.inst, THREE = I.current.env.THREE, scene = inst.scene;
      scene.updateMatrixWorld(true);
      const subjects = [];
      if (name) scene.traverse(o => { if (o.name === name) subjects.push({ o, i: -1 }); });
      else {
        // hero fish are single meshes (koi), schools are instanced (reef, jungle)
        const meshes = [];
        scene.traverse(o => {
          if (o.isInstancedMesh && o.geometry.attributes.aSwim && o.count > 0) meshes.push(o);
          else if (o.isMesh && !o.isInstancedMesh && o.visible && o.material && o.material.userData && o.material.userData.swimUniforms) subjects.push({ o, i: -1, fish: true });
        });
        meshes.sort((a, b) => b.geometry.attributes.position.count - a.geometry.attributes.position.count);
        for (const o of meshes) for (let i = 0; i < o.count; i++) subjects.push({ o, i });
      }
      if (!subjects.length) return { err: 'no subject' };
      const s = subjects[k % subjects.length];
      const m = new THREE.Matrix4(), p = new THREE.Vector3(), q = new THREE.Quaternion(), sc = new THREE.Vector3();
      const follow = () => {
        if (s.i >= 0) { s.o.getMatrixAt(s.i, m); m.premultiply(s.o.matrixWorld); } else m.copy(s.o.matrixWorld);
        m.decompose(p, q, sc);
        const len = Math.max(sc.x, sc.y, sc.z, 0.05) * (s.i >= 0 || s.fish ? 1 : 1.5);
        const side = new THREE.Vector3(0, 0, 1).applyQuaternion(q).setY(0);
        if (side.lengthSq() < 1e-4) side.set(1, 0, 0);
        side.normalize();
        const cam = inst.camera;
        cam.position.copy(p).addScaledVector(side, len * dist).add(new THREE.Vector3(0, len * dist * 0.55, 0));
        cam.lookAt(p);
        return { pos: [p.x, p.y, p.z].map(v => +v.toFixed(2)), len: +len.toFixed(3), mesh: s.o.name || s.o.type, verts: s.o.geometry.attributes.position.count };
      };
      inst.view.custom = true; // the shell's camera rig lets go of the camera
      window.__follow = follow;
      return follow();
    }, { k, dist: DIST, name: args.name || '' });
    if (info.err) { console.log(`${WORLD}: ${info.err}`); break; }
    for (let f = 0; f < 6; f++) { await page.evaluate(() => window.__follow()); await page.waitForTimeout(700); }
    await page.screenshot({ path: path.join(OUT, `${WORLD}_${k}${GL2 ? '_gl2' : ''}.png`) });
    console.log(`${WORLD}_${k}: ${JSON.stringify(info)}`);
  }
  if (logs.length) console.log(logs.slice(0, 5).join('\n'));
  await browser.close(); srv.close();
})().catch(e => { console.error(e); process.exit(1); });
