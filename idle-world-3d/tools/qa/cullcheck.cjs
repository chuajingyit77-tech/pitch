#!/usr/bin/env node
// Proves that drawing only the part of a field that is in view (windowedInstances in scenes/meadow/flora.js) never
// changes the picture: every view is rendered twice from the same frozen state, once with the view window and
// once with whole fields, and the two scene renders must match pixel for pixel. Also prints the triangles saved.
// NODE_PATH=$(npm root -g) node cullcheck.cjs [world=meadow] [--gl2 1] [--hours 15]
//   Views: the camera rig's whole range (yaw, zoom, pitch) at calm and at the strongest wind with offerings pressing
//   the grass, plus free cameras outside the rig's range (looking sideways, down, from inside the field).
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
const THREE_DIR = path.join(__dirname, 'node_modules', 'three');
const WORLD = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'meadow';
const args = {};
for (let i = 2; i < process.argv.length; i++) if (process.argv[i].startsWith('--')) { args[process.argv[i].slice(2)] = process.argv[i + 1]; i++; }
const GL2 = args.gl2 !== undefined, HOURS = +(args.hours || 15);
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
  const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', ...(GL2 ? [] : ['--disable-webgl2'])] });
  const ctx = await browser.newContext({
    viewport: { width: 1112, height: 834 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true,
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
  await page.evaluate(() => window.__idle.simulate(2));
  const t0 = Date.now();
  const res = await page.evaluate(() => {
    const I = window.__idle, inst = I.current.inst, THREE = I.current.env.THREE, r = I.renderer, cam = inst.camera, scene = inst.scene;
    const fields = [];
    scene.traverse(o => { if (o.isInstancedMesh && o.userData.cull) fields.push(o); });
    if (!fields.length) return { err: 'no windowed fields in this world' };
    const U = fields[0].material.userData.U;
    const v = inst.view, T = new THREE.Vector3(v.target.x, v.target.y, v.target.z);
    inst.view.custom = true; // the camera stays where it is put
    const W = 400, H = 300;
    const rt = new THREE.WebGLRenderTarget(W, H);
    const a = new Uint8Array(W * H * 4), b = new Uint8Array(W * H * 4);
    const shot = (cull, out) => {
      for (const f of fields) f.userData.cull.enabled = cull;
      const ar = r.info.autoReset; r.info.autoReset = false; r.info.reset();
      r.setRenderTarget(rt); r.render(scene, cam); r.setRenderTarget(null);
      const tris = r.info.render.triangles; r.info.autoReset = ar;
      r.readRenderTargetPixels(rt, 0, 0, W, H, out);
      return tris;
    };
    const views = [];
    for (const yaw of [-0.8, -0.4, 0, 0.4, 0.8]) for (const dist of [8, 16, 26]) for (const pitch of [0.02, 0.3, 0.55]) views.push({ yaw, dist, pitch });
    // free cameras: sideways, straight down, inside the field, from far away, looking back toward the pivot
    const free = [
      { p: [T.x + 6, T.y + 0.6, T.z + 4], t: [T.x + 40, T.y, T.z + 4] },
      { p: [T.x - 6, T.y + 0.6, T.z + 4], t: [T.x - 40, T.y, T.z - 10] },
      { p: [T.x, T.y + 30, T.z + 2], t: [T.x, T.y, T.z] },
      { p: [T.x + 3, T.y + 0.3, T.z - 6], t: [T.x + 3, T.y + 0.3, T.z + 30] },
      { p: [T.x + 60, T.y + 20, T.z - 60], t: [T.x, T.y, T.z] },
      { p: [T.x, T.y + 1.2, T.z - 30], t: [T.x - 20, T.y, T.z - 80] },
    ];
    // and a few random ones (fixed seed)
    let seed = 7;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < 8; i++) {
      const p = [T.x + (rnd() - 0.5) * 60, T.y + 0.4 + rnd() * 14, T.z + (rnd() - 0.5) * 60], a = rnd() * Math.PI * 2;
      free.push({ p, t: [p[0] + Math.sin(a) * 20, T.y + (rnd() - 0.6) * 8, p[2] + Math.cos(a) * 20] });
    }
    const rows = [];
    let worst = 0, tA = 0, tB = 0;
    // calm: the wind as it is; storm: the strongest wind and four offerings pressing the grass around the target;
    // edge: strongest wind, offerings just outside the left and right edges of the view (pressed grass leans in)
    for (const wind of ['calm', 'storm', 'edge']) {
      const keep = { str: U.uWindStr.value, press: U.uPress.value.map(p => p.clone()) };
      if (wind !== 'calm') U.uWindStr.value = 2.1;
      if (wind === 'storm') {
        U.uPress.value[0].set(T.x, T.y, T.z, 0.9); U.uPress.value[1].set(T.x + 2, T.y, T.z + 5, 0.9);
        U.uPress.value[2].set(T.x - 3, T.y, T.z + 2, 0.9); U.uPress.value[3].set(T.x + 1, T.y, T.z - 3, 0.9);
      }
      const all = [...views.map(x => ({ rig: x })), ...free.map(x => ({ free: x }))];
      for (const vw of all) {
        if (vw.rig) {
          const cp = Math.cos(vw.rig.pitch);
          cam.position.set(T.x + vw.rig.dist * cp * Math.sin(vw.rig.yaw), T.y + vw.rig.dist * Math.sin(vw.rig.pitch), T.z + vw.rig.dist * cp * Math.cos(vw.rig.yaw));
          if (v.minY !== undefined && cam.position.y < v.minY) cam.position.y = v.minY;
          cam.lookAt(T);
        } else { cam.position.fromArray(vw.free.p); cam.lookAt(new THREE.Vector3().fromArray(vw.free.t)); }
        cam.updateMatrixWorld();
        if (wind === 'edge') {
          const fw = new THREE.Vector3(); cam.getWorldDirection(fw); fw.y = 0; fw.normalize();
          const rt2 = new THREE.Vector3(-fw.z, 0, fw.x), th = Math.tan(cam.fov * Math.PI / 360) * cam.aspect;
          [4, 8, 14, 22].forEach((d, j) => {
            const side = j % 2 ? 1 : -1, p = cam.position.clone().addScaledVector(fw, d).addScaledVector(rt2, side * (d * th + 1.2));
            U.uPress.value[j].set(p.x, T.y, p.z, 0.9);
          });
        }
        const tc = shot(true, a), tf = shot(false, b);
        let diff = 0, maxd = 0;
        for (let i = 0; i < a.length; i++) { const d = Math.abs(a[i] - b[i]); if (d) { diff++; if (d > maxd) maxd = d; } }
        worst = Math.max(worst, diff);
        tA += tc; tB += tf;
        rows.push(`${wind} ${vw.rig ? `yaw ${vw.rig.yaw} dist ${vw.rig.dist} pitch ${vw.rig.pitch}` : `free ${vw.free.p.map(x => x.toFixed(0))} -> ${vw.free.t.map(x => x.toFixed(0))}`}: ${diff ? `DIFF ${diff} values (max ${maxd})` : 'identical'} · ${(tc / 1000).toFixed(0)}k of ${(tf / 1000).toFixed(0)}k triangles`);
      }
      U.uWindStr.value = keep.str; keep.press.forEach((p, i) => U.uPress.value[i].copy(p));
    }
    for (const f of fields) f.userData.cull.enabled = true;
    rt.dispose();
    return { rows, worst, tA, tB, n: rows.length, fields: fields.length };
  });
  if (res.err) { console.log(`${WORLD}: ${res.err}`); process.exit(1); }
  for (const r of res.rows) console.log('  ' + r);
  console.log(`== ${WORLD}${GL2 ? ' [webgl2]' : ' [webgl1]'}: ${res.n} views, ${res.fields} windowed fields: ${res.worst ? 'MISMATCH (worst ' + res.worst + ' values)' : 'every view identical'}; scene triangles ${(res.tA / res.n / 1000).toFixed(0)}k vs ${(res.tB / res.n / 1000).toFixed(0)}k drawn whole (${(100 * (1 - res.tA / res.tB)).toFixed(0)}% fewer) [${((Date.now() - t0) / 1000).toFixed(0)} s]`);
  if (logs.length) console.log(logs.slice(0, 5).join('\n'));
  await browser.close(); srv.close();
  process.exit(res.worst ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
