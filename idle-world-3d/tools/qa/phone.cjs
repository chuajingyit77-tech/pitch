#!/usr/bin/env node
// Screenshot harness for 栖境 (idle-world-3d).
// Usage:
//   NODE_PATH=$(npm root -g) node shoot.cjs --scene koi --hours 14 --out /tmp/koi.png
// Options:
//   --scene <id>        world id (reef|koi|meadow|island|jungle|cloudsea)
//   --hours 9,14,19,23  one screenshot per hour value (suffix _h<hour> added when several)
//   --out <file.png>    output path (default ./shot.png)
//   --w 1280 --h 720    viewport
//   --quality high|medium|low
//   --seed <n>          world seed (default 12345)
//   --wait <ms>         extra wall-clock wait before each screenshot (default 1500)
//   --sim <seconds>     simulate N seconds (no rendering) before each screenshot (default 2)
//   --feed <n>          click-feed n times around the screen centre before simulating
//   --ui                keep the HUD visible (default hidden)
//   --view '{"yaw":0.3,"pitch":0.4,"dist":12}'  override camera rig
//   --eval '<js>'       run JS in the page after load (e.g. to tweak state)
//   --root <dir>        project dir (default: this repository's idle-world-3d)
// phone.cjs variant: emulates an iPhone 13 (390x844 @3x, touch, mobile UA) and leaves quality on 'auto'.
const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');

const args = {};
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (a.startsWith('--')) { const k = a.slice(2); const v = process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[++i] : true; args[k] = v; }
}
const ROOT = args.root || path.resolve(__dirname, '..', '..');
const THREE_DIR = path.join(__dirname, 'node_modules', 'three');
const W = 390, H = 844;
const OUT = args.out || './shot.png';
const hoursList = args.hours ? String(args.hours).split(',').map(Number) : [14];
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.glb': 'model/gltf-binary', '.hdr': 'application/octet-stream', '.css': 'text/css', '.webp': 'image/webp', '.ktx2': 'application/octet-stream' };

function serve() {
  return new Promise(res => {
    const srv = http.createServer((req, resp) => {
      let p = decodeURIComponent(req.url.split('?')[0]);
      if (p === '/' || p === '/index.html') {
        const body = '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><style>:root{color-scheme:light}body{margin:0;font:14px system-ui}img{max-width:100%}[hidden]{display:none!important}</style></head><body>' + fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8') + '</body></html>';
        resp.writeHead(200, { 'content-type': MIME['.html'] }); resp.end(body); return;
      }
      const f = path.join(ROOT, p);
      if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { resp.writeHead(404); resp.end('nf'); return; }
      resp.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream' });
      fs.createReadStream(f).pipe(resp);
    });
    srv.listen(0, '127.0.0.1', () => res(srv));
  });
}

(async () => {
  const srv = await serve();
  const port = srv.address().port;
  const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const { devices } = require('playwright');
  const ctx = await browser.newContext({ ...devices['iPhone 13'] });
  const page = await ctx.newPage();
  page.setDefaultTimeout(240000);
  const logs = [];
  page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') logs.push(`[${m.type()}] ${m.text()}`); });
  page.on('pageerror', e => logs.push(`[pageerror] ${e.message}\n${e.stack || ''}`));
  await page.route('https://cdn.jsdelivr.net/npm/three@0.160.0/**', route => {
    const rel = route.request().url().replace('https://cdn.jsdelivr.net/npm/three@0.160.0/', '');
    const f = path.join(THREE_DIR, rel);
    if (!fs.existsSync(f)) return route.fulfill({ status: 404, body: 'nf' });
    route.fulfill({ status: 200, contentType: 'text/javascript', body: fs.readFileSync(f) });
  });
  await page.route('https://fonts.googleapis.com/**', r => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  await page.route('https://fonts.gstatic.com/**', r => r.abort());
  await page.addInitScript(cfg => { window.__IDLE_TEST__ = cfg; try { localStorage.clear(); } catch (e) {} }, {
    scene: args.scene || 'reef', hours: hoursList[0], seed: +(args.seed || 12345), quality: args.quality || 'auto', noUI: !args.ui, noIdle: !!args.ui,
  });
  const t0 = Date.now();
  await page.goto(`http://127.0.0.1:${port}/`);
  await page.waitForFunction(() => window.__idle && window.__idle.ready, null, { timeout: 60000 });
  await page.evaluate(() => window.__idle.ready);
  const err = await page.evaluate(() => window.__idle.error);
  console.log(`loaded ${args.scene} in ${Date.now() - t0}ms${err ? ' ERROR: ' + err : ''}`);
  if (args.eval) await page.evaluate(args.eval);
  if (args.view) await page.evaluate(v => window.__idle.setView(v), JSON.parse(args.view));
  for (const hr of hoursList) {
    await page.evaluate(h => window.__idle.setHours(h), hr);
    const feed = +(args.feed || 0);
    for (let i = 0; i < feed; i++) {
      const x = W * (0.35 + Math.random() * 0.3), y = H * (0.4 + Math.random() * 0.3);
      await page.evaluate(([x, y]) => window.__idle.feedAt(x, y), [x, y]);
    }
    await page.evaluate(s => window.__idle.simulate(s), +(args.sim ?? 2));
    await page.waitForTimeout(+(args.wait || 1500));
    const fps = await page.evaluate(() => new Promise(r => { let n = 0; const s = performance.now(); const f = () => { n++; if (performance.now() - s > 1000) r(n / ((performance.now() - s) / 1000)); else requestAnimationFrame(f); }; requestAnimationFrame(f); }));
    const info = await page.evaluate(() => { const r = window.__idle.renderer, gl = r.getContext(); return { buf: [gl.drawingBufferWidth, gl.drawingBufferHeight], pr: +r.getPixelRatio().toFixed(3), dpr: devicePixelRatio, ua: navigator.userAgent.slice(0, 40) }; });
    console.log('render', JSON.stringify(info));
    const out = hoursList.length > 1 ? OUT.replace(/\.png$/, `_h${hr}.png`) : OUT;
    await page.screenshot({ path: out, timeout: 240000 });
    console.log(`shot ${out} (hours ${hr}, ~${fps.toFixed(1)} fps in software GL)`);
  }
  const err2 = await page.evaluate(() => window.__idle.error);
  if (err2) logs.push('[__idle.error] ' + err2);
  if (logs.length) console.log(logs.slice(0, 30).join('\n'));
  await browser.close();
  srv.close();
})().catch(e => { console.error(e); process.exit(1); });
