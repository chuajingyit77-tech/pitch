
// ---------------------------------------------------------------- small pieces
const pill = (cls, text) => `<span class="pill ${cls}">${esc(text)}</span>`;
const lab = (map, k) => (map[k] ? L(map[k][0], map[k][1]) : k || '');
const STATUS = { new: ['待出货', 'To ship'], shipped: ['已出货', 'Shipped'], done: ['已送达', 'Delivered'], returned: ['已退货', 'Returned'], cancelled: ['已取消', 'Cancelled'] };
function orderPills(o) {
  let h = '';
  if (awaitingPay(o)) h += pill('warn', L('等客人付款', 'Awaiting payment'));
  else h += pill(o.status === 'new' ? 'acc' : o.status === 'done' ? 'good' : o.status === 'returned' || o.status === 'cancelled' ? '' : 'warn', lab(STATUS, o.status));
  if (o.status !== 'cancelled' && o.status !== 'returned') h += ' ' + (o.paid ? pill('good', L('已收款', 'Paid')) : o.status !== 'new' ? pill('bad', L('未收款', 'Unpaid')) : '');
  return h;
}
const INBOX_ST = { new: ['待回复', 'To reply'], wait: ['等批准', 'Awaiting approval'], approved: ['已批准，可以发', 'Approved, ready to send'], answered: ['已回复', 'Answered'] };
const inboxPill = i => pill(i.status === 'new' ? 'bad' : i.status === 'wait' ? 'warn' : i.status === 'approved' ? 'acc' : 'good', lab(INBOX_ST, i.status));
const DEC = { pending: ['等批准', 'Pending'], approved: ['已批准', 'Approved'], rejected: ['退回', 'Sent back'] };
const decPill = a => { const d = decided(a.id); return pill(d === 'pending' ? 'warn' : d === 'approved' ? 'good' : 'bad', lab(DEC, d)); };
const KINDS = { reply: ['客服回复', 'Customer reply'], post: ['营销文案', 'Marketing copy'] };
const empty = (title, text, btn = '') => `<div class="empty"><b>${esc(title)}</b>${esc(text)}${btn ? `<div class="acts" style="justify-content:center;margin-top:10px">${btn}</div>` : ''}</div>`;
const btn = (act, text, cls = '', attrs = '') => `<button type="button" class="btn ${cls}" data-act="${act}" ${attrs}>${esc(text)}</button>`;
const chips = (group, opts) => `<div class="chips">${opts.map(([k, t]) => `<button type="button" class="chip" data-act="filter" data-group="${group}" data-v="${k}" aria-pressed="${S.filter[group] === k}">${esc(t)}</button>`).join('')}</div>`;
const head = (title, sub, actions = '') => `<div class="head"><div><h1>${esc(title)}</h1>${sub ? `<p>${esc(sub)}</p>` : ''}</div><div class="acts">${actions}</div></div>`;
const itemsLine = o => (o.items || []).map(it => `${it.name} ×${it.qty}`).join('、');

// Each product is drawn as its own kind of pack and tinted by its range.
const PACKS = {
  pump: '<rect class="b" x="12" y="26" width="24" height="34" rx="7"/><rect class="c" x="21" y="15" width="6" height="11"/><rect class="c" x="17" y="9" width="20" height="6" rx="3"/><rect class="l" x="16" y="36" width="16" height="14" rx="3"/>',
  spray: '<path class="b" d="M15 26c0-7 4-10 9-10s9 3 9 10v28a6 6 0 0 1-6 6h-6a6 6 0 0 1-6-6z"/><rect class="c" x="20" y="7" width="8" height="8" rx="2"/><circle class="c" cx="33" cy="9" r="1.3"/><circle class="c" cx="37" cy="6" r="1.1"/><circle class="c" cx="37" cy="12" r="1.1"/><rect class="l" x="18" y="34" width="12" height="16" rx="3"/>',
  bottle: '<path class="b" d="M19 22h10l6 9v23a6 6 0 0 1-6 6H19a6 6 0 0 1-6-6V31z"/><rect class="c" x="20" y="9" width="8" height="12" rx="2"/><rect class="l" x="16" y="37" width="16" height="13" rx="3"/>',
  box: '<rect class="b" x="10" y="20" width="28" height="40" rx="4"/><rect class="c" x="10" y="13" width="28" height="7" rx="2"/><circle class="l" cx="24" cy="40" r="9"/>',
  jar: '<rect class="b" x="8" y="31" width="32" height="27" rx="8"/><rect class="c" x="6" y="20" width="36" height="11" rx="4"/><rect class="l" x="14" y="39" width="20" height="11" rx="3"/>',
  dropper: '<rect class="b" x="15" y="30" width="18" height="30" rx="6"/><rect class="c" x="19" y="21" width="10" height="9" rx="2"/><ellipse class="c" cx="24" cy="12" rx="5" ry="8"/><rect class="l" x="18" y="40" width="12" height="12" rx="3"/>',
};
const packOf = p => { const n = (p?.name || '').toLowerCase(); return /serum|drop/.test(n) ? 'dropper' : /cream|jar|balm/.test(n) ? 'jar' : /spray|freshener/.test(n) ? 'spray' : /powder|surf/.test(n) ? 'box' : /hand|shampoo|lotion/.test(n) ? 'pump' : 'bottle'; };
const pack = p => `<span class="ph ${CATS[p?.cat] ? p.cat : 'home'}" aria-hidden="true"><svg class="bt" viewBox="0 0 48 64">${PACKS[packOf(p)]}</svg></span>`;
const FLAGN = () => ({ tm: L('商标风险', 'Trademark'), tmlike: L('名字像名牌', 'Brand look-alike'), skin: L('护肤品合规', 'Skin-care rules'), drug: L('治疗类说法', 'Treatment claim'), pest: L('驱虫登记', 'Pest registration') });

function orderItem(o) {
  return `<button type="button" class="item" data-act="open" data-sheet="order" data-id="${esc(o.id)}">
    ${pack(prod(o.items?.[0]?.pid))}<div class="body"><div class="t">${esc(o.name || L('（没写名字）', '(no name)'))} <span class="s num">${esc(o.no || '')}</span></div>
    <div class="s">${esc(itemsLine(o))}</div>
    <div class="s">${esc(lab(CHANNELS, o.channel))} · ${esc(lab(PAYS, o.pay))}${o.city ? ' · ' + esc(o.city) : ''} · ${esc(fmtTime(o.ts))}</div></div>
    <div class="r"><div class="t">${esc(money(orderTotal(o)))}</div><div>${orderPills(o)}</div></div></button>`;
}

// ---------------------------------------------------------------- views
const V = {};

V.today = () => {
  const b = brief(), now = Date.now();
  const todos = [];
  const add = (cls, t, s, go, filter) => todos.push(`<button type="button" class="item todo ${cls}" data-act="go" data-v="${go}" ${filter ? `data-filter="${filter}"` : ''}><div class="body"><div class="t">${esc(t)}</div><div class="s">${esc(s)}</div></div><div class="r">›</div></button>`);
  if (b.toReply.length) {
    const oldest = Math.min(...b.toReply.map(i => i.ts));
    add(now - oldest > 2 * 36e5 ? 'bad' : 'warn', L(`${b.toReply.length} 条客人询问还没回`, `${b.toReply.length} customer inquiries waiting`), L(`最久的已经等了 ${ago(oldest)}`, `The oldest has waited ${ago(oldest)}`), 'inbox', 'open');
  }
  if (b.short.length) add('bad', L(`${b.short.length} 个产品的库存不够已接的订单`, `${b.short.length} products are short for orders already taken`), b.short.map(x => `${x.p.name} (${x.avail})`).join('、'), 'products');
  if (b.lateShip.length) add('bad', L(`${b.lateShip.length} 张订单超过 ${S.settings.shipDays} 天还没出货`, `${b.lateShip.length} orders unshipped for over ${S.settings.shipDays} days`), b.lateShip.slice(0, 4).map(o => o.name).join('、'), 'orders', 'open');
  const onTime = b.ship.length - b.lateShip.length;
  if (onTime > 0) add('warn', L(`${onTime} 张订单可以出货`, `${onTime} orders ready to ship`), L('钱和货都齐了', 'Payment and stock are in order'), 'orders', 'open');
  const wait = S.orders.filter(awaitingPay);
  if (wait.length) add('warn', L(`${wait.length} 张先付款的订单还没收到钱`, `${wait.length} prepaid orders not yet paid`), L('收到钱以后才能出货', 'They cannot ship until payment arrives'), 'orders', 'open');
  if (b.lateOwed.length) add('bad', L(`${b.lateOwed.length} 张已出货的订单超过 ${S.settings.codDays} 天没收到钱`, `${b.lateOwed.length} shipped orders unpaid for over ${S.settings.codDays} days`), money(b.lateOwed.reduce((s, o) => s + orderTotal(o), 0)), 'orders', 'owed');
  const lowOnly = b.low.filter(x => x.avail >= 0);
  if (lowOnly.length) add('warn', L(`${lowOnly.length} 个产品低于安全库存`, `${lowOnly.length} products below their safety level`), lowOnly.map(x => `${x.p.name} (${x.avail})`).join('、'), 'production');
  if (b.pending.length) add('warn', S.isOwner ? L(`${b.pending.length} 项等你批准`, `${b.pending.length} items need your approval`) : L(`${b.pending.length} 项在等负责人批准`, `${b.pending.length} items are waiting for the owner`), L('批准以前不会发给客人', 'Nothing is sent to customers before approval'), 'approvals', 'pending');
  if (b.expiring.length) add('warn', L(`${b.expiring.length} 个批次在 60 天内到期`, `${b.expiring.length} batches expire within 60 days`), b.expiring.slice(0, 3).map(x => `${pname(prod(x.pid))} ${fmtDate(x.exp)}`).join('、'), 'production');
  if (S.isOwner && b.noPrice.length) add('warn', L(`${b.noPrice.length} 个产品还没定价`, `${b.noPrice.length} products have no price yet`), L('定了价，开单和回复客人才会自动带出价钱', 'Once priced, orders and replies fill the price in for you'), 'products');
  if (b.flagged.length) add('bad', L(`${b.flagged.length} 个产品有商标或合规上的风险`, `${b.flagged.length} products carry trademark or compliance risk`), b.flagged.map(p => p.name).join('、'), 'products');

  const d = new Date();
  const shelf = S.products.filter(p => p.on !== false).map(p => {
    const av = stockOf(p.id) - (b.res[p.id] || 0), low = b.low.find(x => x.p.id === p.id);
    return `<button type="button" class="sku" data-act="open" data-sheet="product" data-id="${esc(p.id)}">${pack(p)}<span class="n">${esc(p.name)}</span>${pill(av < 0 ? 'bad' : low ? 'warn' : av > 0 ? 'good' : '', String(av))}</button>`;
  }).join('');
  return `<section class="hero">${head(L('今天', 'Today'), `${fmtDate(d)} · ${L('各个 agent 替你看出来的事，照着顺序做就行。', 'What the agents found for you. Work down the list.')}`,
      btn('open', L('＋ 新订单', '+ New order'), 'primary', 'data-sheet="order-new"') + btn('open', L('＋ 客人询问', '+ Inquiry'), '', 'data-sheet="inbox-new"'))}
      <div class="hero-art" aria-hidden="true">${pack({ cat: 'skin', name: 'serum' })}${pack({ cat: 'skin', name: 'cream' })}${pack({ cat: 'home', name: 'hand wash' })}</div></section>
    <div class="stats">
      <div class="stat"><b>${b.today.length}</b><span>${L('今天的订单', 'Orders today')} · ${esc(money(b.todaySum))}</span></div>
      <div class="stat"><b>${esc(money(b.monthSum))}</b><span>${L('本月销售', 'Sales this month')} · ${b.month.length} ${L('单', 'orders')}</span></div>
      <div class="stat"><b>${b.ship.length}</b><span>${L('可以出货', 'Ready to ship')}</span></div>
      <div class="stat"><b>${esc(money(b.owedSum))}</b><span>${L('货出了还没收的钱', 'Shipped but not yet paid')} · ${b.owed.length} ${L('单', 'orders')}</span></div>
    </div>
    <section class="group"><h2>${L('现在要做的', 'To do now')} <span class="count">${todos.length}</span></h2>
      <div class="list">${todos.join('') || empty(L('没有卡住的事', 'Nothing is stuck'), S.products.length ? L('有新订单或客人询问时，会出现在这里。', 'New orders and inquiries will show up here.') : L('先到「产品」加上你的产品。', 'Start by adding your products under Products.'))}</div></section>
    ${shelf ? `<section class="group"><h2>${L('货架 · 现在可卖的数量', 'Shelf · free to sell now')}</h2><div class="strip">${shelf}</div></section>` : ''}`;
};

V.orders = () => {
  const f = S.filter.orders;
  const rows = S.orders.filter(o => f === 'open' ? o.status === 'new' : f === 'owed' ? isOwed(o) : f === 'shipped' ? o.status === 'shipped' : true);
  return head(L('订单', 'Orders'), L('所有渠道的订单都记在这里：WhatsApp、网店、经销商、企业。', 'Orders from every channel in one place: WhatsApp, online store, distributors, business.'), btn('open', L('＋ 新订单', '+ New order'), 'primary', 'data-sheet="order-new"')) +
    chips('orders', [['open', L('待处理', 'Open')], ['shipped', L('运送中', 'In transit')], ['owed', L('未收款', 'Unpaid')], ['all', L('全部', 'All')]]) +
    `<div class="list">${rows.map(orderItem).join('') || empty(L('这里没有订单', 'No orders here'), L('换一个筛选看看，或者开一张新订单。', 'Try another filter, or create a new order.'))}</div>`;
};

V.inbox = () => {
  const f = S.filter.inbox;
  const rows = S.inbox.filter(i => f === 'open' ? i.status !== 'answered' : f === 'answered' ? i.status === 'answered' : true);
  return head(L('客服', 'Inbox'), L('把客人的原话贴进来。有批准过的标准答案就直接用，没有的话 AI 起草，负责人批准后再发。', 'Paste what the customer wrote. If an approved answer exists, use it; otherwise AI drafts and the owner approves before it is sent.'), btn('open', L('＋ 客人询问', '+ Inquiry'), 'primary', 'data-sheet="inbox-new"')) +
    chips('inbox', [['open', L('未完成', 'Open')], ['answered', L('已回复', 'Answered')], ['all', L('全部', 'All')]]) +
    `<div class="list">${rows.map(i => `<button type="button" class="item" data-act="open" data-sheet="inbox" data-id="${esc(i.id)}">
      <div class="body"><div class="t">${esc(i.name || i.phone || L('客人', 'Customer'))}</div><div class="s">${esc((i.text || '').slice(0, 120))}</div>
      <div class="s">${esc(lab(CHANNELS, i.channel))} · ${esc(fmtTime(i.ts))}</div></div><div class="r">${inboxPill(i)}</div></button>`).join('') ||
      empty(L('没有等着的询问', 'No inquiries waiting'), L('客人在 WhatsApp 或 Facebook 问了问题，把原话贴进来。', 'When a customer asks on WhatsApp or Facebook, paste the message here.'))}</div>`;
};

V.products = () => {
  const res = reserved(), fn = FLAGN();
  const groups = Object.keys(CATS).map(c => {
    const ps = S.products.filter(p => (CATS[p.cat] ? p.cat : 'home') === c);
    if (!ps.length) return '';
    return `<section class="group"><h2>${esc(lab(CATS, c))} <span class="count">${ps.length}</span></h2><div class="shelf">${ps.map(p => {
      const st = stockOf(p.id), av = st - (res[p.id] || 0);
      const flags = (p.flags || []).map(f => pill('bad', fn[f] || f)).join('');
      return `<button type="button" class="card ${p.on === false ? 'off' : ''}" data-act="open" data-sheet="product" data-id="${esc(p.id)}">${pack(p)}
        <span class="cb"><span class="t">${esc(p.name)}</span>${p.size ? `<span class="s">${esc(p.size)}</span>` : ''}
        <span class="s num">${Number(p.pr) ? esc(money(p.pr)) : L('还没定价', 'No price yet')}${p.on === false ? ' · ' + L('停售', 'Inactive') : ''}</span>
        <span class="s num">${L('库存', 'Stock')} ${st} · ${L('可卖', 'Free')} <b style="${av < 0 ? 'color:var(--bad)' : 'color:var(--ink)'}">${av}</b></span>
        ${flags ? `<span class="flags">${flags}</span>` : ''}</span></button>`;
    }).join('')}</div></section>`;
  }).join('');
  return head(L('产品', 'Products'), L('「可卖」是库存扣掉已接订单以后还剩的数量。点一个产品看三种价钱。', '"Free" is stock minus orders already taken. Tap a product for its three prices.'), S.isOwner ? btn('open', L('＋ 新产品', '+ New product'), 'primary', 'data-sheet="product"') : '') +
    (groups || empty(L('还没有产品', 'No products yet'), S.isOwner ? L('加上第一个产品，其他页面才有东西可用。', 'Add your first product so the other pages have something to work with.') : L('请负责人先加上产品。', 'Ask the owner to add products first.')));
};

V.production = () => {
  const b = brief();
  const log = S.batches.map(x => `<div class="item"><div class="body"><div class="t">${esc(pname(prod(x.pid)))}</div>
    <div class="s">${x.kind === 'adj' ? L('盘点调整', 'Stock count') : L('生产入库', 'Production')}${x.batchNo ? ' · ' + L('批号 ', 'Batch ') + esc(x.batchNo) : ''}${x.exp ? ' · ' + L('有效期到 ', 'Expires ') + esc(fmtDate(x.exp)) : ''}${x.note ? ' · ' + esc(x.note) : ''}</div>
    <div class="s">${esc(fmtTime(x.ts))}</div></div><div class="r t">${x.qty > 0 ? '+' : ''}${esc(x.qty)}</div></div>`).join('');
  return head(L('生产与库存', 'Production & stock'), L('每做完一批就记一笔，库存自动加上。盘点对不上时用「盘点调整」，不要直接改数字。', 'Record each finished batch and stock goes up by itself. When a count does not match, use "Stock count" rather than editing numbers.'),
      btn('open', L('＋ 记录生产', '+ Record batch'), 'primary', 'data-sheet="batch-new"') + btn('open', L('盘点调整', 'Stock count'), '', 'data-sheet="adjust"')) +
    (b.low.length ? `<section class="group"><h2>${L('该补货的', 'Needs making')} <span class="count">${b.low.length}</span></h2><div class="list">${b.low.map(x =>
      `<div class="item todo ${x.avail < 0 ? 'bad' : 'warn'}"><div class="body"><div class="t">${esc(pname(x.p))}</div><div class="s">${L('库存', 'Stock')} ${stockOf(x.p.id)} · ${L('订单占用', 'Reserved')} ${x.res} · ${L('安全库存', 'Safety level')} ${Number(x.p.safe) || 0}</div></div><div class="r t" style="${x.avail < 0 ? 'color:var(--bad)' : ''}">${x.avail}</div></div>`).join('')}</div></section>` : '') +
    `<section class="group"><h2>${L('记录', 'Log')} <span class="count">${S.batches.length}</span></h2><div class="list">${log || empty(L('还没有记录', 'No records yet'), L('做完第一批货，点「记录生产」。', 'When the first batch is done, tap "Record batch".'))}</div></section>`;
};

V.customers = () => {
  const cs = customers();
  return head(L('客户', 'Customers'), L('客户名单是从订单里自动整理出来的，不用另外登记。', 'This list builds itself from orders. Nothing to enter separately.')) +
    `<div class="list">${cs.map(c => `<button type="button" class="item" data-act="open" data-sheet="customer" data-id="${esc(c.key)}">
      <div class="body"><div class="t">${esc(c.name || c.phone)}</div><div class="s">${esc(lab(TIERS, c.ctype || 'r'))}${c.city ? ' · ' + esc(c.city) : ''}${c.phone ? ' · ' + esc(c.phone) : ''}</div>
      <div class="s">${L('最近一次', 'Last order')} ${esc(fmtDate(c.last))}</div></div>
      <div class="r"><div class="t">${esc(money(c.sum))}</div><div class="s">${c.n} ${L('单', 'orders')}</div>${c.owed ? `<div>${pill('bad', L('欠 ', 'Owes ') + money(c.owed))}</div>` : ''}</div></button>`).join('') ||
      empty(L('还没有客户', 'No customers yet'), L('开了第一张订单以后，客户会自动出现在这里。', 'Customers appear here after the first order.'))}</div>`;
};

V.faq = () => head(L('标准答案', 'Approved answers'), L('负责人批准过的答案。客人问到同样的问题，客服可以直接用，不必再审。', 'Answers the owner has approved. When a customer asks the same thing, staff can use them without another review.'), S.isOwner ? btn('open', L('＋ 新答案', '+ New answer'), 'primary', 'data-sheet="faq-edit"') : '') +
  `<div class="list">${S.faq.map(f => `<${S.isOwner ? 'button type="button"' : 'div'} class="item" data-act="open" data-sheet="faq-edit" data-id="${esc(f.id)}">
    <div class="body"><div class="t">${esc(f.q)} ${f.on === false ? pill('', L('停用', 'Off')) : ''}</div><div class="s" style="white-space:pre-wrap">${esc(f.a)}</div>${f.kw ? `<div class="s">${L('关键词：', 'Keywords: ')}${esc(f.kw)}</div>` : ''}</div></${S.isOwner ? 'button' : 'div'}>`).join('') ||
    empty(L('还没有标准答案', 'No approved answers yet'), L('批准一条客服回复时，可以顺手存成标准答案；下次同样的问题就不用再审。', 'When approving a reply you can save it as an approved answer, so the same question never needs review again.'))}</div>`;

V.marketing = () => {
  const posts = S.approvals.filter(a => a.kind === 'post');
  return head(L('营销', 'Marketing'), L('AI 起草文案，「说法检查」先挡掉会惹麻烦的字眼，负责人批准后才能拿去发。', 'AI drafts the copy, the claim check stops risky wording, and the owner approves before it is used.'), btn('open', L('＋ 写文案', '+ Write copy'), 'primary', 'data-sheet="post-new"')) +
    `<div class="list">${posts.map(a => `<button type="button" class="item" data-act="open" data-sheet="approval" data-id="${esc(a.id)}">
      <div class="body"><div class="t">${esc(a.title || '')}</div><div class="s">${esc((S.decisions[a.id]?.body || a.body || '').slice(0, 140))}</div><div class="s">${esc(fmtTime(a.ts))}</div></div><div class="r">${decPill(a)}</div></button>`).join('') ||
      empty(L('还没有文案', 'No copy yet'), L('选一个产品，告诉 AI 要强调什么，它会写出可以贴到 Facebook 或 WhatsApp 的文字。', 'Pick a product, say what to stress, and AI writes text you can post on Facebook or WhatsApp.'))}</div>`;
};

V.approvals = () => {
  const f = S.filter.approvals;
  const rows = S.approvals.filter(a => (f === 'pending') === (decided(a.id) === 'pending'));
  return head(L('审批', 'Approvals'), S.isOwner ? L('AI 写的东西都要先经过你。你可以改字再批准，或者退回。', 'Everything AI writes passes through you. Edit and approve, or send it back.') : L('这里的内容要等负责人批准以后才能发出去。', 'Items here wait for the owner before they can go out.')) +
    chips('approvals', [['pending', L('等批准', 'Pending')], ['done', L('已处理', 'Decided')]]) +
    `<div class="list">${rows.map(a => `<button type="button" class="item" data-act="open" data-sheet="approval" data-id="${esc(a.id)}">
      <div class="body"><div class="t">${esc(lab(KINDS, a.kind))} · ${esc(a.title || '')}</div><div class="s">${esc((a.body || '').slice(0, 140))}</div><div class="s">${esc(fmtTime(a.ts))}</div></div><div class="r">${decPill(a)}</div></button>`).join('') ||
      empty(f === 'pending' ? L('没有等批准的', 'Nothing pending') : L('还没有处理过的', 'Nothing decided yet'), L('客服送审的回复和营销文案会出现在这里。', 'Replies and marketing copy sent for review appear here.'))}</div>`;
};

V.team = () => {
  const b = brief();
  const ai = S.hasAI;
  const A = [
    [L('晨报', 'Morning brief'), 'rule', L('每次打开，把全公司要处理的事按轻重排好。', 'Each time you open the app, ranks everything that needs attention.'), L(`今天页`, 'Today page')],
    [L('标准答案匹配', 'Answer matcher'), 'rule', L('客人的问题和批准过的答案对上了，就直接给出来。', 'When a question matches an approved answer, offers it straight away.'), `${S.faq.filter(f => f.on !== false).length} ${L('条答案', 'answers')}`],
    [L('回复起草与翻译', 'Reply drafter & translator'), 'ai', L('读懂客人的乌尔都语或英语，翻成中文给你看，再用客人的语言起草回复。', "Reads the customer's Urdu or English, translates it for you, and drafts a reply in the customer's language."), ai ? L('按一下才动', 'Runs on tap') : L('这里用不了', 'Unavailable here')],
    [L('报价', 'Pricing'), 'rule', L('按零售、经销商、企业三种客户自动带出价钱。', 'Fills in the price for retail, distributor or business customers.'), `${S.products.filter(p => Number(p.pr)).length}/${S.products.length} ${L('已定价', 'priced')}`],
    [L('出货把关', 'Shipping gate'), 'rule', L('库存不够，或者先付款的订单钱还没到，就不让出货。', 'Blocks shipping when stock is short or a prepaid order is unpaid.'), `${b.ship.length} ${L('张可出货', 'ready')}`],
    [L('库存看守', 'Stock watch'), 'rule', L('扣掉已接的订单，盯着每个产品的安全库存。', 'Tracks each product against its safety level, net of orders taken.'), `${b.low.length} ${L('个要补', 'low')}`],
    [L('收款跟进', 'Collections'), 'rule', L('货到付款和赊账的钱，超过期限没收到就提出来。', 'Raises cash-on-delivery and credit orders that pass their due time.'), `${b.owed.length} ${L('张未收', 'unpaid')}`],
    [L('批次与有效期', 'Batches & expiry'), 'rule', L('记住每一批的批号和有效期，快到期先提醒。', 'Keeps batch numbers and expiry dates, and warns ahead of expiry.'), `${b.expiring.length} ${L('批快到期', 'expiring')}`],
    [L('客户档案', 'Customer records'), 'rule', L('从订单里整理出每个客户买过多少、还欠多少。', 'Builds each customer\'s history and balance from their orders.'), `${customers().length} ${L('位客户', 'customers')}`],
    [L('文案起草', 'Copywriter'), 'ai', L('替产品写 Facebook、WhatsApp 群发和网店说明的文字。', 'Writes Facebook posts, WhatsApp broadcasts and store descriptions.'), ai ? L('按一下才动', 'Runs on tap') : L('这里用不了', 'Unavailable here')],
    [L('说法检查', 'Claim check'), 'rule', L('挡掉「根治」「100%」「无副作用」和别人的品牌名这一类会惹麻烦的字眼。', 'Stops wording such as "cures", "100%", "no side effects" and other companies\' brand names.'), L('每一份文案和回复', 'Every draft')],
    [L('商标与合规', 'Trademark & compliance'), 'rule', L('产品名字用了别人的商标，或者属于要登记的类别，就标出来。', 'Flags product names that use someone else\'s trademark or fall in a regulated category.'), `${b.flagged.length} ${L('个产品被标出', 'flagged')}`],
    [L('审批闸门', 'Approval gate'), 'rule', L('AI 写的东西，没有负责人批准就拿不到「可以发」的版本。', 'Nothing AI writes becomes sendable without the owner\'s approval.'), `${b.pending.length} ${L('项等批准', 'pending')}`],
  ];
  const off = [
    [L('WhatsApp 自动收发', 'WhatsApp auto send/receive'), L('要申请 WhatsApp Business API。现在是人手贴进来、按一下发出去。', 'Needs the WhatsApp Business API. For now messages are pasted in and sent with one tap.')],
    [L('网店订单自动同步', 'Online-store order sync'), L('要接网店的卖家接口。现在网店订单要手动开单。', 'Needs the store\'s seller API. For now store orders are entered by hand.')],
    [L('广告成效分析', 'Ad performance'), L('要接 Facebook 广告帐号。', 'Needs a connection to the Facebook ad account.')],
    [L('自动对账', 'Auto reconciliation'), L('要接银行或快递的代收款报表。现在是人手点「已收款」。', 'Needs bank or courier COD statements. For now payments are marked by hand.')],
    [L('定时推送日报', 'Scheduled daily report'), L('这个 app 只有在打开的时候才工作，不会自己半夜跑。', 'This app works while it is open; it does not run on its own overnight.')],
  ];
  return head(L('团队', 'Team'), L(`现在上岗的有 ${A.length} 个 agent：${A.filter(a => a[1] === 'rule').length} 个靠规则（不花钱、不会乱讲），${A.filter(a => a[1] === 'ai').length} 个靠 AI（按一下才动，写的东西都要人批准）。`, `${A.length} agents are on duty: ${A.filter(a => a[1] === 'rule').length} run on rules (free and predictable) and ${A.filter(a => a[1] === 'ai').length} use AI (only on tap, and a person approves what they write).`)) +
    `<section class="group"><h2>${L('已经上岗', 'On duty')}</h2><div class="list">${A.map(a => `<div class="item"><div class="body"><div class="t">${esc(a[0])} ${pill(a[1] === 'ai' ? 'acc' : '', a[1] === 'ai' ? 'AI' : L('规则', 'Rule'))}</div><div class="s">${esc(a[2])}</div></div><div class="r s">${esc(a[3])}</div></div>`).join('')}</div></section>
     <section class="group"><h2>${L('还没上岗', 'Not on duty yet')}</h2><div class="list">${off.map(a => `<div class="item"><div class="body"><div class="t">${esc(a[0])}</div><div class="s">${esc(a[1])}</div></div></div>`).join('')}</div></section>`;
};

// ---------------------------------------------------------------- frame
const NAV = { today: ['今天', 'Today'], orders: ['订单', 'Orders'], inbox: ['客服', 'Inbox'], products: ['产品', 'Products'], production: ['生产库存', 'Production'], customers: ['客户', 'Customers'], faq: ['标准答案', 'Answers'], marketing: ['营销', 'Marketing'], approvals: ['审批', 'Approvals'], team: ['团队', 'Team'] };

function render() {
  document.documentElement.lang = S.lang === 'zh' ? 'zh-Hans' : 'en';
  $('#brand').innerHTML = `<span class="mark" aria-hidden="true"><svg viewBox="0 0 16 20"><path d="M8 0c3 4.6 8 8.200 8 12.400A8 7.600 0 0 1 0 12.400C0 8.200 5 4.600 8 0z"/></svg></span><span style="min-width:0"><b>${esc(S.settings.company || L('工厂营运台', 'Factory Desk'))}</b><small>${L('订单 · 客服 · 库存 · 收款 · 营销', 'Orders · Service · Stock · Payments · Marketing')}</small></span>`;
  $('#langBtn').textContent = S.lang === 'zh' ? 'EN' : '中文';
  $('#setBtn').hidden = !S.isOwner || !S.ready;
  $('#setBtn').textContent = L('设置', 'Settings');
  let dots = {};
  if (S.ready) { const b = brief(); dots = { inbox: b.toReply.length, orders: b.ship.length, approvals: S.isOwner ? b.pending.length : 0 }; }
  $('#nav').innerHTML = VIEWS.map(v => `<button type="button" class="tab" data-act="go" data-v="${v}" ${S.view === v ? 'aria-current="page"' : ''}>${esc(lab(NAV, v))}${dots[v] ? `<span class="dot">${dots[v]}</span>` : ''}</button>`).join('');
  let h = '';
  if (S.mode === 'local') h += `<div class="note">${L('这一页现在没有连上云端数据库，资料只存在这一台设备的浏览器里，别人看不到。', 'This page is not connected to the shared database. Data stays in this browser only and nobody else can see it.')}</div>`;
  if (S.canWrite === false) h += `<div class="note">${L('你现在只有查看的权限，改不了资料。请负责人把你设成可以参与。', 'You have view-only access. Ask the owner to let you contribute.')}</div>`;
  if (!S.ready) h += S.stale ? `<div class="note">${L('读不到资料。可能是网络问题，请稍后再打开这一页。', 'Could not load the data. It may be the connection; please open this page again later.')}</div>` : `<div class="empty">${L('正在读取资料…', 'Loading…')}</div>`;
  else h += V[S.view]();
  $('#main').innerHTML = h;
}

let raf = 0;
function refresh() {
  if (raf) return;
  raf = requestAnimationFrame(() => { raf = 0; render(); if (S.sheet && !S.sheet.form) renderSheet(); });
}

let toastT = 0;
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toastT); toastT = setTimeout(() => { t.hidden = true; }, 3600);
}
