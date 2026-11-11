(() => {
'use strict';

// ---------------------------------------------------------------- basics
const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const LS = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage may be blocked */ } },
};
const sleep = ms => new Promise(r => setTimeout(r, ms));
const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const DAY = 864e5;
const TAB_ID = newId();

const VIEWS = ['today', 'orders', 'inbox', 'products', 'production', 'customers', 'faq', 'marketing', 'approvals', 'team'];

const S = {
  lang: LS.get('ops-lang', 'zh'),
  view: 'today',
  mode: 'loading',          // loading | db | local
  ready: false, stale: false,
  isOwner: false, canWrite: true, uid: null, hasAI: false,
  products: [], stock: {}, costs: {}, batches: [], orders: [], faq: [], inbox: [], approvals: [],
  decisions: {}, custs: {},
  settings: { company: '', cur: 'Rs', cc: '92', codDays: 7, shipDays: 2 },
  filter: { orders: 'open', inbox: 'open', approvals: 'pending' },
  sheet: null,
};
let sample = null;

const L = (zh, en) => (S.lang === 'zh' ? zh : en);
const money = n => `${S.settings.cur || 'Rs'} ${Math.round(Number(n) || 0).toLocaleString('en-US')}`;
const pad = n => String(n).padStart(2, '0');
const fmtDate = ts => { if (!ts) return ''; const d = new Date(ts); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const fmtTime = ts => { if (!ts) return ''; const d = new Date(ts); return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const dayStart = (ts = Date.now()) => new Date(ts).setHours(0, 0, 0, 0);
function ago(ts) {
  const m = Math.max(0, Math.round((Date.now() - ts) / 6e4));
  if (m < 60) return L(`${m} 分钟`, `${m} min`);
  const h = Math.round(m / 60);
  if (h < 48) return L(`${h} 小时`, `${h} h`);
  return L(`${Math.round(h / 24)} 天`, `${Math.round(h / 24)} d`);
}
const digits = s => String(s || '').replace(/\D+/g, '');
// A local number (03xx...) becomes an international one for a wa.me link.
function waNumber(phone) {
  let d = digits(phone);
  if (!d) return '';
  if (d.startsWith('00')) d = d.slice(2);
  else if (d.startsWith('0')) d = (S.settings.cc || '92') + d.slice(1);
  return d;
}

// ---------------------------------------------------------------- the store
// Two backends behind one small surface: the artifact's shared database, or
// this browser's own storage when the page is opened where no database answers.
const Store = (() => {
  let db = null, local = null;
  const watchers = [];
  const split = p => { const i = p.lastIndexOf('/'); return [p.slice(0, i), p.slice(i + 1)]; };
  const clone = o => JSON.parse(JSON.stringify(o));
  const fire = coll => { for (const w of watchers) if (w.coll === coll) w.run(); };
  return {
    mode: 'loading',
    start(d) { if (d) { db = d; this.mode = 'db'; } else { local = LS.get('ops-local', {}); this.mode = 'local'; } },
    watch(coll, opts, cb, onErr) {
      if (db) {
        let q = db.collection(coll);
        if (opts.orderBy) q = q.orderBy(opts.orderBy, opts.dir || 'asc');
        if (opts.limit) q = q.limit(opts.limit);
        return q.onSnapshot(
          snap => cb(snap.docs.map(d => ({ ...d.data(), id: d.id })), !snap.metadata.fromCache),
          e => onErr && onErr(e));
      }
      const w = {
        coll,
        run() {
          let rows = Object.entries(local[coll] || {}).map(([id, v]) => ({ ...clone(v), id }));
          if (opts.orderBy) {
            const k = opts.orderBy, s = opts.dir === 'desc' ? -1 : 1;
            rows.sort((a, b) => ((a[k] ?? 0) < (b[k] ?? 0) ? -s : (a[k] ?? 0) > (b[k] ?? 0) ? s : 0));
          }
          if (opts.limit) rows = rows.slice(0, opts.limit);
          cb(rows, true);
        },
      };
      watchers.push(w);
      setTimeout(() => w.run(), 0);
      return () => {};
    },
    async get(path) {
      if (db) { const s = await db.doc(path).get(); return s.exists ? { ...s.data() } : null; }
      const [c, id] = split(path); return local[c]?.[id] ? clone(local[c][id]) : null;
    },
    async set(path, data) {
      if (db) return db.doc(path).set(clone(data));
      const [c, id] = split(path); (local[c] ||= {})[id] = clone(data); LS.set('ops-local', local); fire(c);
    },
    async update(path, data) {
      if (db) return db.doc(path).update(clone(data));
      const [c, id] = split(path);
      if (!local[c]?.[id]) throw { code: 'invalid_argument' };
      Object.assign(local[c][id], clone(data)); LS.set('ops-local', local); fire(c);
    },
    // A short cooperative lease, so two people shipping at once cannot both
    // read the same stock figure and each write back their own subtraction.
    async acquire(path) {
      if (!db) return true;
      const r = await db.doc(path).acquire({ holder: TAB_ID, ttlMs: 4000 });
      return !!r.acquired;
    },
  };
})();

function errText(e) {
  const c = e && e.code;
  if (c === 'invalid_argument') return L('存不进去：你可能没有这一项的修改权限。', 'Could not save: you may not have permission to change this.');
  if (c === 'quota_exceeded') return L('数据库满了，请联系负责人清理旧记录。', 'The database is full. Ask the owner to archive old records.');
  if (c === 'resource_exhausted') return L('操作太频繁，过几秒再试。', 'Too many requests. Try again in a few seconds.');
  if (c === 'revoked' || c === 'not_granted') return L('这个页面的数据权限被收回了，请重新打开。', 'Data access was withdrawn. Reopen the page.');
  if (c === 'busy') return L('别人正在改同一笔资料，过几秒再试。', 'Someone else is changing the same record. Try again in a few seconds.');
  return L('暂时连不上，请再试一次。', 'Could not reach the data. Please try again.');
}
async function save(fn, okMsg) {
  try { await fn(); if (okMsg) toast(okMsg); return true; }
  catch (e) {
    if (e && e.code === 'unavailable') { try { await sleep(600 + Math.random() * 600); await fn(); if (okMsg) toast(okMsg); return true; } catch (e2) { toast(errText(e2)); return false; } }
    toast(errText(e)); return false;
  }
}

// Stock lives in its own document per product and only ever changes here.
async function changeStock(pid, delta, absolute) {
  const path = 'stock/' + pid;
  for (let i = 0; i < 6; i++) {
    if (await Store.acquire(path)) {
      const cur = await Store.get(path);
      const qty = absolute != null ? absolute : (Number(cur?.qty) || 0) + delta;
      await Store.set(path, { qty, ts: Date.now() });
      return qty;
    }
    await sleep(500 + Math.random() * 500);
  }
  throw { code: 'busy' };
}

// ---------------------------------------------------------------- house rules
const CATS = { home: ['家居清洁', 'Home care'], skin: ['护肤', 'Skin care'], pest: ['驱虫', 'Pest control'] };
const CHANNELS = { wa: ['WhatsApp', 'WhatsApp'], fb: ['Facebook / Instagram', 'Facebook / Instagram'], shop: ['网店', 'Online store'], dist: ['经销商', 'Distributor'], b2b: ['企业 / 政府', 'Business / government'], walk: ['门市', 'Walk-in'] };
const TIERS = { r: ['零售价', 'Retail'], d: ['经销商价', 'Distributor'], b: ['企业价', 'Business'] };
const PAYS = { cod: ['货到付款', 'Cash on delivery'], pre: ['先付款', 'Prepaid'], credit: ['赊账', 'On credit'] };

const BRAND_RE = /\b(harpic|surf\s?excel|surf|mortein|dettol|lifebuoy|safeguard|vim|ariel|tide|lux|colin|finis|fair\s?(?:&|and)\s?lovely|glow\s?(?:&|and)\s?lovely|head\s?(?:&|and)\s?shoulders|sunsilk|pantene)\b/i;

const FLAGS = {
  tm: ['名字里有别人的注册商标（例如 Harpic、Surf）。用别人的牌子卖自己做的产品，会被品牌方投诉、被网店下架，也有法律风险。请换成你自己的品牌名。',
       "The name contains another company's registered trademark (such as Harpic or Surf). Selling your own product under it invites complaints, marketplace takedowns and legal risk. Use your own brand name."],
  tmlike: ['名字和一个知名品牌很像。建议换一个明显不同的名字，免得被当成仿冒。',
           'The name closely resembles a well-known brand. Choose a clearly different name so it is not taken for an imitation.'],
  skin: ['美白、祛斑、面霜这一类：上市前请确认成分检测（尤其汞、氢醌、类固醇）和当地的登记要求；标签要写全成分、批号、生产日期和有效期。',
         'Whitening, freckle and face creams: confirm ingredient testing (mercury, hydroquinone and steroids in particular) and local registration rules before selling; the label needs full ingredients, batch number, manufacture and expiry dates.'],
  drug: ['「祛痘」是治疗类的说法，在很多地方会被当成药品来管。请向当地主管部门确认，或者把说法改成护理类。',
         '"Acne" is a treatment claim and in many places makes the product a medicine. Check with the local regulator, or reword it as a care product.'],
  pest: ['驱蚊、杀虫类产品通常要先登记有效成分才能卖。请向当地主管部门确认。',
         'Mosquito and insect products usually need their active ingredient registered before sale. Check with the local regulator.'],
};

const CLAIMS = [
  { k: 'brand', re: BRAND_RE, t: ['用了别人的品牌名', "Uses another company's brand name"] },
  { k: 'medical', re: /\b(cures?|cured|treats?|treatment|heals?|healing|medicated|prescription)\b|治疗|治愈|根治|علاج/i, t: ['治疗类说法：护肤和清洁产品不能说能治病', 'Medical claim: care and cleaning products cannot claim to treat'] },
  { k: 'absolute', re: /100\s?%|\bguarantee[ds]?\b|\bpermanent(?:ly)?\b|\bforever\b|保证|永久|百分之百|گارنٹی/i, t: ['绝对化的说法（100%、保证、永久）', 'Absolute claim (100%, guaranteed, permanent)'] },
  { k: 'safe', re: /no side[- ]?effects?|completely safe|totally safe|无副作用|零副作用|绝对安全/i, t: ['「无副作用 / 绝对安全」没有办法证明', '"No side effects / completely safe" cannot be proven'] },
  { k: 'endorse', re: /(dermatologist|doctor|clinically)[- ]?(approved|recommended|tested|proven)|医生推荐|临床验证|皮肤科/i, t: ['专业背书的说法，要有文件证明', 'Professional endorsement needs documents to back it'] },
  { k: 'germ', re: /99(?:\.9+)?\s?%|kills? all (germs|bacteria)|杀死.{0,4}(细菌|病菌)/i, t: ['杀菌比例的说法，要有检测报告', 'Germ-kill figures need a test report'] },
  { k: 'time', re: /\b(?:in|within)\s+(?:just\s+)?\d+\s+(?:days?|nights?|weeks?)\b|\d+\s*天内?(见效|变白|美白)|instant(?:ly)?\s+(fair|white|glow)/i, t: ['承诺多少天见效', 'Promises results in a set number of days'] },
  { k: 'whiten', re: /\bwhiten(?:s|ing)?\b|\bfairness\b|fair(?:er)? skin|美白|گورا/i, t: ['美白的说法在很多平台受限制，建议改成「提亮、均匀肤色」', 'Whitening claims are restricted on many platforms; consider "brightening, even tone"'] },
];
const checkClaims = text => CLAIMS.filter(c => c.re.test(text || '')).map(c => c.k);
const claimText = k => { const c = CLAIMS.find(x => x.k === k); return c ? L(c.t[0], c.t[1]) : k; };

function autoFlags(name, cat) {
  const out = [];
  if (BRAND_RE.test(name || '')) out.push('tm');
  if (/\bmatrin\b|\bmortin\b|\bharpik\b/i.test(name || '')) out.push('tmlike');
  if (cat === 'skin') out.push('skin');
  if (cat === 'skin' && /acne|pimple|祛痘|痘/i.test(name || '')) out.push('drug');
  if (cat === 'pest') out.push('pest');
  return out;
}

// Match a customer message against approved answers without a model.
const STOP = new Set(['the', 'and', 'for', 'you', 'your', 'are', 'have', 'has', 'with', 'this', 'that', 'what', 'how', 'can', 'please', 'kya', 'hai', 'hain', 'aap', 'mujhe', 'ka', 'ki', 'ke', 'ko', 'se']);
const tokens = s => (String(s || '').toLowerCase().match(/[a-z0-9]{2,}|[؀-ۿ]{2,}|[一-鿿]/g) || []).filter(t => !STOP.has(t));
function matchFaq(text) {
  const msg = new Set(tokens(text));
  let best = null;
  for (const f of S.faq) {
    if (f.on === false) continue;
    const kw = tokens(f.kw), q = tokens(f.q);
    const kwHit = kw.filter(t => msg.has(t)).length;
    const qHit = q.filter(t => msg.has(t)).length;
    const score = kwHit * 2 + qHit;
    const strong = kwHit >= 2 || (kwHit >= 1 && qHit >= 2) || (q.length >= 2 && qHit / q.length >= 0.7);
    if (strong && (!best || score > best.score)) best = { f, score };
  }
  return best ? best.f : null;
}

// ---------------------------------------------------------------- derived
const prod = id => S.products.find(p => p.id === id);
const pname = p => (p ? p.name + (p.size ? ` · ${p.size}` : '') : L('（已删除的产品）', '(removed product)'));
const stockOf = id => Number(S.stock[id]?.qty) || 0;
function reserved() {
  const m = {};
  for (const o of S.orders) if (o.status === 'new') for (const it of o.items || []) m[it.pid] = (m[it.pid] || 0) + (Number(it.qty) || 0);
  return m;
}
const priceFor = (p, tier) => Number(tier === 'd' ? p.pd : tier === 'b' ? p.pb : p.pr) || 0;
const decided = id => S.decisions[id]?.status || 'pending';
const orderTotal = o => (o.items || []).reduce((s, it) => s + (Number(it.qty) || 0) * (Number(it.price) || 0), 0);
const isOwed = o => (o.status === 'shipped' || o.status === 'done') && !o.paid;
const readyToShip = o => o.status === 'new' && (o.pay !== 'pre' || o.paid);
const awaitingPay = o => o.status === 'new' && o.pay === 'pre' && !o.paid;

function brief() {
  const now = Date.now(), t0 = dayStart(), m0 = new Date(new Date().getFullYear(), new Date().getMonth(), 1).getTime();
  const res = reserved();
  const live = S.orders.filter(o => o.status !== 'cancelled');
  const today = live.filter(o => o.ts >= t0 && o.status !== 'returned');
  const month = live.filter(o => o.ts >= m0 && o.status !== 'returned');
  const owed = S.orders.filter(isOwed);
  const lateOwed = owed.filter(o => now - (o.shipTs || o.ts) > (S.settings.codDays || 7) * DAY);
  const ship = S.orders.filter(readyToShip);
  const lateShip = ship.filter(o => now - (o.paidTs || o.ts) > (S.settings.shipDays || 2) * DAY);
  const active = S.products.filter(p => p.on !== false);
  const low = active.filter(p => { const a = stockOf(p.id) - (res[p.id] || 0); return a <= (Number(p.safe) || 0) && (Number(p.safe) > 0 || (res[p.id] || 0) > 0); })
    .map(p => ({ p, avail: stockOf(p.id) - (res[p.id] || 0), res: res[p.id] || 0 }));
  const short = low.filter(x => x.avail < 0);
  const openInbox = S.inbox.filter(i => i.status !== 'answered');
  const toReply = S.inbox.filter(i => i.status === 'new' || i.status === 'approved');
  const pending = S.approvals.filter(a => decided(a.id) === 'pending');
  const noPrice = active.filter(p => !Number(p.pr));
  const flagged = active.filter(p => (p.flags || []).length);
  const expiring = S.batches.filter(b => b.kind !== 'adj' && b.exp && b.exp - now < 60 * DAY);
  return { today, month, owed, lateOwed, ship, lateShip, low, short, openInbox, toReply, pending, noPrice, flagged, expiring, res,
    todaySum: today.reduce((s, o) => s + orderTotal(o), 0), monthSum: month.reduce((s, o) => s + orderTotal(o), 0), owedSum: owed.reduce((s, o) => s + orderTotal(o), 0) };
}

function customers() {
  const m = new Map();
  for (const o of S.orders) {
    if (o.status === 'cancelled') continue;
    const key = digits(o.phone) || 'n:' + (o.name || '').trim().toLowerCase();
    if (!key || key === 'n:') continue;
    const c = m.get(key) || { key, name: o.name, phone: o.phone, city: o.city, ctype: o.tier, n: 0, sum: 0, owed: 0, last: 0 };
    c.n++; if (o.status !== 'returned') c.sum += orderTotal(o); if (isOwed(o)) c.owed += orderTotal(o);
    if (o.ts > c.last) { c.last = o.ts; c.name = o.name || c.name; c.city = o.city || c.city; c.ctype = o.tier || c.ctype; }
    m.set(key, c);
  }
  return [...m.values()].sort((a, b) => b.last - a.last);
}
