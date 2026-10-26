#!/usr/bin/env node
// Renders a guardian's portrait for the lessons board (assets/guardians/<id>.jpg, 256×256): the world at a given
// hour, the guardian called in and turned to the camera as it is in a lesson, then a close view of its head and neck
// from the side it faces. High tier, WebGL 2 (multisampled), straight from the drawing buffer.
// NODE_PATH=$(npm root -g) node portrait.cjs [--world koi] [--id heron] [--hours 16.5] [--seed 777] [--dist 0.8]
//   [--lift 0.05] [--aim -0.03] [--side -0.5] [--out <file.jpg>] [--png <raw.png>]
// (the defaults made assets/guardians/heron.jpg: the head in profile against the water and the garden, side -0.5 turning
// the camera round from the side the heron faces)
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path'), os = require('os');
const { execFileSync } = require('child_process');
const ROOT = path.resolve(__dirname, '..', '..');
const THREE_DIR = path.join(__dirname, 'node_modules', 'three');
const args = {};
for (let i = 2; i < process.argv.length; i++) if (process.argv[i].startsWith('--')) { const k = process.argv[i].slice(2); const v = process.argv[i + 1]; if (v === undefined || v.startsWith('--')) args[k] = true; else { args[k] = v; i++; } }
const WORLD = args.world || 'koi', ID = args.id || 'heron', HOURS = +(args.hours || 16.5), SEED = +(args.seed || 777);
const OUTJPG = path.resolve(args.out || path.join(ROOT, 'assets', 'guardians', ID + '.jpg'));
const RAW = path.resolve(args.png || path.join(os.tmpdir(), `portrait_${ID}.png`));
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
  const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const ctx = await browser.newContext({ viewport: { width: 760, height: 760 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  page.setDefaultTimeout(0);
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
    window.__IDLE_TEST__ = { scene: cfg.world, hours: cfg.hours, seed: cfg.seed, quality: 'high', noUI: true, noIdle: true, manualClock: true };
    try { localStorage.clear(); } catch (e) {}
  }, { world: WORLD, hours: HOURS, seed: SEED });
  await page.goto(`http://127.0.0.1:${srv.address().port}/`);
  await page.waitForFunction(() => window.__idle && window.__idle.ready);
  await page.evaluate(() => window.__idle.ready);
  await page.waitForFunction(w => window.__idle.sceneId === w || window.__idle.error, WORLD);
  const url = await page.evaluate(o => {
    const I = window.__idle, inst = I.current.inst, a = inst.guardian, THREE = I.current.env.THREE;
    if (!a) throw new Error('no guardian in ' + o.world);
    a.talk(true);
    for (let i = 0; i < 40 * 30 && a.state() !== 'ready'; i++) I.frame(1 / 30, false);
    for (let i = 0; i < 6 * 30; i++) I.frame(1 / 30, false);
    // close on the head and neck, from the side the guardian faces (the default camera's side), a little above
    const cam = inst.camera, head = new THREE.Vector3();
    a.anchor(head); head.y -= 0.24;
    const dir = cam.position.clone().sub(head).setY(0).normalize().applyAxisAngle(new THREE.Vector3(0, 1, 0), o.side);
    inst.view.custom = true;
    const aim = head.clone(); aim.y += o.aim;
    const place = () => { cam.position.copy(head).addScaledVector(dir, o.dist); cam.position.y += o.lift; cam.lookAt(aim); cam.fov = 30; cam.updateProjectionMatrix(); cam.updateMatrixWorld(); };
    place();
    for (let i = 0; i < 4; i++) { I.frame(1 / 30, false); place(); }
    I.renderNow();
    const gl = I.renderer.getContext(), W = gl.drawingBufferWidth, H = gl.drawingBufferHeight;
    const px = new Uint8Array(W * H * 4); gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, px);
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const cx = cv.getContext('2d'), img = cx.createImageData(W, H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const s = ((H - 1 - y) * W + x) * 4, d = (y * W + x) * 4; img.data[d] = px[s]; img.data[d + 1] = px[s + 1]; img.data[d + 2] = px[s + 2]; img.data[d + 3] = 255; }
    cx.putImageData(img, 0, 0);
    return cv.toDataURL('image/png');
  }, { world: WORLD, dist: +(args.dist || 0.8), lift: +(args.lift || 0.05), aim: +(args.aim || -0.03), side: args.side !== undefined ? +args.side : -0.5 });
  fs.writeFileSync(RAW, Buffer.from(url.split(',')[1], 'base64'));
  fs.mkdirSync(path.dirname(OUTJPG), { recursive: true });
  execFileSync('python3', ['-I', '-c', `from PIL import Image; im=Image.open(${JSON.stringify(RAW)}).convert('RGB'); w,h=im.size; s=min(w,h); im=im.crop(((w-s)//2,(h-s)//2,(w-s)//2+s,(h-s)//2+s)).resize((256,256), Image.LANCZOS); im.save(${JSON.stringify(OUTJPG)}, quality=86, optimize=True)`]);
  console.log(`${OUTJPG} (${fs.statSync(OUTJPG).size} bytes), raw ${RAW}${logs.length ? ' | ' + logs.slice(0, 3).join(' | ') : ''}`);
  await browser.close(); srv.close();
})().catch(e => { console.error(e); process.exit(1); });
