#!/usr/bin/env node
// Visit every world in one page (tests world switching + dispose), screenshot each, report errors and GPU memory.
// NODE_PATH=$(npm root -g) node tour.cjs [outdir] [reef:13 koi:21.5 ...]
const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const THREE_DIR = path.join(__dirname, 'node_modules', 'three');
const OUT = process.argv[2] || path.join(process.cwd(), 'qa-out', 'tour');
const JOBS = (process.argv.slice(3).length ? process.argv.slice(3) : ['reef:13', 'koi:21.5', 'meadow:17.6', 'island:13', 'jungle:12', 'cloudsea:18'])
  .map(j => { const [id, h] = j.split(':'); return { id, h: +h }; });
fs.mkdirSync(OUT, { recursive: true });
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.glb': 'model/gltf-binary', '.hdr': 'application/octet-stream' };

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
  const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 960, height: 540 }, deviceScaleFactor: 1 });
  page.setDefaultTimeout(600000);
  let logs = [];
  page.on('console', m => { if (m.type() === 'error') logs.push(`[console] ${m.text()}`); });
  page.on('pageerror', e => logs.push(`[pageerror] ${e.message}`));
  await page.route('https://cdn.jsdelivr.net/npm/three@0.160.0/**', route => {
    const f = path.join(THREE_DIR, route.request().url().replace('https://cdn.jsdelivr.net/npm/three@0.160.0/', ''));
    if (!fs.existsSync(f)) return route.fulfill({ status: 404, body: '' });
    route.fulfill({ status: 200, contentType: 'text/javascript', body: fs.readFileSync(f) });
  });
  await page.route('https://fonts.googleapis.com/**', r => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  await page.route('https://fonts.gstatic.com/**', r => r.abort());
  await page.addInitScript(cfg => { window.__IDLE_TEST__ = cfg; try { localStorage.clear(); } catch (e) {} }, { scene: JOBS[0].id, hours: JOBS[0].h, seed: 20261012, quality: 'high', noUI: true });
  const t0 = Date.now();
  await page.goto(`http://127.0.0.1:${port}/`);
  await page.waitForFunction(() => window.__idle && window.__idle.ready);
  await page.evaluate(() => window.__idle.ready);
  for (let i = 0; i < JOBS.length; i++) {
    const { id, h } = JOBS[i];
    const t1 = Date.now();
    await page.evaluate(hh => window.__idle.setHours(hh), h);
    if (i > 0) await page.evaluate(wid => window.__idle.enterWorld(wid), id);
    const state = await page.evaluate(() => ({ id: window.__idle.sceneId, err: window.__idle.error }));
    await page.evaluate(() => window.__idle.simulate(4));
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(OUT, `${id}.png`), timeout: 600000 });
    const mem = await page.evaluate(() => { const i = window.__idle.renderer.info; return { geo: i.memory.geometries, tex: i.memory.textures, calls: i.render.calls, tris: i.render.triangles, progs: i.programs ? i.programs.length : -1 }; });
    console.log(`${id} @${h}h: loaded as ${state.id}${state.err ? ' ERROR ' + state.err.slice(0, 300) : ''} in ${((Date.now() - t1) / 1000).toFixed(0)}s · mem ${JSON.stringify(mem)}`);
    if (logs.length) { console.log('  ' + logs.slice(0, 8).join('\n  ')); logs = []; }
  }
  // come back to the first world to check that re-entering after dispose still works
  await page.evaluate(wid => window.__idle.enterWorld(wid), JOBS[0].id);
  const back = await page.evaluate(() => ({ id: window.__idle.sceneId, err: window.__idle.error, mem: window.__idle.renderer.info.memory }));
  console.log(`back to ${back.id}${back.err ? ' ERROR ' + back.err.slice(0, 300) : ''} · mem ${JSON.stringify(back.mem)}`);
  if (logs.length) console.log('  ' + logs.slice(0, 8).join('\n  '));
  console.log(`total ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  await browser.close();
  srv.close();
})().catch(e => { console.error(e); process.exit(1); });
