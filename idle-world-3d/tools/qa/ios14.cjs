#!/usr/bin/env node
// Opens play.html as Safari 14 on an iPad Air 3 (iOS 14.8: WebGL 1 only, no import maps) and visits worlds,
// reporting shader compile/link errors and page errors per world. NODE_PATH=$(npm root -g) node ios14.cjs <outdir> [ids...]
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
const THREE_DIR = path.join(__dirname, 'node_modules', 'three');
const OUT = process.argv[2] || 'ios14'; fs.mkdirSync(OUT, { recursive: true });
const IDS = process.argv.slice(3).length ? process.argv.slice(3) : ['reef', 'koi', 'meadow', 'island', 'jungle', 'cloudsea'];
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
  const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--disable-webgl2'] });
  const ctx = await browser.newContext({
    viewport: { width: 1112, height: 834 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true,
    userAgent: 'Mozilla/5.0 (iPad; CPU OS 14_8 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.1.2 Mobile/15E148 Safari/604.1',
  });
  const page = await ctx.newPage();
  page.setDefaultTimeout(900000);
  let logs = [];
  page.on('console', m => {
    if (m.type() !== 'error' && m.type() !== 'warning') return;
    const t = m.text();
    if (/KHR_parallel|deprecated in r153|GPU stall|GL Driver/.test(t)) return;
    // keep the error lines of shader logs, not the whole source
    const lines = t.split('\n');
    const keep = lines.filter(l => /ERROR|error|Shader Error|Program Info|VALIDATE|warning X|undeclared|no matching|syntax|not supported|Uncaught/i.test(l)).slice(0, 8);
    const ctxLines = [];
    for (const k of keep) { const m2 = k.match(/ERROR: \d+:(\d+)/); if (m2) { const n = +m2[1]; const src = lines.filter(l => new RegExp('^\\\\s*' + n + ': ').test(l)); if (src.length) ctxLines.push('   >> ' + src[0].trim().slice(0, 160)); } }
    logs.push(`[${m.type()}] ` + (keep.length ? keep.join(' | ').slice(0, 600) : t.slice(0, 300)) + (ctxLines.length ? '\n' + ctxLines.join('\n') : ''));
  });
  page.on('pageerror', e => logs.push(`[pageerror] ${e.message}`));
  await page.route('https://cdn.jsdelivr.net/npm/three@0.160.0/**', route => {
    const f = path.join(THREE_DIR, route.request().url().replace('https://cdn.jsdelivr.net/npm/three@0.160.0/', ''));
    if (!fs.existsSync(f)) return route.fulfill({ status: 404, body: '' });
    route.fulfill({ status: 200, contentType: 'text/javascript', body: fs.readFileSync(f) });
  });
  await page.route('https://fonts.googleapis.com/**', r => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  await page.route('https://fonts.gstatic.com/**', r => r.abort());
  await page.goto(`http://127.0.0.1:${port}/play.html#${IDS[0]}`);
  await page.waitForFunction(() => window.__idle && window.__idle.ready, null, { timeout: 120000 });
  const info = await page.evaluate(() => { const r = window.__idle.renderer, gl = r.getContext(); return { webgl2: r.capabilities.isWebGL2, buf: [gl.drawingBufferWidth, gl.drawingBufferHeight], halfFloat: !!gl.getExtension('OES_texture_half_float'), halfLinear: !!gl.getExtension('OES_texture_half_float_linear'), cbHalf: !!gl.getExtension('EXT_color_buffer_half_float'), varyings: gl.getParameter(gl.MAX_VARYING_VECTORS), fragUniforms: gl.getParameter(gl.MAX_FRAGMENT_UNIFORM_VECTORS), vertUniforms: gl.getParameter(gl.MAX_VERTEX_UNIFORM_VECTORS) }; });
  console.log('context', JSON.stringify(info));
  for (const id of IDS) {
    const t0 = Date.now();
    if (id !== IDS[0]) await page.evaluate(w => window.__idle.enterWorld(w), id);
    else await page.evaluate(() => window.__idle.ready);
    await page.waitForFunction(w => window.__idle.sceneId === w || window.__idle.error, id, { timeout: 900000 });
    await page.evaluate(() => window.__idle.simulate(2));
    await page.waitForTimeout(2000);
    const err = await page.evaluate(() => window.__idle.error);
    if (process.env.FEED) {
      // feeding makes food and effects at runtime: their materials compile on first draw (WebGL 1 path)
      const fed = await page.evaluate(() => { let n = 0; const W = innerWidth, H = innerHeight; for (const [fx, fy] of [[0.5, 0.6], [0.42, 0.55], [0.58, 0.65], [0.5, 0.5], [0.45, 0.7]]) if (window.__idle.feedAt(W * fx, H * fy)) n++; return n; });
      await page.waitForTimeout(4000);
      await page.evaluate(() => window.__idle.simulate(1.5));
      await page.waitForTimeout(3000);
      logs.push(`[info] fed ${fed}/5`);
    }
    await page.screenshot({ path: path.join(OUT, `${id}.png`) });
    console.log(`== ${id}: loaded in ${Math.round((Date.now() - t0) / 1000)}s${err ? ' ERROR ' + err.slice(0, 300) : ''}; ${logs.length} console problems`);
    const uniq = [...new Set(logs)];
    for (const l of uniq.slice(0, 25)) console.log('  ' + l);
    logs = [];
  }
  await browser.close(); srv.close();
})().catch(e => { console.error(e); process.exit(1); });
