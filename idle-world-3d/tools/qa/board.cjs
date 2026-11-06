#!/usr/bin/env node
// The board of a screen connected to the company, with lessons in several courses (made-up lessons, tagged the way
// the drafting job tags them), as Safari 14 on the iPad Air 3 (WebGL 1, 1112×834 at 2×) and on a phone held upright
// (390×844 at 2×):
//   nobody signed in: one heading per course, in order (the demo lessons, the new-staff week, the lessons for everyone,
//   the advanced course, then one per role), every role's lessons but everyone's folded, counts only · someone from
//   sales signs in: their role comes right after the week and is open, the others stay folded, progress per course ·
//   展开 opens a folded course and 收起 folds it again · someone whose department is written in English (Finance)
//   gets their role too · a course opened by one person is folded again for the next · nothing scrolls sideways.
// Then the heron, called in the world with this many lessons, offers what to do next instead of every lesson:
//   iPad: the next lesson (her own courses first), the board or later · she starts it, answers wrong once and puts it
//   down · called again: carry on, the next one, the wrong answer, the board, later (A–E, all on screen) · 看全部课程
//   opens the board · phone, with the record she made on the iPad: the same five · the wrong answer again · carry on
//   from where she left off and finish it · then only the next one, the board and later · 下次再说 ends the talk.
// Ends PASS when every check holds and there were no page errors. Screenshots in <outdir>.
//
// NODE_PATH=$(npm root -g) node board.cjs <outdir>
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path'), os = require('os');
const { execFileSync } = require('child_process');
const fakebase = require('./fakebase.cjs');
const ROOT = path.resolve(__dirname, '..', '..');
const THREE_DIR = path.join(__dirname, 'node_modules', 'three');
const OUT = path.resolve(process.argv[2] || 'board-out');
fs.mkdirSync(OUT, { recursive: true });
const IPAD = 'Mozilla/5.0 (iPad; CPU OS 14_8 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.1.2 Mobile/15E148 Safari/604.1';
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 14_8 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.1.2 Mobile/15E148 Safari/604.1';
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg' };
const FONTS = path.join(os.tmpdir(), 'qijing-fonts');
fs.mkdirSync(FONTS, { recursive: true });
function fetchCached(url, ua) {
  const f = path.join(FONTS, url.replace(/[^a-z0-9.]+/gi, '_').slice(-180));
  if (!fs.existsSync(f)) { try { execFileSync('curl', ['-sS', '-m', '30', '-A', ua, '-o', f, url]); } catch (e) { return null; } }
  return fs.readFileSync(f);
}
const srv = http.createServer((req, res) => {
  const p = decodeURIComponent(req.url.split('?')[0]);
  const f = path.join(ROOT, p === '/' ? 'play.html' : p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
});
let failed = 0, checks = 0;
const ok = (cond, what, got) => { checks++; console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${what}${!cond && got !== undefined ? ' — ' + JSON.stringify(got).slice(0, 400) : ''}`); if (!cond) failed++; };

// made-up lessons in five kinds of course: [title, tags, sort]
const COURSES = [
  ['第1天 · 认识公司', ['新员工七天训练', '第1天'], 101], ['第2天 · 项目流程', ['新员工七天训练', '第2天'], 102], ['第3天 · 记录', ['新员工七天训练', '第3天'], 103],
  ['进阶1 · 从客户出发', ['进阶 · 名企之道', '全员'], 201], ['进阶2 · 复盘', ['进阶 · 名企之道', '全员'], 202],
  ['全员 · 我们卖什么', ['岗位课', '全员'], 300],
  ['营销 · 发布前先过审', ['岗位课', '营销'], 310],
  ['销售 · 收工前检查', ['岗位课', '销售'], 320], ['销售 · 验收以后', ['岗位课', '销售'], 321],
  ['财务 · 每周的事', ['岗位课', '财务'], 360],
];
const lesson = ([title, tags, sort], i) => ({
  guardian: 'heron', title, keys: '一 · 二 · 三', about: '一节用来测试课程分组的课。', minutes: 3, badge: `测试徽${'甲乙丙丁戊己庚辛壬癸'[i]}`, tags, sort,
  steps: [
    { say: '这是一节测试用的课。' },
    { ask: '哪一个是对的？', options: [{ text: '这个', ok: true, reply: '对。' }, { text: '那个', reply: '不对。' }, { text: '都不是', reply: '不对。' }] },
    { card: { title: '要点', items: [['一', '第一点'], ['二', '第二点'], ['三', '第三点']] } },
  ],
  outro: '去吧。',
});
const ORDER_NOBODY = '示范课 | 新员工七天训练 | 岗位课 · 全员 | 进阶 · 名企之道 | 岗位课 · 营销 | 岗位课 · 销售 | 岗位课 · 财务';

(async () => {
  fakebase.init();
  const fb = await fakebase.start();
  const api = async (fn, body) => (await fb.rpc(fn, body))[1];
  let browser;
  try {
    const [{ c: invite }] = await fb.sql(`select qj.new_invite('test') c`);
    const adm = (await api('admin_claim', { invite_code: invite, login_name: 'owner', password: 'secret-pass-1', display_name: '老板' })).session;
    for (const [i, c] of COURSES.entries()) {
      const [{ id }] = await fb.sql(`select qj.import_draft($1::jsonb, null) id`, [JSON.stringify(lesson(c, i))]);
      const r = await api('admin_lesson_status', { token: adm, lesson: id, status: 'published' });
      if (!r.ok) throw new Error('publishing ' + c[0]);
    }
    for (const [name, dept, pin] of [['小明', '销售部', '1234'], ['Aisha', 'Finance', '2468']]) await api('admin_save_employee', { token: adm, employee: { name, dept, pin } });
    await new Promise(r => srv.listen(0, '127.0.0.1', r));
    browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--disable-webgl2'] });
    for (const [dev, vp, ua] of [['ipad', { width: 1112, height: 834 }, IPAD], ['phone', { width: 390, height: 844 }, IPHONE]]) {
      console.log(`== ${dev}`);
      const screen = await api('admin_device', { token: adm, device_label: dev });
      const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: 2, hasTouch: true, isMobile: true, userAgent: ua });
      const page = await ctx.newPage();
      const logs = [];
      page.on('pageerror', e => logs.push('[pageerror] ' + e.message));
      page.on('console', m => { if (m.type() === 'error' && !/GPU stall|GL Driver|KHR_parallel/.test(m.text())) logs.push('[error] ' + m.text().slice(0, 200)); });
      await page.route('https://cdn.jsdelivr.net/npm/three@0.160.0/**', route => {
        const f = path.join(THREE_DIR, route.request().url().replace('https://cdn.jsdelivr.net/npm/three@0.160.0/', ''));
        if (!fs.existsSync(f)) return route.fulfill({ status: 404, body: '' });
        route.fulfill({ status: 200, contentType: 'text/javascript', body: fs.readFileSync(f) });
      });
      await page.route(/https:\/\/fonts\.(googleapis|gstatic)\.com\/.*/, route => {
        const url = route.request().url(), body = fetchCached(url, ua);
        if (!body) return route.fulfill({ status: 200, contentType: 'text/css', body: '' });
        route.fulfill({ status: 200, contentType: url.includes('googleapis') ? 'text/css' : 'font/woff2', body, headers: { 'access-control-allow-origin': '*' } });
      });
      await page.addInitScript(cfg => {
        window.__IDLE_TEST__ = { scene: 'koi', hours: 15, seed: 777, quality: 'low', noIdle: true, manualClock: true, backend: { url: cfg.url, key: 'sb_publishable_test' }, signOut: 3600e3 };
        try { localStorage.clear(); } catch (e) {}
      }, { url: fb.url });
      await page.goto(`http://127.0.0.1:${srv.address().port}/`);
      await page.waitForFunction(() => window.__idle && window.__idle.ready);
      await page.evaluate(() => window.__idle.ready);
      await page.waitForFunction(() => window.__idle.sceneId === 'koi' || window.__idle.error);
      await page.evaluate(() => document.fonts && document.fonts.ready);
      await page.evaluate(code => window.__idle.school.api.register(code, 'test'), screen.code).catch(() => {});
      for (let t = 0; t < 300 && (await page.evaluate(() => window.__idle.school.state().lessons)) === 0; t++) await page.waitForTimeout(100);
      ok(await page.evaluate(() => window.__idle.school.state().lessons) === 2 + COURSES.length, `the screen has the ${2 + COURSES.length} lessons`);
      const groups = () => page.evaluate(() => [...document.querySelectorAll('#boardList .cg')].map(h => ({
        t: h.querySelector('.cg-t').textContent, n: h.querySelector('.cg-n').textContent,
        folded: h.nextElementSibling.hidden, count: h.nextElementSibling.querySelectorAll('.ls').length })));
      const titles = g => g.map(x => x.t).join(' | ');
      const signIn = async (name, pin) => {
        await page.locator('#meBar .pill', { hasText: '登录' }).click();
        await page.waitForTimeout(300);
        await page.locator('#paneWho .nm-btn', { hasText: name }).click();
        await page.waitForTimeout(300);
        for (const dg of pin) await page.locator('#panePin .pad .k', { hasText: new RegExp(`^${dg}$`) }).click();
        for (let t = 0; t < 100 && (await page.evaluate(() => window.__idle.guide.state().learner)) !== name; t++) await page.waitForTimeout(100);
        await page.waitForTimeout(400);
      };
      await page.evaluate(() => window.__idle.guide.openBoard());
      await page.waitForTimeout(400);
      let g = await groups();
      ok(titles(g) === ORDER_NOBODY, 'nobody signed in: one heading per course, in order', titles(g));
      ok(g.filter(x => x.folded).map(x => x.t).join(',') === '岗位课 · 营销,岗位课 · 销售,岗位课 · 财务', 'every role but 全员 folded', g);
      ok(g.every(x => /^\d+ 节$/.test(x.n)), 'counts only, nobody signed in', g.map(x => x.n));
      ok(g.reduce((s, x) => s + x.count, 0) === 2 + COURSES.length, 'every lesson in a course');
      await page.screenshot({ path: path.join(OUT, `${dev}_nobody.png`) });

      await signIn('小明', '1234');
      g = await groups();
      ok(titles(g) === '示范课 | 新员工七天训练 | 岗位课 · 全员 | 岗位课 · 销售 | 进阶 · 名企之道 | 岗位课 · 营销 | 岗位课 · 财务', '小明 (销售部): his role right after the week', titles(g));
      ok(!g.find(x => x.t === '岗位课 · 销售').folded && g.find(x => x.t === '岗位课 · 营销').folded && g.find(x => x.t === '岗位课 · 财务').folded, 'his role open, the others folded', g);
      ok(g.every(x => /^已学会 0 \/ \d+$/.test(x.n)), 'progress per course', g.map(x => x.n));
      await page.screenshot({ path: path.join(OUT, `${dev}_xiaoming.png`) });
      const btn = page.locator('#boardList .cg', { hasText: '岗位课 · 营销' }).locator('.cg-b');
      ok((await btn.textContent()) === '展开' && (await btn.getAttribute('aria-expanded')) === 'false', 'a folded course offers 展开');
      await btn.click(); await page.waitForTimeout(200);
      g = await groups();
      ok(!g.find(x => x.t === '岗位课 · 营销').folded && (await btn.textContent()) === '收起' && (await btn.getAttribute('aria-expanded')) === 'true', '展开 opens it', g);
      await btn.scrollIntoViewIfNeeded(); await page.waitForTimeout(200);
      await page.screenshot({ path: path.join(OUT, `${dev}_opened.png`) });
      await btn.click(); await page.waitForTimeout(200);
      ok((await groups()).find(x => x.t === '岗位课 · 营销').folded, '收起 folds it again');
      await btn.click(); await page.waitForTimeout(200); // left open for the next check

      await page.locator('#meBar .link', { hasText: '退出' }).click();
      for (let t = 0; t < 50 && (await page.evaluate(() => window.__idle.guide.state().learner)); t++) await page.waitForTimeout(100);
      await page.waitForTimeout(300);
      await signIn('Aisha', '2468');
      g = await groups();
      ok(titles(g) === '示范课 | 新员工七天训练 | 岗位课 · 全员 | 岗位课 · 财务 | 进阶 · 名企之道 | 岗位课 · 营销 | 岗位课 · 销售', 'Aisha (Finance): her role right after the week', titles(g));
      ok(!g.find(x => x.t === '岗位课 · 财务').folded, 'her role open', g);
      ok(g.find(x => x.t === '岗位课 · 营销').folded, 'what 小明 opened is folded again for her', g);
      const sw = await page.evaluate(() => { const s = document.getElementById('boardSheet'); return s.scrollWidth - s.clientWidth; });
      ok(sw <= 0, 'nothing scrolls sideways', sw);

      // the heron called in the world (the page's own loop is stopped: frames are stepped here)
      const T = 1 / 30;
      const frames = (n, render = false) => page.evaluate(([n, dt, render]) => { for (let i = 0; i < n; i++) window.__idle.frame(dt, render && i === n - 1); }, [n, T, render]);
      const G = () => page.evaluate(() => window.__idle.guide.state());
      const call = (fn, ...a) => page.evaluate(([fn, a]) => window.__idle.guide[fn](...a), [fn, a]);
      // on through lines, the card and the banner until the choices are up (or the talk is over)
      const until = async () => {
        for (let k = 0; k < 150; k++) {
          const s = await G();
          if (s.mode !== 'talk') return s;
          if (s.typing) { await frames(18); if ((await G()).typing) await call('next'); continue; }
          if (s.after === 'opts') return s;
          if (s.after === 'next' || s.after === 'card') { await call('next'); await frames(6); continue; }
          await frames(10);
        }
        return G();
      };
      const opts = s => s.options.map(o => o.text).join(' | ');
      const shot = async name => { await frames(1, true); await page.waitForTimeout(700); await frames(1, true); await page.screenshot({ path: path.join(OUT, `${dev}_${name}.png`) }); };
      // every choice and the line above them on screen
      const onScreen = () => page.evaluate(() => [document.getElementById('talkText'), ...document.querySelectorAll('#talkOpts .opt')]
        .every(e => { const r = e.getBoundingClientRect(); return r.height > 0 && r.top >= 0 && r.bottom <= innerHeight && r.left >= 0 && r.right <= innerWidth; }));
      const FIVE = 'A接着学：第1天 · 认识公司（学到一半） | B下一课：第2天 · 项目流程 | C把答错的题再练一遍（1 题） | D看全部课程 | E下次再说';
      await page.evaluate(() => window.__idle.guide.closeBoard());
      await call('talk', 'heron');
      let s = await until();
      if (dev === 'ipad') {
        ok(opts(s) === 'A下一课：第1天 · 认识公司 | B看全部课程 | C下次再说', 'the heron, 12 lessons: the next one (her courses first, the demo ones later), the board, later', opts(s));
        ok(/^Aisha，/.test(s.text), 'it greets her by name', s.text);
        await shot('heron_next');
        await call('pick', 0);
        s = await until();
        ok(!!s.lesson && s.text === '哪一个是对的？', 'the next lesson starts', s.text);
        await call('pick', 1); // wrong
        s = await until();
        await call('close'); // put down halfway
        await frames(30);
        await call('talk', 'heron');
        s = await until();
        ok(opts(s) === FIVE, 'called again: carry on, the next one, the wrong answer, the board, later', opts(s));
        ok(await onScreen(), 'five choices, all on screen');
        await shot('heron_five');
        await call('pick', 3);
        await frames(10);
        s = await G();
        ok(s.mode === 'board' && s.pane === 'lessons' && !(await G()).lesson, '看全部课程 puts the talk away and opens the board', `${s.mode}/${s.pane}`);
        await page.evaluate(() => window.__idle.guide.closeBoard());
        // her record to the backend, for the phone
        for (let t = 0; t < 100 && (await page.evaluate(() => window.__idle.school.state().queue)); t++) { await page.evaluate(() => window.__idle.school.api.flush()); await page.waitForTimeout(100); }
        ok((await page.evaluate(() => window.__idle.school.state().queue)) === 0, 'her record sent');
      } else {
        ok(opts(s) === FIVE, 'on the phone, with her record from the iPad: the same five', opts(s));
        ok(await onScreen(), 'five choices, all on screen');
        await shot('heron_five');
        await call('pick', 2); // the wrong answer again
        s = await until();
        ok(s.review && s.text === '哪一个是对的？', 'the question she got wrong, again', s);
        await call('pick', 0);
        s = await until();
        ok(s.mode !== 'talk', 'answered right: the review is over', s.mode);
        await frames(30);
        await call('talk', 'heron');
        s = await until();
        ok(opts(s) === 'A接着学：第1天 · 认识公司（学到一半） | B下一课：第2天 · 项目流程 | C看全部课程 | D下次再说', 'the wrong answer gone from the choices', opts(s));
        await call('pick', 0);
        await frames(3);
        s = await G();
        ok(s.lesson && s.text === '我们接着上次说。', 'carry on: from where she left off', s.text);
        s = await until();
        ok(s.text === '哪一个是对的？' && s.options.length === 3, 'at the question she was on', s.text);
        await call('pick', 0);
        s = await until();
        ok(s.mode !== 'talk', 'the lesson finished', s.mode);
        await frames(30);
        await call('talk', 'heron');
        s = await until();
        ok(opts(s) === 'A下一课：第2天 · 项目流程 | B看全部课程 | C下次再说', 'then: the next one, the board, later', opts(s));
        await call('pick', 2);
        s = await until();
        ok(s.mode !== 'talk' && !s.lesson, '下次再说: the heron says goodbye and the talk ends', s.mode);
      }
      ok(logs.length === 0, 'no page errors', logs);
      await ctx.close();
    }
  } catch (e) { failed++; console.log('  ERROR', e.stack); }
  finally { if (browser) await browser.close(); srv.close(); await fb.stop(); }
  console.log(failed ? `FAIL: ${failed} of ${checks} checks` : `PASS: ${checks} checks`);
  process.exit(failed ? 1 : 0);
})();
