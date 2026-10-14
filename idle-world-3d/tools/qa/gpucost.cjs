#!/usr/bin/env node
// GPU cost map for the iPad (A12, WebGL 1, low tier, iPad Air 3 screen). The A12 is a tile-based GPU that hides
// opaque overdraw: an opaque pixel is shaded once whatever lies behind it. What it cannot hide is every fragment of
// a cut-out (discard) or blended surface that lies in front of the opaque scene: leaves, grass cards, mist sheets,
// particles, glows. This measures, for one world and hour, in the default view:
//   - opaque: the pixels each opaque object shows (its share of the screen)
//   - cut-out and blended: the fragments each object costs (its overdraw), against the depth of the opaque scene
//   - a rough weight for each material's fragment shader (texture reads, lines of active code), so a fragment of
//     the water counts for more than one of a particle
//   - CPU-side rendering time in this browser (SwiftShader) of the scene and of the post-processing chain
// and writes a heat map of the cut-out and blended overdraw.
// NODE_PATH=$(npm root -g) node gpucost.cjs <outdir> <world:hour> [<world:hour> ...]
//   env: VW/VH CSS viewport (default 1112x834, the iPad Air 3 in landscape), DPR (default 2), TOP (rows listed, 14)
// Writes <outdir>/<world>_<hour>_cost.json, _overdraw.png (black = only opaque; blue -> green -> yellow -> red =
// 1, 2-3, 4-7, 8+ cut-out/blended fragments over the pixel), _where.png (where the 16 costliest objects are, numbered
// as listed: blue opaque, green cut-out, orange blended) and _shot.png. Labels end with the object's screen box
// @left,top,right,bottom in percent.
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
const THREE_DIR = path.join(__dirname, 'node_modules', 'three');
const OUT = process.argv[2];
const JOBS = process.argv.slice(3).map(j => { const [id, h] = j.split(':'); return { id, h: +(h ?? 12) }; });
if (!OUT || !JOBS.length) { console.error('usage: gpucost.cjs <outdir> <world:hour> [...]'); process.exit(2); }
const VW = +(process.env.VW || 1112), VH = +(process.env.VH || 834), DPR = +(process.env.DPR || 2), TOP = +(process.env.TOP || 14);
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

// runs in the page
function measure() {
  const I = window.__idle, inst = I.current.inst, THREE = I.current.env.THREE, r = I.renderer, gl = r.getContext();
  const scene = inst.scene, cam = inst.camera;
  const size = r.getDrawingBufferSize(new THREE.Vector2());
  const W = size.x, H = size.y, N = W * H;
  const finish = () => { const px = new Uint8Array(4); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); };
  const time = (fn, reps = 3) => { let best = Infinity; for (let k = 0; k < reps; k++) { finish(); const a = performance.now(); fn(); finish(); best = Math.min(best, performance.now() - a); } return best; };

  // the frame as it is shown: whole frame, and the world alone into a target of the same size
  I.renderNow();
  const tFrame = time(() => I.renderNow());
  const rtScene = new THREE.WebGLRenderTarget(W, H, { type: THREE.HalfFloatType });
  const tScene = time(() => { r.setRenderTarget(rtScene); r.clear(); r.render(scene, cam); r.setRenderTarget(null); });
  rtScene.dispose();

  // what gets drawn: the objects three would draw from this camera
  const frustum = new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse));
  const items = [];
  scene.updateMatrixWorld();
  scene.traverseVisible(o => {
    if (!(o.isMesh || o.isPoints || o.isSprite) || !o.layers.test(cam.layers)) return;
    if (o.frustumCulled && !(o.isSprite ? frustum.intersectsSprite(o) : frustum.intersectsObject(o))) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    if (!mats.some(m => m && m.visible)) return;
    items.push({ o, mats });
  });
  // a material's class on the A12: blended, cut-out (discard in its fragment shader) or opaque
  const progOf = m => { const p = r.properties.get(m); return p && p.currentProgram; };
  const fragSrc = m => {
    const p = progOf(m);
    if (!p) return '';
    const sh = gl.getAttachedShaders(p.program) || [];
    for (const s of sh) if (gl.getShaderParameter(s, gl.SHADER_TYPE) === gl.FRAGMENT_SHADER) return gl.getShaderSource(s) || '';
    return '';
  };
  // the fragment shader with its inactive #if branches removed (three's chunks are full of them), then counted
  const activeCode = src => {
    const defs = new Map(), out = [], stack = [];
    const evalCond = e => {
      e = e.replace(/defined\s*\(\s*(\w+)\s*\)/g, (_, n) => (defs.has(n) ? ' 1 ' : ' 0 ')).replace(/defined\s+(\w+)/g, (_, n) => (defs.has(n) ? ' 1 ' : ' 0 '));
      e = e.replace(/\b[A-Za-z_]\w*\b/g, n => { const v = defs.get(n); return v !== undefined && /^[\d.\s()+\-*/]+$/.test(v || '1') ? `(${v || 1})` : '0'; });
      if (!/^[\d\s()+\-*/<>=!&|.]*$/.test(e)) return false;
      try { return !!Function(`return (${e});`)(); } catch (err) { return false; }
    };
    const active = () => stack.every(s => s.on);
    for (const raw of src.split('\n')) {
      const line = raw.replace(/\/\/.*$/, '').trim();
      let m;
      if ((m = line.match(/^#\s*ifdef\s+(\w+)/))) { stack.push({ on: active() && defs.has(m[1]), done: defs.has(m[1]) }); continue; }
      if ((m = line.match(/^#\s*ifndef\s+(\w+)/))) { stack.push({ on: active() && !defs.has(m[1]), done: !defs.has(m[1]) }); continue; }
      if ((m = line.match(/^#\s*if\s+(.*)/))) { const c = evalCond(m[1]); stack.push({ on: active() && c, done: c }); continue; }
      if ((m = line.match(/^#\s*elif\s+(.*)/))) { const top = stack[stack.length - 1]; if (top) { const parent = stack.slice(0, -1).every(s => s.on); const c = !top.done && evalCond(m[1]); top.on = parent && c; top.done = top.done || c; } continue; }
      if (/^#\s*else\b/.test(line)) { const top = stack[stack.length - 1]; if (top) { const parent = stack.slice(0, -1).every(s => s.on); top.on = parent && !top.done; top.done = true; } continue; }
      if (/^#\s*endif\b/.test(line)) { stack.pop(); continue; }
      if (!active()) continue;
      if ((m = line.match(/^#\s*define\s+(\w+)\s*(.*)$/))) { defs.set(m[1], m[2].trim()); continue; }
      if ((m = line.match(/^#\s*undef\s+(\w+)/))) { defs.delete(m[1]); continue; }
      if (line && !line.startsWith('#') && !/^(uniform|varying|attribute|precision|in |out )/.test(line)) out.push(line);
    }
    const code = out.join('\n');
    const taps = (code.match(/\b(texture2D|textureCube|texture2DLodEXT|textureCubeLodEXT|texture2DGradEXT|texture|textureLod)\s*\(/g) || []).length;
    const loops = (code.match(/\bfor\s*\(/g) || []).length;
    return { lines: out.length, taps, loops, discard: /\bdiscard\b/.test(code) };
  };
  const matInfo = new Map();
  const infoOf = m => {
    if (!matInfo.has(m)) {
      const src = fragSrc(m), a = src ? activeCode(src) : { lines: 0, taps: 0, loops: 0, discard: false };
      const blended = m.transparent && m.blending !== THREE.NoBlending;
      const cut = !blended && (m.alphaTest > 0 || a.discard || (m.isShaderMaterial && /\bdiscard\b/.test(m.fragmentShader)));
      // a rough fragment weight: 1 + 0.02 per active line + 0.5 per texture read (a full PBR material ~ 6-9)
      matInfo.set(m, { type: m.type, name: m.name || '', cls: blended ? 'blend' : cut ? 'cut' : 'opaque', ...a, weight: +(1 + a.lines * 0.02 + a.taps * 0.5).toFixed(2) });
    }
    return matInfo.get(m);
  };
  for (const it of items) it.info = it.mats.map(m => (m ? infoOf(m) : null));
  for (const it of items) it.cls = it.info.some(i => i && i.cls === 'blend') ? 'blend' : it.info.some(i => i && i.cls === 'cut') ? 'cut' : 'opaque';

  // stand-in materials with each original's own vertex stage: 'id' writes an object id (and depth), 'count' adds one
  // per fragment
  const ID_FS = 'uniform vec3 uGpuId;\nvoid main(){ gl_FragColor = vec4(uGpuId, 1.0); }';
  const COUNT_FS = 'void main(){ gl_FragColor = vec4(1.0 / 255.0, 0.0, 0.0, 1.0); }';
  const made = [];
  const variant = (m, kind, idColor) => {
    let c;
    const fs = kind === 'id' ? ID_FS : COUNT_FS;
    if (m.isShaderMaterial) {
      const uniforms = Object.assign({}, m.uniforms);
      if (kind === 'id') uniforms.uGpuId = { value: idColor };
      c = new (m.isRawShaderMaterial ? THREE.RawShaderMaterial : THREE.ShaderMaterial)({
        vertexShader: m.vertexShader, fragmentShader: (m.isRawShaderMaterial ? 'precision highp float;\n' : '') + fs,
        uniforms, defines: Object.assign({}, m.defines), side: m.side,
      });
      c.extensions = Object.assign({}, m.extensions);
    } else {
      const ud = m.userData; m.userData = {};
      c = m.clone();
      m.userData = ud; c.userData = ud;
      const ob = m.onBeforeCompile, key = m.customProgramCacheKey();
      c.onBeforeCompile = function (sh, rr) { ob.call(m, sh, rr); sh.fragmentShader = fs; if (kind === 'id') sh.uniforms.uGpuId = { value: idColor }; };
      c.customProgramCacheKey = () => `gpucost-${kind}|${key}`;
    }
    c.side = m.side;
    if (kind === 'id') { c.transparent = false; c.blending = THREE.NoBlending; c.depthWrite = true; c.depthTest = true; c.colorWrite = true; }
    else { c.transparent = true; c.blending = THREE.CustomBlending; c.blendSrc = THREE.OneFactor; c.blendDst = THREE.OneFactor; c.blendEquation = THREE.AddEquation; c.depthWrite = false; c.depthTest = m.depthTest; c.colorWrite = true; }
    made.push(c);
    return c;
  };
  const saved = items.map(it => ({ o: it.o, material: it.o.material, visible: it.o.visible }));
  const bg = scene.background, fog = scene.fog, autoClear = r.autoClear;
  scene.background = null;
  const rt = new THREE.WebGLRenderTarget(W, H, { depthBuffer: true });
  const px = new Uint8Array(N * 4);
  // where each object is on screen: a small coverage mask (MW x MH) and its bounding box in screen percent
  const MW = 120, MH = Math.round(120 * H / W);
  const cover = (it, test) => {
    const mask = new Uint8Array(MW * MH);
    let x0 = W, y0 = H, x1 = -1, y1 = -1;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (!test(y * W + x)) continue;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      mask[Math.min(MH - 1, Math.floor((H - 1 - y) * MH / H)) * MW + Math.min(MW - 1, Math.floor(x * MW / W))] = 1;
    }
    it.mask = mask;
    it.box = x1 < 0 ? null : [Math.round(x0 / W * 100), Math.round((1 - (y1 + 1) / H) * 100), Math.round((x1 + 1) / W * 100), Math.round((1 - y0 / H) * 100)];
  };
  const show = list => { for (const it of items) it.o.visible = false; for (const it of list) it.o.visible = true; };
  const setMats = (it, kind, idColor) => { it.o.material = Array.isArray(it.material0) ? it.material0.map(m => variant(m, kind, idColor)) : variant(it.material0, kind, idColor); };
  items.forEach((it, i) => { it.material0 = it.o.material; it.i = i; });
  // 1) opaque scene: ids and depth
  const opaque = items.filter(it => it.cls === 'opaque'), rest = items.filter(it => it.cls !== 'opaque');
  opaque.forEach((it, k) => { const id = k + 1; setMats(it, 'id', new THREE.Color((id & 255) / 255, ((id >> 8) & 255) / 255, ((id >> 16) & 255) / 255)); });
  show(opaque);
  r.setRenderTarget(rt);
  r.setClearColor(0x000000, 0); r.clear(true, true, true);
  r.render(scene, cam);
  gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, px);
  const opaquePx = new Float64Array(opaque.length + 1);
  for (let i = 0; i < N; i++) opaquePx[px[i * 4] | (px[i * 4 + 1] << 8) | (px[i * 4 + 2] << 16)]++;
  const idAt = i => px[i * 4] | (px[i * 4 + 1] << 8) | (px[i * 4 + 2] << 16);
  opaque.forEach((it, k) => { it.frags = opaquePx[k + 1]; });
  // masks of the opaque objects that cost the most (the rest are not listed anyway)
  for (const it of opaque.slice().sort((a, b) => b.frags - a.frags).slice(0, 24)) { const id = opaque.indexOf(it) + 1; cover(it, i => idAt(i) === id); }
  const emptyPx = opaquePx[0];
  // 2) each cut-out or blended object alone against that depth (r.clear(true, false, false) keeps the depth)
  r.autoClear = false;
  const heat = new Uint16Array(N);
  for (const it of rest) {
    setMats(it, 'count');
    show([it]);
    r.clear(true, false, false);
    r.render(scene, cam);
    gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, px);
    let s = 0;
    for (let i = 0; i < N; i++) { const v = px[i * 4]; if (v) { s += v; heat[i] += v; } }
    it.frags = s;
    if (s > N * 0.002) cover(it, i => px[i * 4] > 0);
  }
  r.setRenderTarget(null);
  r.autoClear = autoClear;
  rt.dispose();
  for (const s of saved) { s.o.material = s.material; s.o.visible = s.visible; }
  scene.background = bg; scene.fog = fog;
  for (const c of made) c.dispose();
  // heat map: rows flipped (GL is bottom-up)
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const cx = cv.getContext('2d'), img = cx.createImageData(W, H);
  const ramp = v => (v === 0 ? [0, 0, 0] : v === 1 ? [30, 60, 200] : v <= 3 ? [30, 170, 80] : v <= 7 ? [230, 210, 40] : [230, 40, 30]);
  let heatSum = 0, heatOver4 = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const v = heat[(H - 1 - y) * W + x], c = ramp(v), d = (y * W + x) * 4;
    heatSum += v; if (v >= 4) heatOver4++;
    img.data[d] = c[0]; img.data[d + 1] = c[1]; img.data[d + 2] = c[2]; img.data[d + 3] = 255;
  }
  cx.putImageData(img, 0, 0);
  const label = it => {
    const o = it.o, names = [];
    for (let p = o; p && p !== scene; p = p.parent) if (p.name) { names.push(p.name); if (names.length === 2) break; }
    const m0 = it.mats[0] || {}, tex = m0.map || (m0.uniforms && Object.values(m0.uniforms).map(u => u && u.value).find(v => v && v.isTexture));
    const g = o.geometry, verts = g && g.attributes.position ? g.attributes.position.count : 0;
    const kind = o.isInstancedMesh ? `inst x${o.count}` : o.isPoints ? `points ${Math.min(verts, g.drawRange.count)}` : o.isSkinnedMesh ? 'skinned' : o.isSprite ? 'sprite' : 'mesh';
    const what = names.join(' < ') || m0.name || (tex && tex.name) || `${g ? g.type.replace('Geometry', '') : ''} ${verts}v`;
    return `${what} [${kind}; ${it.info.map(i => (i ? i.type.replace('Material', '') : '-')).join(',')}]${it.box ? ` @${it.box.join(',')}` : ''}`;
  };
  const rows = items.map(it => {
    const w = Math.max(...it.info.map(i => (i ? i.weight : 1)));
    return { label: label(it), cls: it.cls, frags: it.frags, perPixel: +(it.frags / N).toFixed(4), weight: w, cost: +(it.frags * w / N).toFixed(4),
      taps: Math.max(...it.info.map(i => (i ? i.taps : 0))), lines: Math.max(...it.info.map(i => (i ? i.lines : 0))), loops: Math.max(...it.info.map(i => (i ? i.loops : 0))) };
  }).filter(x => x.frags > 0);
  // contact sheet: the 16 costliest objects, where they are on screen (numbered as listed)
  const ranked = items.filter(it => it.frags > 0).map(it => ({ it, cost: it.frags * Math.max(...it.info.map(i => (i ? i.weight : 1))) })).sort((a, b) => b.cost - a.cost).slice(0, 16);
  const sheet = document.createElement('canvas'); sheet.width = MW * 4 + 15; sheet.height = MH * 4 + 15;
  const sx = sheet.getContext('2d');
  sx.fillStyle = '#333'; sx.fillRect(0, 0, sheet.width, sheet.height);
  const tile = sx.createImageData(MW, MH);
  ranked.forEach(({ it }, k) => {
    const ox = (k % 4) * (MW + 5), oy = Math.floor(k / 4) * (MH + 5);
    const col = it.cls === 'opaque' ? [120, 200, 255] : it.cls === 'cut' ? [120, 255, 120] : [255, 160, 60];
    for (let i = 0; i < MW * MH; i++) { const on = it.mask && it.mask[i]; tile.data[i * 4] = on ? col[0] : 18; tile.data[i * 4 + 1] = on ? col[1] : 18; tile.data[i * 4 + 2] = on ? col[2] : 18; tile.data[i * 4 + 3] = 255; }
    sx.putImageData(tile, ox, oy);
    sx.fillStyle = '#fff'; sx.font = '11px sans-serif'; sx.fillText(String(k + 1), ox + 3, oy + 12);
  });
  const sum = cls => rows.filter(x => x.cls === cls).reduce((a, x) => ({ frags: a.frags + x.frags, cost: a.cost + x.cost }), { frags: 0, cost: 0 });
  return {
    W, H, objects: items.length, emptyPx, tFrame: +tFrame.toFixed(1), tScene: +tScene.toFixed(1),
    opaque: sum('opaque'), cut: sum('cut'), blend: sum('blend'), heatPerPixel: +(heatSum / N).toFixed(3), heatOver4: +(heatOver4 / N).toFixed(4),
    rows, heatmap: cv.toDataURL('image/png'), sheet: sheet.toDataURL('image/png'), ranked: ranked.map(({ it }) => label(it)),
  };
}

(async () => {
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const port = srv.address().port;
  const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--disable-webgl2'] });
  for (const job of JOBS) {
    const ctx = await browser.newContext({ viewport: { width: VW, height: VH }, deviceScaleFactor: DPR,
      userAgent: 'Mozilla/5.0 (iPad; CPU OS 14_8 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.1.2 Mobile/15E148 Safari/604.1' });
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
    await page.addInitScript(cfg => { window.__IDLE_TEST__ = cfg; try { localStorage.clear(); } catch (e) {} },
      { scene: job.id, hours: job.h, seed: 777, quality: 'low', noUI: true, noIdle: true, manualClock: true });
    await page.goto(`http://127.0.0.1:${port}/`);
    await page.waitForFunction(() => window.__idle && window.__idle.ready);
    await page.evaluate(() => window.__idle.ready);
    await page.waitForFunction(w => window.__idle.sceneId === w || window.__idle.error, job.id);
    await page.evaluate(() => window.__idle.simulate(3));
    const tag = `${job.id}_${String(job.h).replace('.', '_')}`;
    await page.evaluate(() => window.__idle.renderNow());
    await page.screenshot({ path: path.join(OUT, `${tag}_shot.png`) });
    const res = await page.evaluate(measure);
    fs.writeFileSync(path.join(OUT, `${tag}_overdraw.png`), Buffer.from(res.heatmap.split(',')[1], 'base64'));
    fs.writeFileSync(path.join(OUT, `${tag}_where.png`), Buffer.from(res.sheet.split(',')[1], 'base64'));
    delete res.heatmap; delete res.sheet;
    res.rows.sort((a, b) => b.cost - a.cost);
    fs.writeFileSync(path.join(OUT, `${tag}_cost.json`), JSON.stringify(res, null, 1));
    const f = x => x.toFixed(2);
    console.log(`== ${job.id} ${job.h}:00  buffer ${res.W}x${res.H} (${(res.W * res.H / 1e6).toFixed(2)} MP), ${res.objects} objects drawn; this browser: frame ${res.tFrame} ms, world alone ${res.tScene} ms`);
    console.log(`  per screen pixel: opaque ${f(res.opaque.frags / (res.W * res.H))} (weighted ${f(res.opaque.cost)}), cut-out ${f(res.cut.frags / (res.W * res.H))} (${f(res.cut.cost)}), blended ${f(res.blend.frags / (res.W * res.H))} (${f(res.blend.cost)}); sky/empty ${f(res.emptyPx / (res.W * res.H))}; overdraw >= 4 on ${(res.heatOver4 * 100).toFixed(1)}% of the screen`);
    for (const x of res.rows.slice(0, TOP)) console.log(`  ${x.cls.padEnd(6)} ${f(x.perPixel).padStart(6)} px/px  w ${f(x.weight).padStart(5)} (${String(x.taps).padStart(2)} taps ${String(x.lines).padStart(4)} lines${x.loops ? ` ${x.loops} loops` : ''})  = ${f(x.cost).padStart(5)}  ${x.label.slice(0, 110)}`);
    if (errors.length) console.log(errors.slice(0, 5).join('\n'));
    await ctx.close();
  }
  await browser.close(); srv.close();
})().catch(e => { console.error(e); process.exit(1); });
