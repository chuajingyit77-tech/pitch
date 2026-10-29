#!/usr/bin/env node
// The admin page (admin.html), end to end, against the local stand-in for the learning backend (fakebase.cjs), in a
// desktop browser (1280×860) and on a phone held upright (390×844):
//   the first admin account from an invite code · the overview with its getting-started list · staff added one by
//   one and as a pasted list (their PINs shown once) · a shared screen's setup code and a team code with its link ·
//   a lesson drafted by an AI (the reply pasted in), checked, edited in the editor and published · the demo lessons
//   archived · learning done on a screen (through the kiosk calls) and what the reports make of it · a guardian's lines
//   · the password changed, an invite for another admin · signing out and in again.
// Ends PASS when every check holds and the page logged no errors. Screenshots of every stage in <outdir>.
//
// NODE_PATH=$(npm root -g) node admin.cjs <outdir>
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path'), os = require('os');
const { execFileSync } = require('child_process');
const fakebase = require('./fakebase.cjs');
const ROOT = path.resolve(__dirname, '..', '..');
const OUT = path.resolve(process.argv[2] || 'admin-out');
fs.mkdirSync(OUT, { recursive: true });
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg' };
const FONTS = path.join(os.tmpdir(), 'qijing-fonts');
fs.mkdirSync(FONTS, { recursive: true });
function fetchCached(url) {
  const f = path.join(FONTS, url.replace(/[^a-z0-9.]+/gi, '_').slice(-180));
  if (!fs.existsSync(f)) { try { execFileSync('curl', ['-sS', '-m', '30', '-A', UA, '-o', f, url]); } catch (e) { return null; } }
  return fs.readFileSync(f);
}
const srv = http.createServer((req, res) => {
  const p = decodeURIComponent(req.url.split('?')[0]);
  const f = path.join(ROOT, p === '/' ? 'admin.html' : p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
});
// what an AI might answer to the drafting prompt (a lesson about returns; nothing of any real company)
const AI_REPLY = '好的，下面是这节课：\n```json\n' + JSON.stringify({
  title: '退货三步走', keys: '查 · 收 · 退', about: '客人要退货时，怎么查清、收好、退得明白。', minutes: 3, badge: '退货能手',
  steps: [
    { say: '客人要退货，先别急着收。池水要先看清，才知道底下有什么。' },
    { say: '第一步，**查**：看订单、看签收日期，确认还在退货期内。' },
    { ask: '客人拿来一件已经签收 40 天的衣服要退，规定是 30 天内可退。你先做什么？', options: [
      { text: '直接收下，客人最大。', reply: '规定是保护大家的。先查清楚，再跟客人解释。' },
      { text: '查订单，跟客人说明已经过了退货期，再看能不能换或修。', ok: true, reply: '对。先查清，再给客人一条能走的路。' },
      { text: '告诉客人不行，请他走。', reply: '一句不行，客人心里的火就起来了。说明原因，再给办法。' },
    ] },
    { say: '第二步，**收**：当面检查商品，拍照留底，写清楚收到时的样子。' },
    { say: '第三步，**退**：告诉客人钱什么时候、退到哪里。' },
    { card: { title: '要点 · 退货', items: [['查', '订单与退货期'], ['收', '当面检查，拍照留底'], ['退', '说清时间和去向']] } },
  ],
  outro: '退得清楚的客人，下次还会再来。',
}, null, 2) + '\n```';

let failed = 0, checks = 0;
const ok = (cond, what, got) => { checks++; console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${what}${!cond && got !== undefined ? ' — ' + JSON.stringify(got).slice(0, 300) : ''}`); if (!cond) failed++; };

(async () => {
  fakebase.init();
  const fb = await fakebase.start();
  const api = async (fn, body) => (await fb.rpc(fn, body))[1];
  const logs = [];
  let browser;
  try {
    await new Promise(r => srv.listen(0, '127.0.0.1', r));
    const base = `http://127.0.0.1:${srv.address().port}`;
    browser = await chromium.launch();
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 }, deviceScaleFactor: 1.5, userAgent: UA, locale: 'zh-CN', timezoneId: 'Asia/Singapore' });
    await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: base });
    const page = await ctx.newPage();
    page.setDefaultTimeout(15000);
    const watch = (pg, tag) => {
      pg.on('console', m => { if (m.type() === 'error') logs.push(`[${tag}] ${m.text().slice(0, 300)}`); });
      pg.on('pageerror', e => logs.push(`[${tag} pageerror] ${e.message}`));
      pg.on('dialog', d => d.accept());
    };
    watch(page, 'desktop');
    const fonts = async pg => pg.route(/https:\/\/fonts\.(googleapis|gstatic)\.com\/.*/, route => {
      const url = route.request().url(), body = fetchCached(url);
      if (!body) return route.fulfill({ status: 200, contentType: 'text/css', body: '' });
      route.fulfill({ status: 200, contentType: url.includes('googleapis') ? 'text/css' : 'font/woff2', body, headers: { 'access-control-allow-origin': '*' } });
    });
    await fonts(page);
    const cfg = { url: fb.url };
    await page.addInitScript(c => { window.__ADMIN_TEST__ = { backend: { url: c.url, key: 'sb_publishable_test' } }; }, cfg);
    let shot = 0;
    const snap = async (name, pg = page, full = true) => {
      await pg.waitForTimeout(250);
      const f = path.join(OUT, `${String(shot++).padStart(2, '0')}_${name}.png`);
      await pg.screenshot({ path: f, fullPage: full });
      console.log(`  ${path.basename(f)}`);
    };
    const text = async sel => (await page.textContent(sel)) || '';
    const btn = (label, scope = 'body') => page.locator(`${scope} button`, { hasText: label }).first();
    const dialogBtn = label => page.locator('#dialog .foot button', { hasText: label }).first();
    const waitToast = async t => page.locator('#toasts .toast', { hasText: t }).first().waitFor();

    // ---- the first admin account, from an invite
    const [{ c: invite }] = await fb.sql(`select qj.new_invite('owner') c`);
    await page.goto(`${base}/admin.html`);
    await page.evaluate(() => document.fonts && document.fonts.ready);
    ok(await page.isVisible('#login'), 'the sign-in page first');
    await page.click('#tabClaim');
    await page.fill('#clCode', invite.toLowerCase());
    await page.fill('#clName', '陈总');
    await page.fill('#clLogin', 'chen');
    await page.fill('#clPass', 'pond-2026-heron');
    await page.fill('#clPass2', 'pond-2026-heron');
    await snap('claim', page, false);
    await page.click('#formClaim button[type=submit]');
    await page.waitForSelector('#app:not([hidden])');
    await page.waitForSelector('.steps-todo');
    await snap('overview_first');
    ok((await text('#whoAmI')) === '陈总' && (await page.$$('.todo.done')).length === 0, 'signed in; the getting-started list, nothing done yet');

    // ---- staff: one, then a pasted list
    await page.click('#tabs a[data-v=people]');
    await btn('添加员工').click();
    await page.locator('#dialog input').nth(0).fill('小明');
    await page.locator('#dialog input').nth(1).fill('客服');
    await page.locator('#dialog input').nth(2).fill('专员');
    const pin1 = await page.locator('#dialog input.mono').inputValue();
    ok(/^[0-9]{4}$/.test(pin1), 'a new employee gets a random 4-digit PIN', pin1);
    await dialogBtn('添加').click();
    await page.waitForSelector('#dialog .code');
    ok((await text('#dialog .code')) === pin1, 'the PIN is shown once to pass on');
    await snap('person_pin', page, false);
    await dialogBtn('好').click();
    await btn('批量添加').click();
    await page.fill('#dialog textarea', '小红 销售\n阿杰，客服，组长\n王芳\t财务\n李雷 销售 新人\n韩梅梅 客服\n小明 客服');
    await snap('bulk_paste', page, false);
    await dialogBtn('添加').click();
    await page.waitForSelector('#dialog h2:has-text("已添加")');
    const bulkTitle = await text('#dialog h2'), bulkLead = await text('#dialog .lead');
    ok(bulkTitle === '已添加 5 人' && bulkLead.includes('小明'), 'pasted list: 5 added, the duplicate named', { bulkTitle, bulkLead });
    const pins = await page.$$eval('#dialog td.mono', tds => tds.map(t => t.textContent));
    ok(pins.length === 5 && pins.every(p => /^[0-9]{4}$/.test(p)), 'their PINs, to print or copy', pins);
    await snap('bulk_done', page, false);
    await dialogBtn('好').click();
    await page.waitForSelector('table');
    await snap('people');
    const rows = await page.$$eval('main tbody tr', trs => trs.length);
    ok(rows === 6, 'six people on the list', rows);
    // an edit without a new PIN: saved, the dialog closes
    await page.locator('main tbody tr', { hasText: '李雷' }).locator('button', { hasText: '编辑' }).click();
    await page.locator('#dialog input').nth(2).fill('组长');
    await dialogBtn('保存').click();
    await waitToast('已保存');
    await page.waitForTimeout(300);
    ok(await page.isHidden('#modal') && (await text('main table')).includes('组长'), 'an edit without a new PIN saves and closes');

    // ---- screens: a setup code; a team code and its link
    await page.click('#tabs a[data-v=devices]');
    await btn('添加共享屏幕').click();
    await page.fill('#dialog input', '前台 iPad');
    await dialogBtn('生成登记码').click();
    await page.waitForSelector('#dialog .code');
    const setup = await text('#dialog .code');
    ok(/^[2-9A-Z]{4}-[2-9A-Z]{4}$/.test(setup), 'a setup code for the office iPad', setup);
    await snap('setup_code', page, false);
    await dialogBtn('好').click();
    await btn('员工手机团队码').click();
    await dialogBtn('生成').click();
    await page.waitForSelector('#dialog .copyline input');
    const link = await page.locator('#dialog .copyline input').inputValue();
    ok(/\/play\.html#join=[2-9A-Z]{4}-[2-9A-Z]{4}$/.test(link), 'a team code with a link for the staff', link);
    await snap('team_code', page, false);
    await dialogBtn('好').click();
    // the iPad registers itself with the code (as the screen would)
    let reg = await api('kiosk_register', { setup_code: setup });
    ok(reg.ok, 'the setup code works on a screen');
    await page.reload();
    await page.waitForSelector('main table');
    await page.click('#tabs a[data-v=devices]');
    await page.waitForSelector('main table');
    await snap('devices');
    ok((await text('main table')).includes('已连接'), 'the screen shows as connected');
    // a new setup code for it: shown (and stays shown); the screen connects again with it
    await page.locator('main tbody tr', { hasText: '前台 iPad' }).locator('button', { hasText: '新登记码' }).click();
    await dialogBtn('生成新码').click();
    await page.waitForSelector('#dialog .code');
    await page.waitForTimeout(500);
    const code2 = await text('#dialog .code');
    ok(await page.isVisible('#dialog .code') && code2 !== setup, 'a new setup code is shown and stays', code2);
    await dialogBtn('好').click();
    ok((await api('kiosk_bootstrap', { device_token: reg.token })).error === 'device', 'the old connection stops');
    reg = await api('kiosk_register', { setup_code: code2 });
    ok(reg.ok, 'connected again with the new code');

    // ---- a lesson drafted by an AI, checked, edited, published
    await page.click('#tabs a[data-v=lessons]');
    await btn('用 AI 起草').click();
    await page.locator('#dialog textarea').nth(0).fill('退货规定：签收 30 天内可退。退货时当面检查商品并拍照。退款 3 个工作日内退回原付款方式。');
    await page.locator('#dialog button', { hasText: '复制指令' }).click();
    await page.waitForTimeout(300);
    const copied = await page.evaluate(() => navigator.clipboard.readText().catch(() => ''));
    ok(copied.includes('只输出一个 JSON 对象') && copied.includes('签收 30 天内可退'), 'the prompt copied, with the text in it');
    await page.locator('#dialog textarea').nth(1).fill(AI_REPLY);
    await snap('ai_draft', page, false);
    await dialogBtn('导入为草稿').click();
    await page.waitForSelector('.editor');
    await snap('editor_draft');
    ok((await page.locator('.editor .meta input').nth(0).inputValue()) === '退货三步走' && (await page.$$('.editor .step')).length === 6, 'the draft opens in the editor: title and 6 steps');
    ok((await text('.probs-box')).includes('可以发布'), 'checked: it can be published');
    ok((await text('.preview')).includes('退货三步走') === false && (await text('.preview')).includes('先别急着收'), 'the preview shows the guardian saying it');
    // an edit: a problem appears (no right answer), then is fixed
    await page.locator('.step.ask .opt.right input[type=radio]').first().waitFor();
    await page.locator('.step.ask textarea').first().fill('客人拿来一件签收 40 天的衣服要退（规定 30 天内）。你先做什么？');
    await page.locator('.add-steps button', { hasText: '选择题' }).click();
    await page.waitForTimeout(200);
    ok((await text('.probs-box')).includes('第 7 步：题目是空的'), 'a new empty question is a problem to fix', await text('.probs-box'));
    await snap('editor_problem');
    await page.locator('.step.ask').nth(1).locator('.tools button[title="删掉这一步"]').click();
    await page.locator('.meta select').first().selectOption('kohaku');
    await page.locator('.meta input[placeholder^="它的名字"]').fill('朱砂');
    await btn('保存并发布', '.savebar').click();
    await waitToast('已发布');
    await page.waitForSelector('.lessons');
    await snap('lessons_published');
    const [pubd] = await fb.sql(`select status, title, version, reward->>'name' reward, jsonb_array_length(steps) n from qj.lessons where title = '退货三步走'`);
    ok(pubd && pubd.status === 'published' && pubd.reward === '朱砂' && pubd.n === 6, 'published as written, with its new resident', pubd);
    // the demo lessons archived
    for (let k = 0; k < 2; k++) {
      await page.locator('.lesson', { hasText: '示范' }).first().locator('button', { hasText: '归档' }).click();
      await dialogBtn('归档').click();
      await waitToast('已归档');
      await page.waitForTimeout(300);
    }
    const st = await fb.sql(`select count(*) filter (where status = 'archived')::int a, count(*) filter (where status = 'published')::int p from qj.lessons`);
    ok(st[0].a === 2 && st[0].p === 1, 'the demo lessons archived', st[0]);

    // ---- learning on the screen (the kiosk calls), then the reports
    const boot = await api('kiosk_bootstrap', { device_token: reg.token });
    const L = boot.lessons[0];
    const staff = boot.staff;
    const at = s => new Date(Date.now() - 600e3 + s * 1000).toISOString();
    const admTok = JSON.parse(await page.evaluate(() => localStorage.getItem('qijing-admin-v1'))).token;
    for (const [k, p] of staff.slice(0, 4).entries()) {
      const pin = p.name === '小明' ? pin1 : null;
      if (!pin) await api('admin_save_employee', { token: admTok, employee: { id: p.id, name: p.name, pin: '4321' } });
      const li = await api('kiosk_login', { device_token: reg.token, employee: p.id, pin: pin || '4321' });
      const wrong = k % 2 === 0;
      await api('kiosk_record', { device_token: reg.token, session_token: li.session, batch: `qa-batch-${k}-xyz`, events: [
        { type: 'start', lesson: L.id, version: L.version, at: at(0) },
        { type: 'answer', lesson: L.id, version: L.version, step: 2, choice: wrong ? 0 : 1, correct: !wrong, first: true, at: at(40) },
        ...(wrong ? [{ type: 'answer', lesson: L.id, version: L.version, step: 2, choice: 1, correct: true, first: false, at: at(50) }] : []),
        { type: 'done', lesson: L.id, version: L.version, stars: wrong ? 2 : 3, badge: true, at: at(120 + 30 * k) },
      ] });
    }
    await page.click('#tabs a[data-v=overview]');
    await page.reload();
    await page.waitForSelector('.tiles');
    await page.waitForTimeout(400);
    await snap('overview_after');
    ok((await page.$$('.todo')).length === 0 && (await text('.tiles')).includes('4'), 'overview: getting started done; four learners this week');
    await page.goto(`${base}/admin.html#/report/${L.id}`);
    await page.waitForSelector('.q-card');
    await snap('lesson_report');
    ok((await text('.q-card')).includes('4 人答过，第一次就答对 50%'), 'lesson report: first answers to the question', await text('.q-card'));
    const xm = staff.find(p => p.name === '小明');
    await page.goto(`${base}/admin.html#/person/${xm.id}`);
    await page.waitForSelector('.tiles');
    await snap('person_report');
    ok((await text('.tiles')).includes('1 / 1') && (await text('main')).includes('答题记录'), 'a person\'s learning record');

    // ---- a guardian's lines
    await page.click('#tabs a[data-v=guardians]');
    await page.waitForSelector('main .card');
    const startField = page.locator('main .card input[placeholder="你来了。那我们开始吧。"]').first();
    await startField.fill('来，坐下，我们慢慢说。');
    await page.locator('main .card button', { hasText: '保存' }).first().click();
    await waitToast('已保存');
    const [gl] = await fb.sql(`select lines->>'start' s from qj.guardians where id = 'heron'`);
    ok(gl.s === '来，坐下，我们慢慢说。', 'a guardian line changed', gl);
    await snap('guardians');

    // ---- the account: a new password, an invite, signing out and in
    await page.click('#tabs a[data-v=account]');
    await page.waitForSelector('main input[type=password]');
    const pw = page.locator('main input[type=password]');
    await pw.nth(0).fill('pond-2026-heron');
    await pw.nth(1).fill('new-pass-2026');
    await pw.nth(2).fill('new-pass-2026');
    await btn('改密码', 'main').click();
    await page.waitForSelector('main .msg.ok');
    await btn('邀请另一位管理员', 'main').click();
    await page.waitForSelector('#dialog .code');
    ok(/^[2-9A-Z]{4}-[2-9A-Z]{4}$/.test(await text('#dialog .code')), 'an invite for another admin');
    await snap('account', page, false);
    await dialogBtn('好').click();
    await page.click('#btnLogout');
    await page.waitForSelector('#login:not([hidden])');
    await page.fill('#lgName', 'chen');
    await page.fill('#lgPass', 'pond-2026-heron');
    await page.click('#formLogin button[type=submit]');
    await page.waitForSelector('#lgMsg.err');
    ok((await text('#lgMsg')).includes('不对'), 'the old password no longer works');
    await page.fill('#lgPass', 'new-pass-2026');
    await page.click('#formLogin button[type=submit]');
    await page.waitForSelector('#app:not([hidden])');
    ok(await page.isVisible('#app'), 'signed in with the new password');

    // ---- the same pages on a phone
    const ph = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1' });
    watch(ph, 'phone');
    await fonts(ph);
    await ph.addInitScript(c => { window.__ADMIN_TEST__ = { backend: { url: c.url, key: 'sb_publishable_test' } }; }, cfg);
    await ph.goto(`${base}/admin.html`);
    await ph.fill('#lgName', 'chen');
    await ph.fill('#lgPass', 'new-pass-2026');
    await ph.click('#formLogin button[type=submit]');
    await ph.waitForSelector('.tiles');
    await snap('phone_overview', ph);
    await ph.goto(`${base}/admin.html#/lessons`);
    await ph.waitForSelector('.lessons');
    await snap('phone_lessons', ph);
    await ph.goto(`${base}/admin.html#/lesson/${L.id}`);
    await ph.waitForSelector('.editor');
    await snap('phone_editor', ph, false);
    const overflow = await ph.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    ok(overflow <= 0, 'no sideways scrolling on a phone', overflow);
  } catch (e) {
    failed++; console.log('  ERROR', e.stack);
  } finally {
    if (browser) await browser.close();
    srv.close();
    await fb.stop();
  }
  for (const l of [...new Set(logs)].slice(0, 20)) console.log('  ' + l);
  console.log(failed || logs.length ? `FAIL: ${failed} of ${checks} checks failed; ${logs.length} console problems` : `PASS: ${checks} checks, no console problems`);
  process.exit(failed || logs.length ? 1 : 0);
})();
