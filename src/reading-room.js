// The Reading Room: hand the town a document and it reads it the way a careful
// person would - looking for the money, the dates, the clauses that will cost
// you later, and the things that should be in here but are not.
//
// Everything below is found in your own document and quoted back. Nothing is
// invented. What it cannot find, it says it cannot find.

import { GUILDS } from './data.js';

/* ------------------------------------------------------------ what it is */

const TYPES = [
  { id: 'tenancy', en: 'Tenancy or lease', zh: '租约',
    hints: /tenan|landlord|lease|rental|premises|租[约赁]|房东|租客|承租/gi },
  { id: 'employment', en: 'Employment', zh: '雇佣合同',
    hints: /employ|salary|probation|resign|termination of service|雇[佣用]|薪[资金]|试用期|离职/gi },
  { id: 'insurance', en: 'Insurance', zh: '保险',
    hints: /insur|premium|policyholder|claim|excess|deductible|保[险费]|投保|理赔|免赔/gi },
  { id: 'service', en: 'Service or quotation', zh: '服务合同或报价',
    hints: /quotation|proposal|scope of work|deliverable|invoice|milestone|报价|服务范围|交付|发票/gi },
  { id: 'loan', en: 'Loan or financing', zh: '贷款',
    hints: /loan|borrower|lender|interest rate|repayment|principal|贷款|借款|利率|还款/gi },
];

export function detectType(text) {
  const scores = TYPES.map((t) => ({ t, n: (text.match(t.hints) || []).length }));
  scores.sort((a, b) => b.n - a.n);
  const best = scores[0];
  return best && best.n >= 3 ? best.t : { id: 'general', en: 'Document', zh: '文件' };
}

/* -------------------------------------------------------------- the checks */

// kind: 'flag'   - finding it is the warning
//       'expect' - not finding it is the warning
//       'both'   - quote it if present, flag its absence if not
export const CLAUSE_CHECKS = [
  {
    id: 'auto_renew', kind: 'flag', severity: 'high', guild: 'wayfinder',
    types: ['tenancy', 'service', 'insurance', 'general'],
    en: 'It renews itself', zh: '会自动续约',
    find: /automatic(?:ally)?\s+renew|auto-?renew|shall\s+(?:be\s+)?renew|renew(?:ed|s)?\s+automatically|自动续[约期签]|自动展期|自动延长/i,
    whyEn: 'This continues on its own unless you act in time. Miss the notice window and you are committed to another full term at whatever the new terms are.',
    whyZh: '不主动通知就自动继续。错过通知窗口，你就被锁进下一个完整周期，条件还可能已经改了。',
    askEn: 'Can renewal be by mutual written agreement instead of automatic?',
    askZh: '续约能不能改成「双方书面同意」而不是自动？',
    diary: true,
  },
  {
    id: 'unilateral_change', kind: 'flag', severity: 'high', guild: 'keystone',
    types: ['tenancy', 'service', 'insurance', 'loan', 'general'],
    en: 'They can change the terms alone', zh: '对方可以单方面改条件',
    find: /may\s+(?:revise|adjust|amend|vary|increase|change)[^.。]{0,80}without\s+(?:the\s+)?(?:consent|agreement|approval)|at\s+(?:its|his|their)\s+(?:sole\s+)?discretion|单方(?:面)?(?:变更|调整|修改)|无需(?:您|你|乙方)(?:的)?同意/i,
    whyEn: 'One side can move the terms after you have signed. Whatever number you agreed today is not the number you are protected at.',
    whyZh: '签完之后对方还能改条件。你今天谈定的数字，并不是你真正被保护的数字。',
    askEn: 'Can any change require my written agreement, or at least be capped?',
    askZh: '任何变更能不能要我书面同意，或者至少设一个上限？',
  },
  {
    id: 'unlimited_liability', kind: 'flag', severity: 'high', guild: 'mender',
    types: ['tenancy', 'employment', 'service', 'general'],
    en: 'Your liability has no ceiling', zh: '你的赔偿责任没有上限',
    find: /indemnif\w+[^.。]{0,120}(?:all|any)\s+(?:claims|losses|damages)|without\s+limit|unlimited\s+liability|of\s+any\s+nature\s+whatsoever|无限(?:连带)?责任|承担一切(?:损失|责任|赔偿)/i,
    whyEn: 'You are agreeing to cover losses with no cap. The worst case is not bounded by the size of this deal.',
    whyZh: '你答应赔偿的金额没有天花板。最坏情况不受这笔交易的金额限制。',
    askEn: 'Can liability be capped at the total value of this contract?',
    askZh: '赔偿上限能不能设成这份合同的总金额？',
  },
  {
    id: 'penalty', kind: 'flag', severity: 'high', guild: 'ledger',
    types: ['tenancy', 'employment', 'service', 'loan', 'general'],
    en: 'Leaving early costs you', zh: '提前退出要付代价',
    find: /forfeit|penalt(?:y|ies)|liquidated damages|early\s+termination[^.。]{0,80}(?:pay|charge|fee)|没收|违约金|罚[金款]|提前(?:解约|终止)[^.。]{0,40}(?:支付|赔偿)/i,
    whyEn: 'There is a price for getting out. Know the number before you sign, not when you need to leave.',
    whyZh: '退出是要付钱的。这个数字要在签之前就搞清楚，而不是等到你想走的时候。',
    askEn: 'What exactly do I owe if I end this early, in ringgit?',
    askZh: '如果我提前终止，具体要付多少钱？请给一个数字。',
  },
  {
    id: 'deposit_return', kind: 'both', severity: 'high', guild: 'ledger',
    types: ['tenancy'],
    en: 'When and how the deposit comes back', zh: '押金什么时候、怎么退',
    find: /deposit[^.。]{0,160}(?:refund|return|repaid)|refund(?:ed)?[^.。]{0,80}deposit|押金[^。]{0,60}(?:退还|返还)/i,
    whyEn: 'Check two things: how many days, and who decides the deductions. "Such deductions as the landlord deems reasonable" means you have no say.',
    whyZh: '看两件事：多少天内退，以及谁来决定扣多少。「房东认为合理的扣除」等于你没有发言权。',
    askEn: 'Can the deposit be returned within 14 days, with deductions itemised and evidenced?',
    askZh: '押金能不能 14 天内退，扣除项要逐项列明并附凭证？',
    missingEn: 'Nothing says when the deposit comes back or on what conditions. That is the single most common dispute in a tenancy.',
    missingZh: '整份文件没说押金什么时候退、按什么条件退。这是租约里最常见的纠纷。',
  },
  {
    id: 'repairs', kind: 'both', severity: 'medium', guild: 'forge',
    types: ['tenancy'],
    en: 'Who pays for repairs', zh: '维修谁出钱',
    find: /repair|maintenance|维修|保养|修缮/i,
    whyEn: 'Look for the word "structural". A tenant paying for structural repairs is unusual and can be very expensive - roof, walls, plumbing behind them.',
    whyZh: '注意「结构性」三个字。租客承担结构维修很不寻常，而且可能极贵——屋顶、墙体、埋在里面的水管。',
    askEn: 'Can structural and major repairs stay with the landlord, with a ringgit threshold for what I cover?',
    askZh: '结构性和重大维修能不能归房东，我承担的部分设一个金额上限？',
    missingEn: 'Repairs are not mentioned at all. When something breaks, this silence becomes an argument.',
    missingZh: '完全没提维修。真的坏东西的时候，这个空白就会变成争执。',
  },
  {
    id: 'entry', kind: 'flag', severity: 'medium', guild: 'keystone',
    types: ['tenancy'],
    en: 'They can come in', zh: '对方可以进入',
    find: /(?:enter|entry|access)[^.。]{0,100}(?:premises|property)|may\s+enter|进入(?:该)?(?:房屋|场所|物业)/i,
    whyEn: 'Check whether notice is required. "At any time" with no notice is not normal and is worth pushing back on.',
    whyZh: '看有没有要求提前通知。「任何时候」且不用通知不是常规做法，值得争。',
    askEn: 'Can entry require 24 hours written notice except in an emergency?',
    askZh: '除紧急情况外，进入能不能要求提前 24 小时书面通知？',
  },
  {
    id: 'non_compete', kind: 'flag', severity: 'high', guild: 'keystone',
    types: ['employment'],
    en: 'You cannot work elsewhere afterwards', zh: '离职后不能去同行',
    find: /non-?compet|restraint of trade|shall not[^.。]{0,100}(?:similar business|compete)|竞业(?:禁止|限制)/i,
    whyEn: 'Check three things: how long, what geography, and whether they pay you during it. An unpaid, unlimited-area clause is the one to fight.',
    whyZh: '看三件事：多久、限制哪个地区、这段期间给不给你补偿。没有补偿又不限地区的那种，一定要争。',
    askEn: 'How long is the restriction, what area does it cover, and is there compensation during that period?',
    askZh: '限制多久？范围是哪里？这期间有没有补偿？',
  },
  {
    id: 'ip_assignment', kind: 'both', severity: 'medium', guild: 'chorus',
    types: ['employment', 'service'],
    en: 'Who owns what you make', zh: '你做出来的东西归谁',
    find: /intellectual property|copyright|work(?:s)? (?:made|created)|shall (?:vest|belong)|知识产权|著作权|归属/i,
    whyEn: 'Check whether it covers only work done for them, or everything you create during the period, including your own projects at night.',
    whyZh: '看它覆盖的是「为他们做的工作」，还是「这期间你创造的一切」——包括你晚上自己做的东西。',
    askEn: 'Can this be limited to work created for the company, in working hours, using company resources?',
    askZh: '能不能限定为「为公司、在工作时间、用公司资源」做出来的东西？',
    missingEn: 'Ownership of what gets created is not addressed. If you are making something valuable, settle this before you start.',
    missingZh: '没说产出归谁。如果你要做的东西有价值，动手之前就该定下来。',
  },
  {
    id: 'exclusions', kind: 'both', severity: 'high', guild: 'lumen',
    types: ['insurance', 'service'],
    en: 'What is NOT covered', zh: '哪些不包含',
    find: /exclu(?:sion|ded|des)|not\s+covered|does not (?:cover|include)|shall not apply|除外(?:责任)?|不[包承]含|不适用/i,
    whyEn: 'This is where the real product is defined. Read the exclusions before the benefits - they are what you actually bought.',
    whyZh: '这里才定义了你真正买到的东西。先读除外责任再读保障范围——除外的部分才是你真实的边界。',
    askEn: 'Can you point me to every exclusion that would apply to my situation specifically?',
    askZh: '针对我的具体情况，有哪些除外责任会适用？请逐条指出来。',
    missingEn: 'No exclusions are stated. Either this is unusually generous, or they are in a separate document you have not been given.',
    missingZh: '没有列出除外责任。要么这份异常慷慨，要么它们在另一份你还没拿到的文件里。',
  },
  {
    id: 'waiting_period', kind: 'flag', severity: 'medium', guild: 'wayfinder',
    types: ['insurance'],
    en: 'You are not covered yet', zh: '还没开始保',
    find: /waiting period|qualifying period|no claims? (?:shall|will) be|等待期|观察期/i,
    whyEn: 'You are paying but not covered during this window. Know exactly when cover actually starts.',
    whyZh: '这段时间你在付钱但没有保障。要清楚保障到底从哪天开始。',
    askEn: 'What is the exact date cover begins for each benefit?',
    askZh: '每一项保障具体从哪一天开始生效？',
    diary: true,
  },
  {
    id: 'payment_terms', kind: 'both', severity: 'medium', guild: 'ledger',
    types: ['service', 'loan', 'general'],
    en: 'When money moves', zh: '钱什么时候付',
    find: /payment terms|invoice[^.。]{0,60}(?:days|upon)|payable (?:within|upon)|deposit of|付款(?:条件|方式|节点)|预付|尾款/i,
    whyEn: 'Check the split and what triggers each payment. Paying in full up front removes every bit of leverage you have.',
    whyZh: '看付款比例和每一笔的触发条件。全款预付等于你把所有筹码都交出去了。',
    askEn: 'Can payment be tied to delivered milestones rather than dates?',
    askZh: '付款能不能绑定「交付节点」而不是「日期」？',
    missingEn: 'No payment schedule. Agree it in writing before work starts, not after.',
    missingZh: '没有付款安排。动工之前就要白纸黑字定好，不要拖到之后。',
  },
  {
    id: 'scope_out', kind: 'expect', severity: 'high', guild: 'forge',
    types: ['service'],
    en: 'What is not included', zh: '不做什么',
    find: /not included|out of scope|excludes|不包[含括]|不在(?:服务)?范围/i,
    missingEn: 'Nothing states what is out of scope. Every argument on a project starts exactly here.',
    missingZh: '没写不做什么。项目上的争执全都从这里开始。',
    askEn: 'Can we list what is explicitly out of scope before we start?',
    askZh: '开始之前，能不能把「明确不包含」的部分列出来？',
  },
  {
    id: 'dispute', kind: 'expect', severity: 'medium', guild: 'keystone',
    types: ['tenancy', 'employment', 'service', 'loan', 'insurance'],
    en: 'How a dispute gets settled', zh: '出了纠纷怎么办',
    find: /dispute|arbitrat|mediat|jurisdiction|governing law|争议|仲裁|调解|管辖/i,
    missingEn: 'There is no dispute clause. If this goes wrong you will be working out where to even file it.',
    missingZh: '没有争议解决条款。真出事的时候，你连去哪里提都要先吵一轮。',
    askEn: 'Which courts or arbitration body settles a dispute, and under whose law?',
    askZh: '发生争议由哪个法院或仲裁机构管辖，适用哪里的法律？',
  },
  {
    id: 'notice_period', kind: 'both', severity: 'medium', guild: 'wayfinder',
    types: ['tenancy', 'employment', 'service', 'general'],
    en: 'How much warning you must give', zh: '要提前多久通知',
    find: /notice of (?:not less than|at least)?\s*\d+|(\d+)\s*(?:days|months)['’]?\s+(?:written\s+)?notice|提前\s*\d+\s*(?:天|日|个月)/i,
    whyEn: 'This is the number that decides whether you are free or trapped. Put the deadline in your calendar the day you sign.',
    whyZh: '这个数字决定你是自由的还是被困住的。签字当天就把这个截止日放进日历。',
    askEn: 'Is the notice period the same in both directions?',
    askZh: '通知期对双方是一样的吗？',
    diary: true,
    missingEn: 'No notice period is stated. Without it, either side can argue what is reasonable, and the stronger side usually wins that argument.',
    missingZh: '没写通知期。没有它，双方都可以各说各的「合理」，通常是强势的一方说了算。',
  },
];

/* ------------------------------------------------------------- the numbers */

const MONTHS = 'jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec';

const FIGURE_PATTERNS = [
  { kind: 'money', re: /(?:RM|MYR|USD|SGD|S\$|US\$|\$|£|€|¥|RMB)\s?\d[\d,]*(?:\.\d+)?(?:\s?(?:million|billion|m|k|万|亿))?/gi },
  { kind: 'money', re: /\d[\d,]*(?:\.\d+)?\s*(?:令吉|元|块钱|万元)/g },
  { kind: 'percent', re: /\d+(?:\.\d+)?\s*(?:%|per\s?cent|percent|厘)/gi },
  { kind: 'duration', re: /\d+\s*(?:days?|weeks?|months?|years?)\b/gi },
  { kind: 'duration', re: /\d+\s*(?:天|日|周|个月|年)/g },
  { kind: 'date', re: new RegExp(`\\d{1,2}\\s+(?:${MONTHS})[a-z]*\\s+\\d{4}`, 'gi') },
  { kind: 'date', re: new RegExp(`(?:${MONTHS})[a-z]*\\s+\\d{1,2},?\\s+\\d{4}`, 'gi') },
  { kind: 'date', re: /\d{4}\s*年\s*\d{1,2}\s*月(?:\s*\d{1,2}\s*日)?/g },
  { kind: 'date', re: /\d{4}-\d{2}-\d{2}/g },
];

// What this number is for, judged by the words around it.
const ROLES = [
  { id: 'rent', en: 'Rent', zh: '租金', re: /rent|monthly payment|租金|月租/i },
  { id: 'deposit', en: 'Deposit', zh: '押金', re: /deposit|bond|押金|保证金|订金/i },
  { id: 'penalty', en: 'Penalty', zh: '罚则', re: /penalt|forfeit|late|interest|违约|罚|逾期|利息/i },
  { id: 'fee', en: 'Fee', zh: '费用', re: /fee|charge|price|premium|invoice|salary|费|价|保费|薪/i },
  { id: 'notice', en: 'Notice period', zh: '通知期', re: /notice|通知/i },
  { id: 'term', en: 'Term', zh: '期限', re: /term|period|commenc|expir|duration|期限|起[至始]|到期/i },
  { id: 'increase', en: 'Increase', zh: '涨幅', re: /revise|increase|adjust|up to|涨|调[整高]/i },
];

const sentenceOf = (text, at) => {
  const from = Math.max(0, text.lastIndexOf('\n', at) + 1);
  const rest = text.slice(at);
  // "7. Repairs." is a heading, not a sentence - keep going until real words follow.
  let to = at;
  for (let i = 0; i < 3; i++) {
    const rel = text.slice(to).search(/[。!！?？\n]|\.(?=\s|$)/);
    to = rel < 0 ? Math.min(text.length, at + 220) : to + rel + 1;
    if (to - from > 45 || rel < 0) break;
  }
  const line = text.slice(from, Math.min(to, from + 300)).trim().replace(/\s+/g, ' ');
  return line.length > 240 ? `${line.slice(0, 237)}...` : line;
};

export function extractFigures(text) {
  const seen = new Set();
  const out = [];
  for (const { kind, re } of FIGURE_PATTERNS) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text))) {
      const value = m[0].replace(/\s+/g, ' ').trim();
      const context = sentenceOf(text, m.index);
      const key = `${kind}:${value.toLowerCase()}:${context.slice(0, 30)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const prefer = kind === 'duration' ? ['notice', 'term', 'penalty']
        : kind === 'percent' ? ['increase', 'penalty']
        : ['deposit', 'rent', 'penalty', 'fee'];
      const ranked = [...ROLES].sort((a, b) => {
        const ia = prefer.indexOf(a.id);
        const ib = prefer.indexOf(b.id);
        return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
      });
      const role = ranked.find((r) => r.re.test(context));
      out.push({ kind, value, context, role: role ? role.id : null });
      if (out.length > 60) break;
    }
  }
  const order = { money: 0, percent: 1, duration: 2, date: 3 };
  return out.sort((a, b) => order[a.kind] - order[b.kind]);
}

/* --------------------------------------------------------------- the read */

export function readDocument(text, lang = 'en') {
  const type = detectType(text);
  const en = lang !== 'zh';
  const applies = (c) => c.types.includes(type.id) || c.types.includes('general');

  const found = [];
  const missing = [];
  for (const check of CLAUSE_CHECKS) {
    if (!applies(check)) continue;
    check.find.lastIndex = 0;
    const m = check.find.exec(text);
    if (m) {
      if (check.kind === 'expect') continue;          // present is the good case
      found.push({ check, quote: sentenceOf(text, m.index) });
    } else if (check.kind !== 'flag') {
      missing.push(check);
    }
  }

  const rank = { high: 0, medium: 1 };
  found.sort((a, b) => rank[a.check.severity] - rank[b.check.severity]);
  missing.sort((a, b) => rank[a.severity] - rank[b.severity]);

  return {
    type,
    figures: extractFigures(text),
    notices: noticePeriods(text),
    found,
    missing,
    lang: en ? 'en' : 'zh',
  };
}

/* ------------------------------------------------------------ the calendar */

const MONTH_INDEX = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };

export function parseDate(value) {
  let m = /^(\d{1,2})\s+([a-z]{3})[a-z]*\s+(\d{4})$/i.exec(value.trim());
  if (m) return new Date(Number(m[3]), MONTH_INDEX[m[2].toLowerCase()], Number(m[1]));
  m = /^([a-z]{3})[a-z]*\s+(\d{1,2}),?\s+(\d{4})$/i.exec(value.trim());
  if (m) return new Date(Number(m[3]), MONTH_INDEX[m[1].toLowerCase()], Number(m[2]));
  m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  m = /^(\d{4})\s*年\s*(\d{1,2})\s*月(?:\s*(\d{1,2})\s*日)?$/.exec(value.trim());
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3] || 1));
  return null;
}

function daysOf(value) {
  const m = /(\d+)\s*(days?|weeks?|months?|years?|天|日|周|个月|年)/i.exec(value);
  if (!m) return null;
  const n = Number(m[1]);
  const unit = m[2].toLowerCase();
  if (/week|周/.test(unit)) return n * 7;
  if (/month|个月/.test(unit)) return n * 30;
  if (/year|年/.test(unit)) return n * 365;
  return n;
}

function fmt(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// A notice period is a number that sits next to the word "notice" - not just any
// duration in the same sentence. The term of the lease is not a notice period.
// "notice of not less than 90 days" and "90 days' written notice" both count.
// "24 months unless either party gives written notice" does not - that is the
// term of the agreement standing next to the word, not a notice period.
const NOTICE_RE = /(?:notice|通知)[^.。]{0,60}?(\d+)\s*(days?|weeks?|months?|天|日|周|个月)|(\d+)\s*(days?|weeks?|months?|天|日|周|个月)['’\s]{0,3}(?:written\s+|prior\s+|advance\s+|书面)?(?:notice|通知)/gi;

export function noticePeriods(text) {
  const out = [];
  NOTICE_RE.lastIndex = 0;
  let m;
  while ((m = NOTICE_RE.exec(text))) {
    const value = `${m[1] || m[3]} ${m[2] || m[4]}`;
    const days = daysOf(value);
    if (days && !out.some((o) => o.days === days)) out.push({ value, days, context: sentenceOf(text, m.index) });
  }
  return out;
}

// Dates worth putting in a calendar: when it ends, and the last day you can act.
export function diaryDates(read) {
  const en = read.lang === 'en';
  const dated = read.figures
    .filter((f) => f.kind === 'date')
    .map((f) => ({ ...f, at: parseDate(f.value) }))
    .filter((f) => f.at);
  if (!dated.length) return [];

  // The end of an agreement is the latest date spoken about in expiry language;
  // if nobody uses that language, it is simply the latest date in the document.
  const spoken = dated.filter((f) => /expir|until|end(?:s|ing)?|terminat|到期|届满|截止/i.test(f.context));
  const pool = spoken.length ? spoken : dated;
  const end = pool.reduce((a, b) => (b.at > a.at ? b : a));

  const out = [{
    when: fmt(end.at),
    what: en ? 'The agreement ends' : '合同到期',
    from: end.context,
  }];

  for (const notice of read.notices || []) {
    if (notice.days > 365) continue;                    // a term, not a notice period
    const act = new Date(end.at.getTime() - notice.days * 86400000);
    if (act >= end.at) continue;
    out.push({
      when: fmt(act),
      what: en
        ? `Last day to give notice - ${notice.value} before it ends`
        : `最后通知日——到期前 ${notice.value}`,
      from: notice.context,
      critical: true,
    });
  }
  out.sort((a, b) => (a.when < b.when ? -1 : 1));
  return out.slice(0, 5);
}

export { GUILDS as READING_GUILDS };
