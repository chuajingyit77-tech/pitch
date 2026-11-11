const { chromium } = require('playwright');
const fs = require('fs');
const html = '<!doctype html><html><head><meta charset=utf8><meta name=viewport content="width=device-width,initial-scale=1"><style>body{margin:0}</style></head><body>' + fs.readFileSync(require('path').join(__dirname, '..', 'app.html'), 'utf8') + '</body></html>';
const SP = require('os').tmpdir();
// A stand-in for the artifact runtime: an in-memory database with live snapshots.
const fake = (role) => `
(() => {
  const data = {}; const subs = []; const leases = {};
  const snapDoc = (id, v) => ({ id, exists: v !== undefined, data: () => v === undefined ? undefined : JSON.parse(JSON.stringify(v)), metadata: { fromCache: false } });
  const fire = c => subs.filter(s => s.c === c).forEach(s => s.run());
  const query = (c, o = {}) => ({
    orderBy(f, d) { return query(c, { ...o, f, d }); }, limit(n) { return query(c, { ...o, n }); },
    doc(id) { return db.doc(c + '/' + id); },
    onSnapshot(next, err) {
      const s = { c, run() { let rows = Object.entries(data[c] || {}); if (o.f) rows.sort((a, b) => ((a[1][o.f] ?? 0) - (b[1][o.f] ?? 0)) * (o.d === 'desc' ? -1 : 1)); if (o.n) rows = rows.slice(0, o.n);
        next({ docs: rows.map(([id, v]) => snapDoc(id, v)), metadata: { fromCache: false } }); } };
      if (c === 'costs' && '${role}' !== 'owner') { setTimeout(() => err && err({ code: 'permission' }), 5); return () => {}; }
      subs.push(s); setTimeout(() => s.run(), 20); return () => {};
    },
  });
  const adminOnly = ['products', 'costs', 'faq', 'decisions', 'settings'];
  const db = {
    collection: c => query(c),
    doc(path) { const [c, id] = path.split('/'); const guard = () => { if (adminOnly.includes(c) && '${role}' !== 'owner') throw { code: 'invalid_argument' }; };
      return {
        async get() { return snapDoc(id, data[c]?.[id]); },
        async set(v) { guard(); (data[c] ||= {})[id] = JSON.parse(JSON.stringify(v)); fire(c); },
        async update(v) { guard(); if (!data[c]?.[id]) throw { code: 'invalid_argument' }; Object.assign(data[c][id], JSON.parse(JSON.stringify(v))); fire(c); },
        async acquire({ holder, ttlMs }) { const l = leases[path]; if (l && l.until > Date.now() && l.holder !== holder) return { acquired: false }; leases[path] = { holder, until: Date.now() + (ttlMs || 30000) }; return { acquired: true }; },
      }; },
  };
  window.__data = data; window.__seed = (c, id, v) => { (data[c] ||= {})[id] = v; fire(c); };
  const sample = Object.assign(async () => ({ text: 'x' }), { json: async (p) => { window.__lastPrompt = p; await new Promise(r => setTimeout(r, 60));
    if (/marketing copy/.test(p)) return { text: 'Fresh, rich foam for clean hands. Order today on WhatsApp.', text_tr: '泡沫丰富，洗手更干净。今天就在 WhatsApp 下单。' };
    return { customer_tr: '洗手液多少钱？可以送到拉合尔吗？', intent: 'price', faq_id: '', reply: 'Assalam o Alaikum! Hand Wash 500ml Rs 250 ka hai. Delivery ke liye hamari team confirm karegi.', reply_tr: '您好！洗手液 500ml 是 Rs 250。送货方面我们的团队会确认。', needs_human: true, reason: '送货时间没有资料' }; } });
  const user = { isOwner: async () => '${role}' === 'owner', canEdit: async () => '${role}' === 'owner', can: async () => true, id: async () => 'u_${role}' };
  window.claude = { use: async n => ({ db, user, sample })[n] ?? null };
})();`;
(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const mk = async (role, vp) => { const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: 1 }); const page = await ctx.newPage();
    page.on('pageerror', e => errors.push(role + ' pageerror: ' + e.message)); page.on('console', m => { if (m.type() === 'error') errors.push(role + ' console: ' + m.text()); });
    await page.route('http://app.test/', r => r.fulfill({ contentType: 'text/html; charset=utf-8', body: html })); await page.addInitScript(fake(role)); await page.goto('http://app.test/'); await page.waitForSelector('.head'); if (!(await page.evaluate(() => !!window.__data))) throw new Error('fake runtime missing'); return page; };
  const p = await mk('owner', { width: 390, height: 800 });
  const click = async (sel) => { await p.locator(sel).first().click(); await p.waitForTimeout(120); };
  const fill = async (k, v) => p.locator(`#sheet [data-k="${k}"]`).fill(v);
  const sel = async (k, v) => p.locator(`#sheet [data-k="${k}"]`).selectOption(v);
  const text = async s => (await p.locator(s).first().innerText()).replace(/\s+/g, ' ');
  const log = (...a) => console.log(...a);
  await p.screenshot({ path: SP + '/01-empty.png' });
  // products
  await click('[data-v="products"]'); await click('[data-sheet="product"]');
  await fill('name', 'Hand Wash'); await fill('size', '500ml'); await fill('pr', '250'); await fill('pd', '200'); await fill('cost', '120'); await fill('safe', '20');
  log('margin:', await text('#margin')); await click('[data-act="save-product"]');
  await click('[data-sheet="product"]'); await fill('name', 'Toilet Cleaner (Harpic)'); log('flags:', (await text('#pflags')).slice(0, 60)); await fill('pr', '300'); await click('[data-act="save-product"]');
  await click('.head [data-sheet="product"]'); await fill('name', 'Acne Cream'); await sel('cat', 'skin'); log('flags2 count:', await p.locator('#pflags .note').count()); await click('[data-act="save-product"]');
  log('products listed:', await p.locator('#main .item').count());
  const pid = await p.evaluate(() => Object.entries(window.__data.products).find(([k, v]) => v.name === 'Hand Wash')[0]);
  // production
  await click('[data-v="production"]'); await click('[data-sheet="batch-new"]'); await sel('pid', pid); await fill('qty', '30'); await fill('batchNo', 'B001'); await fill('exp', '2026-12-20'); await click('[data-act="save-batch"]');
  log('stock after batch:', await p.evaluate(id => window.__data.stock[id].qty, pid));
  // order
  await click('[data-v="orders"]'); await click('[data-sheet="order-new"]'); await fill('name', 'Ali Khan'); await fill('phone', '0300 1234567'); await fill('city', 'Lahore');
  await p.locator('#sheet [data-line="0"][data-lk="pid"]').selectOption(pid); await p.waitForTimeout(80);
  log('auto price:', await p.locator('#sheet [data-line="0"][data-lk="price"]').inputValue());
  await sel('tier', 'd'); await p.waitForTimeout(80); log('dist price:', await p.locator('#sheet [data-line="0"][data-lk="price"]').inputValue());
  await p.locator('#sheet [data-line="0"][data-lk="qty"]').fill('12'); log('total:', await text('#otot'));
  await p.screenshot({ path: SP + '/02-order-form.png' });
  await click('[data-act="save-order"]'); await p.waitForTimeout(200);
  log('order sheet:', (await text('#sheet .panel')).slice(0, 160));
  const wa = await p.locator('#sheet a.btn').first().getAttribute('href'); log('wa link:', wa.slice(0, 60));
  await p.screenshot({ path: SP + '/03-order.png' });
  await click('[data-act="ship"]'); await p.waitForTimeout(300);
  log('stock after ship:', await p.evaluate(id => window.__data.stock[id].qty, pid), '| status:', await p.evaluate(() => Object.values(window.__data.orders)[0].status));
  await click('[data-act="pay"]'); await p.waitForTimeout(200); await click('[data-act="ask-return"]'); await click('[data-act="ret-restock"]'); await p.waitForTimeout(300);
  log('stock after return:', await p.evaluate(id => window.__data.stock[id].qty, pid), '| status:', await p.evaluate(() => Object.values(window.__data.orders)[0].status));
  await click('[data-act="close"]');
  // shortage gate
  await click('[data-sheet="order-new"]'); await fill('name', 'Big Buyer'); await p.locator('#sheet [data-line="0"][data-lk="pid"]').selectOption(pid); await p.locator('#sheet [data-line="0"][data-lk="qty"]').fill('99'); await p.waitForTimeout(80);
  log('warn:', (await text('#owarn')).slice(0, 50)); await sel('pay', 'pre'); await click('[data-act="save-order"]'); await p.waitForTimeout(200);
  log('ship disabled:', await p.locator('#sheet [data-act="ship"]').isDisabled(), '| gates:', await p.locator('#sheet .note').count()); await click('[data-act="close"]');
  // inbox + AI + approval
  await click('[data-v="inbox"]'); await click('[data-sheet="inbox-new"]'); await fill('name', 'Sara'); await fill('phone', '03001112223'); await fill('text', 'Hand wash ki qeemat kya hai? Lahore delivery?'); await click('[data-act="save-inbox"]'); await p.waitForTimeout(200);
  await click('[data-act="ai-reply"]'); await p.waitForTimeout(400);
  log('draft shown:', (await text('#sheet .panel')).includes('Assalam'), '| prompt has product:', await p.evaluate(() => /Hand Wash 500ml \| Rs 250 \| out of stock/.test(window.__lastPrompt)), '| prompt hides Harpic:', await p.evaluate(() => !/harpic/i.test(window.__lastPrompt)));
  await p.screenshot({ path: SP + '/04-inbox-draft.png', fullPage: false });
  await click('[data-act="send-appr"]'); await p.waitForTimeout(300);
  log('approval sheet:', (await text('#sheet h2')));
  await p.locator('#sheet [data-k="body"]').fill('This cures everything 100%'); await p.waitForTimeout(80); log('claims flagged:', await p.locator('#claims > div').count());
  await click('[data-act="approve"]'); log('blocked toast:', await text('#toast'));
  await p.locator('#sheet [data-k="body"]').fill('Assalam o Alaikum! Hand Wash 500ml Rs 250 ka hai.'); await click('[data-act="approve"]'); await p.waitForTimeout(300);
  log('after approve sheet has send btn:', await p.locator('#sheet [data-act="answered"]').count(), '| inbox status:', await p.evaluate(() => Object.values(window.__data.inbox)[0].status));
  await p.screenshot({ path: SP + '/05-approved.png' });
  await click('#sheet [data-act="answered"]'); await p.waitForTimeout(200);
  // faq from approval
  await click('[data-v="approvals"]'); await click('[data-v="done"]'); await click('#main .item'); await click('[data-act="faq-from-appr"]'); await fill('kw', 'qeemat price hand wash'); await click('[data-act="save-faq"]'); await p.waitForTimeout(200);
  await click('[data-v="inbox"]'); await click('[data-sheet="inbox-new"]'); await fill('text', 'hand wash qeemat?'); await click('[data-act="save-inbox"]'); await p.waitForTimeout(200);
  log('faq matched:', (await text('#sheet .panel')).includes('对上了一条标准答案')); await click('[data-act="close"]');
  // marketing
  await click('[data-v="marketing"]'); await click('[data-sheet="post-new"]'); await sel('pid', pid); await click('[data-act="ai-post"]'); await p.waitForTimeout(400);
  log('post text:', (await p.locator('#sheet [data-k="text"]').inputValue()).slice(0, 40)); await click('[data-act="send-post"]'); await p.waitForTimeout(300); log('post approval open:', await text('#sheet h2')); await click('[data-act="approve"]'); await p.waitForTimeout(300); await click('[data-act="close"]');
  // other views
  for (const v of ['customers', 'faq', 'team', 'approvals', 'today']) { await click(`#nav [data-v="${v}"]`); log(v, 'items:', await p.locator('#main .item').count()); }
  await p.screenshot({ path: SP + '/06-today.png', fullPage: true });
  await click('[data-act="open-settings"]'); await fill('company', 'Test Co'); await click('[data-act="save-settings"]'); await p.waitForTimeout(200); log('brand:', (await text('#brand')).slice(0, 20));
  await click('[data-act="lang"]'); log('EN title:', await text('.head h1')); await click('#nav [data-v="team"]'); await p.screenshot({ path: SP + '/07-team-en.png', fullPage: true });
  const overflow = await p.evaluate(() => document.documentElement.scrollWidth > window.innerWidth); log('h-overflow mobile:', overflow);
  // staff view + desktop dark
  const s = await mk('staff', { width: 1200, height: 800 }); await s.emulateMedia({ colorScheme: 'dark' });
  await s.evaluate(() => { window.__seed('products', 'p1', { name: 'Dish Wash', size: '1L', cat: 'home', pr: 180, on: true, flags: [], ts: 1 }); }); await s.waitForTimeout(150);
  await s.locator('#nav [data-v="products"]').click(); log('staff add-product btn:', await s.locator('.head [data-sheet="product"]').count(), '| settings hidden:', await s.locator('#setBtn').isHidden());
  await s.locator('#main .item').first().click(); await s.waitForTimeout(100); log('staff product sheet inputs:', await s.locator('#sheet input').count()); await s.screenshot({ path: SP + '/08-staff-dark.png' });
  // local fallback
  const ctx = await browser.newContext({ viewport: { width: 390, height: 700 } }); const l = await ctx.newPage(); l.on('pageerror', e => errors.push('local pageerror: ' + e.message));
  await l.route('http://app.test/', r => r.fulfill({ contentType: 'text/html; charset=utf-8', body: html })); await l.addInitScript('window.claude={use:async()=>null}'); await l.goto('http://app.test/'); await l.waitForSelector('.head'); log('local banner:', await l.locator('#main .note').count());
  console.log('ERRORS:', errors.length ? errors : 'none');
  await browser.close();
})().catch(e => { console.error('TEST FAILED', e.message.slice(0, 600)); process.exit(1); });
