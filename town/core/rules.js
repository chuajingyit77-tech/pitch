// Deterministic checks. No model, no network, no cost, same answer every time.
//
// Eleven of the 66 agents run entirely on these; five more use one to narrow
// the ground before a model looks. That is the cost lever: the cheap, boring,
// highest-hit-rate checks never need a model at all, so swapping Claude for a
// small local model degrades judgement, not coverage.
//
// Every rule returns the same shape:
//   { verdict: 'pass' | 'flag' | 'fail' | 'skip', finding, evidence, severity, ask, data }
// 'skip' means "nothing here I can judge" -- honest, and lets the model partner
// in a hybrid check take over instead of inheriting a fake pass.

// Money, in the shapes it actually appears in: "RM 4,500", "450 万令吉",
// "RM 4.5 million". Group 1/2 = amount+magnitude when the currency leads,
// group 3/4 = amount+magnitude when the currency trails.
const num = s => Number(String(s).replace(/,/g, ''));
const MAG = '(万|萬|億|亿|千|百万|百萬|million|billion)';
const CURRENCY = new RegExp(
  `(?:\\b(?:RM|MYR|USD|SGD|AUD|RMB|CNY|EUR|GBP)|US\\$|S\\$|HK\\$|\\$|¥|€|£)\\s?([\\d][\\d,]*(?:\\.\\d+)?)\\s*${MAG}?` +
  `|([\\d][\\d,]*(?:\\.\\d+)?)\\s*${MAG}?\\s*(?:令吉|元|万元|美元|新币|港币|ringgit|dollars?)`,
  'gi');

const MAG_SCALE = { '万': 1e4, '萬': 1e4, '億': 1e8, '亿': 1e8, '千': 1e3, '百万': 1e6, '百萬': 1e6, 'million': 1e6, 'billion': 1e9 };

// The numeric value of a CURRENCY match, magnitude applied.
function amountOf(m) {
  const raw = m[1] ?? m[3];
  const mag = (m[2] ?? m[4] ?? '').toLowerCase();
  return num(raw) * (MAG_SCALE[mag] ?? MAG_SCALE[m[2] ?? m[4]] ?? 1);
}
const DATE = /\b(?:19|20)\d{2}\s*[-/年]\s*\d{1,2}\s*[-/月]\s*\d{1,2}\s*日?|\b\d{1,2}\s*[-/]\s*\d{1,2}\s*[-/]\s*(?:19|20)?\d{2}\b|\b\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+(?:19|20)\d{2}\b|(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2},?\s+(?:19|20)\d{2}\b|\b(?:19|20)\d{2}\s*年\s*\d{1,2}\s*月/gi;
const DURATION = /(\d+)\s*(?:个)?\s*(days?|weeks?|months?|years?|天|日|周|週|个月|個月|年|工作日|working\s+days?|business\s+days?)/gi;
const SOURCE_HINT = /来源|資料來源|数据来自|資料來自|根据|依据|據|引自|出自|参见|參見|source|sources|according to|based on|per the|cited|reference|\[\d+\]|（\s*\d{4}\s*）|\(\s*\d{4}\s*\)/i;

// A number that reads as a statistic: a percentage, a magnitude, a grouped
// figure, or a free-standing number of three digits or more. "FT050" (a road
// code) and "Phase 2" are not statistics.
const STAT = /\d[\d,]*(?:\.\d+)?\s*%|\d+(?:\.\d+)?\s*(?:万|萬|億|亿|千|倍|million|billion|thousand)|\b\d{1,3}(?:,\d{3})+\b|\b[1-9]\d{2,}\b/i;

// Undo hard wrapping: re-join hyphenated words and lines that continue in
// lowercase. Line structure is kept in ctx.text for the rules that need it
// (tables, headings); sentence-level rules and quotes use the reflowed text.
export function reflow(text) {
  return String(text || '')
    .replace(/(\p{L})-\n+[ \t]*(\p{Ll})/gu, '$1$2')
    .replace(/([^\n.。!！?？:：;；|])[ \t]*\n+[ \t]*(?=\p{Ll})/gu, '$1 ');
}

function sentences(text) {
  return text
    .split(/(?<=[。！？!?；;])|\n+/)
    .map(s => s.trim())
    .filter(Boolean);
}

// The sentence (or line) a match sits in -- evidence a person can check.
function quoteAround(text, re) {
  const m = text.match(re);
  if (!m) return '';
  const at = text.indexOf(m[0]);
  const from = Math.max(0, text.lastIndexOf('\n', at) + 1);
  let to = text.indexOf('\n', at);
  if (to === -1) to = text.length;
  const line = text.slice(from, Math.min(to, from + 320)).trim();
  return line.length > 300 ? line.slice(0, 300) + '…' : line;
}

function has(text, re) { return re.test(text); }
function count(text, re) { return (text.match(re) || []).length; }

function result(verdict, finding, extra = {}) {
  return { verdict, finding, evidence: '', severity: 'medium', ask: '', data: null, ...extra };
}

export const RULES = {

  price_stated(ctx) {
    const amounts = [...ctx.text.matchAll(CURRENCY)];
    if (!amounts.length) {
      return result('fail', '文件里找不到任何金额。没有价钱的提案对方无法决定。', {
        severity: 'high', ask: '总价是多少？用什么货币？含不含税？',
      });
    }
    const taxed = has(ctx.text, /含税|不含税|未含税|含\s*SST|不含\s*SST|SST|GST|VAT|excl(?:uding|\.)?\s*(?:tax|SST|GST)|incl(?:uding|usive)?\s*(?:of\s*)?(?:tax|SST|GST)|税前|税后/i);
    // A quotation expires; a signed contract does not. Only ask proposals.
    const needsValidity = ctx.type === 'proposal';
    const valid = has(ctx.text, /有效期|报价有效|報價有效|有效至|valid\s+(?:for|until|till|through)|quotation\s+valid|offer\s+expires|有效期限/i);
    const missing = [!taxed && '含税与否', needsValidity && !valid && '报价有效期'].filter(Boolean);
    if (missing.length) {
      return result('flag', `有金额，但缺：${missing.join('、')}。`, {
        severity: missing.length > 1 ? 'medium' : 'low',
        evidence: quoteAround(ctx.flow ?? ctx.text, CURRENCY),
        ask: `补上${missing.join('和')}。`,
        data: { amounts: amounts.length },
      });
    }
    return result('pass', `金额、货币、含税说明${needsValidity ? '、报价有效期' : ''}都有（共 ${amounts.length} 处金额）。`, {
      severity: 'low', evidence: quoteAround(ctx.flow ?? ctx.text, CURRENCY), data: { amounts: amounts.length },
    });
  },

  arithmetic(ctx) {
    const lines = ctx.text.split('\n');
    const totalRe = /^(?:\s*)(?:总计|總計|合计|合計|总价|總價|总额|總額|小计|小計|subtotal|total|grand\s+total|sum)\s*[:：]?/i;
    const problems = [];
    let checked = 0;

    for (let i = 0; i < lines.length; i++) {
      if (!totalRe.test(lines[i])) continue;
      const totals = [...lines[i].matchAll(CURRENCY)].map(amountOf);
      if (!totals.length) continue;
      const stated = totals[totals.length - 1];

      // Walk back over contiguous item lines that each carry exactly one amount.
      const items = [];
      for (let j = i - 1; j >= 0; j--) {
        const line = lines[j].trim();
        if (!line) { if (items.length) break; else continue; }
        if (totalRe.test(line)) break;
        const ms = [...line.matchAll(CURRENCY)];
        if (ms.length !== 1) break;
        items.unshift(amountOf(ms[0]));
      }
      if (items.length < 2) continue;

      checked++;
      const sum = items.reduce((a, b) => a + b, 0);
      const diff = Math.abs(sum - stated);
      if (diff > Math.max(1, stated * 0.005)) {
        problems.push({ line: lines[i].trim(), stated, sum: Number(sum.toFixed(2)), diff: Number(diff.toFixed(2)), items: items.length });
      }
    }

    const badPercent = [...ctx.text.matchAll(/(\d+(?:\.\d+)?)\s*%/g)]
      .map(m => Number(m[1])).filter(p => p > 100);

    if (problems.length) {
      const p = problems[0];
      return result('fail', `加总对不上：分项加起来是 ${p.sum}，文件写 ${p.stated}，差 ${p.diff}。`, {
        severity: 'high', evidence: p.line,
        ask: '核对这张表的分项与总计，改到一致。',
        data: { problems, checked },
      });
    }
    if (badPercent.length) {
      return result('flag', `有超过 100% 的百分比：${badPercent.slice(0, 3).join('、')}%。可能是写错或基准不同。`, {
        severity: 'medium', ask: '确认这些百分比的基准。', data: { badPercent },
      });
    }
    if (!checked) {
      return result('skip', '没有找到「分项 + 总计」这种可以核对的结构。', { severity: 'low', data: { checked: 0 } });
    }
    return result('pass', `核对了 ${checked} 处加总，都对得上。`, { severity: 'low', data: { checked } });
  },

  payment_terms(ctx) {
    const pay = /付款|付清|支付|分期|首期|订金|訂金|定金|押金|保证金|保證金|尾款|结款|結款|payment|deposit|instal?ment|retainer|milestone\s+payment|net\s*\d+|upon\s+(?:signing|delivery|completion)/i;
    if (!has(ctx.text, pay)) {
      return result('fail', '完全没有写付款安排。什么时候收到钱，比收多少钱更要紧。', {
        severity: 'high', ask: '分几期付？每一期的触发条件是什么？收到发票后多少天内付？',
      });
    }
    const late = /逾期|滞纳|滯納|违约金|違約金|late\s+payment|overdue|interest\s+(?:on|at)|停止服务|停工|suspend/i;
    const schedule = /\d+\s*%|首期|第一期|第二期|签约后|簽約後|验收后|驗收後|upon|milestone|net\s*\d+|分\s*\d+\s*期/i;
    const missing = [!schedule && '分期比例或触发条件', !late && '逾期处理'].filter(Boolean);
    if (missing.length) {
      return result('flag', `有付款条款，但缺：${missing.join('、')}。`, {
        severity: 'medium', evidence: quoteAround(ctx.flow ?? ctx.text, pay),
        ask: `补上${missing.join('和')}。`,
      });
    }
    return result('pass', '付款节点、触发条件、逾期处理都写了。', {
      severity: 'low', evidence: quoteAround(ctx.flow ?? ctx.text, pay),
    });
  },

  dates_present(ctx) {
    const dates = [...ctx.text.matchAll(DATE)].map(m => m[0].trim());
    const durations = [...ctx.text.matchAll(DURATION)].map(m => m[0].trim());
    if (!dates.length && !durations.length) {
      return result('fail', '没有任何日期或工期。没有日期的计划不是计划。', {
        severity: 'high', ask: '开始日、结束日、中间节点，各是哪一天？',
      });
    }
    const ambiguous = has(ctx.text, /工作日|working\s+days?|business\s+days?/i) && has(ctx.text, /(?<!工作)日历|(?<!工作)天|calendar\s+days?/i);
    if (dates.length < 2) {
      return result('flag', `只找到 ${dates.length} 个具体日期（另有 ${durations.length} 处工期表述）。节点日期不足。`, {
        severity: 'medium', evidence: (dates[0] || durations[0] || ''),
        ask: '把每个阶段的起止日期写出来，不要只写「第一阶段」。',
        data: { dates, durations },
      });
    }
    if (ambiguous) {
      return result('flag', '同时出现「工作日」和「天」，单位不一致，算工期会差。', {
        severity: 'medium', ask: '统一成工作日或日历天，并在文件里说明。',
        data: { dates, durations },
      });
    }
    return result('pass', `找到 ${dates.length} 个日期、${durations.length} 处工期表述，单位一致。`, {
      severity: 'low', data: { dates: dates.slice(0, 12), durations: durations.slice(0, 12) },
    });
  },

  units_consistent(ctx) {
    const tokens = new Set();
    for (const m of ctx.text.matchAll(/\b(RM|MYR|USD|SGD|AUD|RMB|CNY|EUR|GBP)\b|(US\$|S\$|HK\$|\$|¥|€|£)|(令吉|美元|新币|港币|人民币)/gi)) {
      const t = (m[1] || m[2] || m[3] || '').toUpperCase();
      const norm = { 'MYR': 'RM', '令吉': 'RM', 'US$': 'USD', '美元': 'USD', 'S$': 'SGD', '新币': 'SGD', 'CNY': 'RMB', '人民币': 'RMB', '¥': 'RMB', '港币': 'HKD', 'HK$': 'HKD' }[t] || t;
      tokens.add(norm);
    }
    const dayMix = has(ctx.text, /工作日|working\s+days?|business\s+days?/i) && has(ctx.text, /日历天|calendar\s+days?/i);
    const monthMix = has(ctx.text, /\b30\s*(?:days?|天)/i) && has(ctx.text, /(?:1|一)\s*(?:个月|個月|month)/i);

    if (tokens.size > 1) {
      return result('fail', `混用了 ${tokens.size} 种货币：${[...tokens].join('、')}。会让人算错钱。`, {
        severity: 'high', ask: '统一货币，或在每个金额旁标明货币并给出汇率与汇率日。',
        data: { currencies: [...tokens] },
      });
    }
    const notes = [dayMix && '工作日与日历天混用', monthMix && '「30 天」与「一个月」混用'].filter(Boolean);
    if (notes.length) {
      return result('flag', `时间单位不一致：${notes.join('、')}。`, { severity: 'medium', ask: '统一时间单位。' });
    }
    return result('pass', `货币统一（${[...tokens][0] || '无金额'}），时间单位一致。`, { severity: 'low', data: { currencies: [...tokens] } });
  },

  has_structure(ctx) {
    const lines = ctx.text.split('\n');
    const headings = lines.filter(l => {
      const t = l.trim();
      if (!t || t.length > 60) return false;
      return /^#{1,6}\s/.test(t)
        || /^(?:\d+|[一二三四五六七八九十]+)\s*[.、）)]\s*\S/.test(t)
        || /^第\s*[一二三四五六七八九十\d]+\s*[章节節条條部分]/.test(t)
        || (/^[A-Z][A-Z\s&/-]{3,}$/.test(t) && !/\./.test(t))
        || /^-{3,}\s/.test(t);
    });
    const bullets = lines.filter(l => /^\s*(?:[-*•·]|\d+[.)、]|\(\d+\))\s+\S/.test(l)).length;
    const paras = ctx.text.split(/\n\s*\n/).map(p => p.replace(/\s+/g, ' ').trim()).filter(Boolean);
    const walls = paras.filter(p => p.length > 600);
    const hasSummary = /摘要|概述|执行摘要|執行摘要|总结|總結|結論|结论|summary|overview|executive\s+summary|tl;?dr/i.test(ctx.text.slice(0, Math.min(1800, ctx.text.length)));

    if (!headings.length && ctx.text.length > 1200) {
      return result('fail', `${Math.round(ctx.text.length / 100) / 10} 千字，没有一个标题。忙的人只会扫，不会读。`, {
        severity: 'high', ask: '切成有标题的小节，并把结论放到最前面。',
        data: { headings: 0, bullets, walls: walls.length },
      });
    }
    const missing = [!hasSummary && '开头的摘要或结论', walls.length > 0 && `${walls.length} 段过长的文字`].filter(Boolean);
    if (missing.length) {
      return result('flag', `有 ${headings.length} 个标题，但缺：${missing.join('；')}。`, {
        severity: 'medium', evidence: walls[0] ? walls[0].slice(0, 200) + '…' : '',
        ask: hasSummary ? '把长段落拆成清单或表格。' : '在最前面加一段三到五行的摘要。',
        data: { headings: headings.length, bullets, walls: walls.length },
      });
    }
    return result('pass', `${headings.length} 个标题、${bullets} 个清单项、有摘要，可以扫读。`, {
      severity: 'low', data: { headings: headings.length, bullets, walls: 0 },
    });
  },

  deliverables_listed(ctx) {
    const marker = /交付物|交付成果|服务内容|服務內容|工作范围|工作範圍|工作内容|产出|產出|deliverable|scope\s+of\s+work|statement\s+of\s+work|what\s+you\s+(?:get|receive)|服务项目/i;
    if (!has(ctx.text, marker)) {
      return result('fail', '找不到交付物清单。说不清交什么，就等着吵架。', {
        severity: 'high', ask: '一样一样列出要交的东西，每一样写数量和格式。',
      });
    }
    const openEnded = ctx.text.match(/等等|等相关|等相關|及相关|及相關|以及其他|其他相关|其他相關|etc\.?|and\s+(?:other|related|such)\s+\w+|as\s+(?:needed|required)|无限次|不限次数|不限次數|修改至满意|修改至滿意|until\s+satisf/gi) || [];
    const quantified = count(ctx.text, /\d+\s*(?:份|套|个|個|页|頁|版|轮|輪|次|稿|times?|rounds?|copies|pages?|sets?|versions?)/gi);

    if (openEnded.length) {
      return result('fail', `有开口条款 ${openEnded.length} 处（${[...new Set(openEnded)].slice(0, 3).join('、')}），范围可以无限膨胀。`, {
        severity: 'high', evidence: quoteAround(ctx.flow ?? ctx.text, /等等|等相关|及相关|etc\.?|无限次|修改至满意|until\s+satisf/i),
        ask: '把开口的地方改成具体数量，并写明超出之后怎么算。',
        data: { openEnded: [...new Set(openEnded)] },
      });
    }
    if (quantified < 2) {
      return result('flag', '有交付物清单，但多数没有数量（几份、几页、几轮修改）。', {
        severity: 'medium', evidence: quoteAround(ctx.flow ?? ctx.text, marker),
        ask: '给每一项交付物加上数量和交付格式。',
        data: { quantified },
      });
    }
    return result('pass', `交付物有清单，${quantified} 处带数量。`, { severity: 'low', data: { quantified } });
  },

  liability_cap(ctx) {
    const liability = /责任|責任|赔偿|賠償|补偿|補償|liabilit|indemnif|damages/i;
    if (!has(ctx.text, liability)) {
      return result(ctx.type === 'contract' ? 'fail' : 'skip',
        ctx.type === 'contract' ? '合同里完全没有责任条款。出事的时候没有任何界线。' : '文件没有提到责任赔偿。', {
        severity: ctx.type === 'contract' ? 'high' : 'low',
        ask: '加入赔偿责任上限条款，并排除间接损失与利润损失。',
      });
    }
    const unlimited = /无限责任|無限責任|不受限制|全部损失|全部損失|一切损失|一切損失|一切后果|一切後果|unlimited\s+liabilit|without\s+limitation.{0,40}liabilit|all\s+(?:losses|damages|costs)\s+whatsoever/i;
    if (has(ctx.text, unlimited)) {
      return result('fail', '出现了无上限的责任措辞。等于把公司押上去。', {
        severity: 'high', evidence: quoteAround(ctx.flow ?? ctx.text, unlimited),
        ask: '把责任上限设为合同总额（或其倍数），并排除间接与利润损失。这一条请律师看。',
      });
    }
    const capped = /责任上限|責任上限|赔偿上限|賠償上限|以.{0,20}为限|不超过|不超過|最高不?超过|limited\s+to|shall\s+not\s+exceed|capped?\s+at|aggregate\s+liabilit/i;
    const indirect = /间接损失|間接損失|利润损失|利潤損失|预期利益|預期利益|indirect|consequential|loss\s+of\s+profit/i;
    if (!has(ctx.text, capped)) {
      return result('fail', '有责任条款，但没有金额上限。', {
        severity: 'high', evidence: quoteAround(ctx.flow ?? ctx.text, liability),
        ask: '加一句上限：例如责任总额不超过本合同总价。',
      });
    }
    if (!has(ctx.text, indirect)) {
      return result('flag', '有责任上限，但没有排除间接损失与利润损失（这是标准做法）。', {
        severity: 'medium', evidence: quoteAround(ctx.flow ?? ctx.text, capped),
        ask: '补上排除间接损失、附带损失与利润损失的条款。',
      });
    }
    return result('pass', '责任有金额上限，并排除了间接损失。', { severity: 'low', evidence: quoteAround(ctx.flow ?? ctx.text, capped) });
  },

  termination(ctx) {
    const term = /终止|終止|解除|解约|解約|撤销|撤銷|退出|terminat|cancel(?:lation)?|rescind|withdraw/i;
    if (!has(ctx.text, term)) {
      return result(ctx.type === 'contract' ? 'fail' : 'skip',
        ctx.type === 'contract' ? '没有终止条款。进去之前先看清门在哪里。' : '文件没有提到如何结束。', {
        severity: ctx.type === 'contract' ? 'high' : 'low',
        ask: '写明双方如何终止、提前多久通知、终止后如何收尾。',
      });
    }
    const notice = /通知|告知|書面|书面|notice|notify|written\s+notice/i;
    const mutual = /任何一方|双方|雙方|各方|either\s+party|both\s+parties|each\s+party/i;
    const wind = /归还|歸還|交还|交還|删除|刪除|结算|結算|退还|退還|移交|hand\s*over|return|delete|wind[\s-]?down|final\s+settlement/i;
    const missing = [!notice && '通知期', !mutual && '双方均可终止', !wind && '终止后的收尾安排'].filter(Boolean);
    if (missing.length) {
      return result(missing.includes('双方均可终止') ? 'fail' : 'flag',
        `有终止条款，但缺：${missing.join('、')}。`, {
        severity: missing.includes('双方均可终止') ? 'high' : 'medium',
        evidence: quoteAround(ctx.flow ?? ctx.text, term),
        ask: `补上${missing.join('和')}。`,
      });
    }
    return result('pass', '双方可终止、有通知期、有收尾安排。', { severity: 'low', evidence: quoteAround(ctx.flow ?? ctx.text, term) });
  },

  parties_named(ctx) {
    const entity = /\b(?:Sdn\.?\s*Bhd\.?|Berhad|Bhd\.?|Pte\.?\s*Ltd\.?|Private\s+Limited|Ltd\.?|LLC|LLP|Inc\.?|PLT|Enterprise|Trading)\b|有限公司|股份有限公司|企业|企業|商号|商號/i;
    // Walk back from the legal suffix over capitalised words only, so a
    // sentence like "made on 1 March between Acme Sdn Bhd" yields "Acme Sdn Bhd".
    const ENTITY_NAME = /(?:[A-Z][A-Za-z0-9&.'-]*\s+){1,5}(?:Sdn\.?\s*Bhd\.?|Berhad|Bhd\.?|Pte\.?\s*Ltd\.?|Ltd\.?|LLC|LLP|Inc\.?|PLT)/g;
    const matches = [...new Set((ctx.text.match(ENTITY_NAME) || []).map(s => s.trim()))];
    if (!has(ctx.text, entity)) {
      return result(ctx.type === 'contract' ? 'fail' : 'flag',
        ctx.type === 'contract'
          ? '找不到完整的法人名称（只有简称或品牌名）。签错主体整份合同作废。'
          : '没有写出双方的完整注册名称。提案最后会变成合同，主体现在就该对。', {
        severity: ctx.type === 'contract' ? 'high' : 'medium',
        ask: '写出双方完整注册名称、商业登记号、注册地址。',
      });
    }
    const regNo = /\(?\s*\d{6,}\s*[-–]\s*[A-Z0-9]{1,3}\s*\)?|(?:Registration|Company|Reg\.?|ROC|SSM)\s*(?:No\.?|Number)?\s*[:：]?\s*[\dA-Z-]{6,}|注册号|註冊號|统一社会信用代码/i;
    const address = /地址|註冊地址|注册地址|address|No\.?\s*\d+[,\s].{0,40}(?:Jalan|Road|Street|Lane|Taman|Bandar)|\b\d{5}\b/i;
    const signatory = /董事|总经理|總經理|授权代表|授權代表|签署人|簽署人|director|authori[sz]ed\s+(?:representative|signator)|managing\s+director|on\s+behalf\s+of/i;
    const missing = [!has(ctx.text, regNo) && '商业登记号', !has(ctx.text, address) && '注册地址', ctx.type === 'contract' && !has(ctx.text, signatory) && '签署人职位'].filter(Boolean);
    if (missing.length) {
      return result('flag', `找到法人名称（${matches.slice(0, 2).join('、') || '见原文'}），但缺：${missing.join('、')}。`, {
        severity: 'medium', evidence: quoteAround(ctx.flow ?? ctx.text, entity),
        ask: `补上${missing.join('和')}。`, data: { entities: matches.slice(0, 6) },
      });
    }
    return result('pass', `双方主体齐全：${matches.slice(0, 2).join('、') || '见原文'}，含登记号、地址与签署人。`, {
      severity: 'low', data: { entities: matches.slice(0, 6) },
    });
  },

  confidentiality(ctx) {
    // Case-sensitive on purpose, so the acronym NDA never matches inside
    // "Foundation" or "Kandar"; the English words spell out their own cases.
    const conf = /保密|機密|机密|不得泄露|不得洩露|非公开|非公開|[Cc]onfidential|CONFIDENTIAL|[Nn]on[\s-]?[Dd]isclosure|NON[\s-]?DISCLOSURE|[Pp]roprietary\s+[Ii]nformation|\bNDA\b/;
    const personal = /个人资料|個人資料|个人信息|個人信息|隐私|privacy|personal\s+data|PDPA|GDPR|data\s+protection/i;
    const touchesData = personal.test(ctx.text) || /客户名单|客戶名單|数据库|資料庫|数据|資料|customer\s+(?:list|data)|database|records/i.test(ctx.text);
    if (!has(ctx.text, conf)) {
      return result(touchesData ? 'fail' : 'skip',
        touchesData ? '会接触到资料，但完全没有保密条款。' : '文件没有保密条款，也看不出会接触机密。', {
        severity: touchesData ? 'high' : 'low',
        ask: '加入双向保密条款，写明保密范围、期限，以及个人资料如何存放与删除。',
      });
    }
    const mutual = /双方|雙方|各方|互相|mutual|both\s+parties|each\s+party/i;
    const period = /保密期|有效期|持续|持續|\d+\s*(?:年|years?|months?|个月)|perpetu|survive|终止后|終止後|after\s+termination/i;
    const missing = [!has(ctx.text, mutual) && '双向保密', !has(ctx.text, period) && '保密期限', (touchesData && !has(ctx.text, personal)) && '个人资料处理安排'].filter(Boolean);
    if (missing.length) {
      return result('flag', `有保密条款，但缺：${missing.join('、')}。`, {
        severity: 'medium', evidence: quoteAround(ctx.flow ?? ctx.text, conf), ask: `补上${missing.join('和')}。`,
      });
    }
    return result('pass', '双向保密、期限明确、涵盖个人资料处理。', { severity: 'low', evidence: quoteAround(ctx.flow ?? ctx.text, conf) });
  },

  governing_law(ctx) {
    const law = /适用法律|適用法律|管辖|管轄|司法管辖|司法管轄|依照.{0,12}法律|governing\s+law|jurisdiction|governed\s+by\s+the\s+laws?|courts?\s+of/i;
    const arb = /仲裁|arbitrat|AIAC|SIAC|ICC\s+Rules|调解|調解|mediation/i;
    if (!has(ctx.text, law) && !has(ctx.text, arb)) {
      return result(ctx.type === 'contract' ? 'fail' : 'skip',
        ctx.type === 'contract' ? '没写适用法律，也没写在哪里解决争议。出事的时候照谁的规矩算，无从判断。' : '文件没有法律适用条款。', {
        severity: ctx.type === 'contract' ? 'high' : 'low',
        ask: '写明适用哪一地的法律，以及管辖法院或仲裁机构与地点。',
      });
    }
    const places = [...new Set((ctx.text.match(/Malaysia|马来西亚|馬來西亞|Singapore|新加坡|Hong\s*Kong|香港|China|中国|中國|England|英国|英國|New\s*York|Delaware|UAE|Dubai|Indonesia|印尼|Thailand|泰国/gi) || []).map(s => s.trim()))];
    if (!has(ctx.text, law)) {
      return result('flag', '有仲裁或调解安排，但没写适用哪一地的法律。', {
        severity: 'medium', evidence: quoteAround(ctx.flow ?? ctx.text, arb), ask: '补上适用法律条款。', data: { places },
      });
    }
    if (places.length > 1) {
      return result('flag', `提到多个法域（${places.slice(0, 4).join('、')}）。请确认适用法律与管辖地是同一个。`, {
        severity: 'medium', evidence: quoteAround(ctx.flow ?? ctx.text, law), ask: '核对适用法律与争议地点是否一致。', data: { places },
      });
    }
    return result('pass', `适用法律与管辖安排明确${places[0] ? `（${places[0]}）` : ''}。`, {
      severity: 'low', evidence: quoteAround(ctx.flow ?? ctx.text, law), data: { places },
    });
  },

  auto_renewal(ctx) {
    const auto = /自动续约|自動續約|自动延期|自動延期|自动展期|自動展期|automatic(?:ally)?\s+(?:renew|extend)|auto[\s-]?renew|shall\s+be\s+renewed\s+automatically|续约一年|續約一年|逐年续约|逐年續約/i;
    const renew = /续约|續約|续期|續期|延长|延長|展期|renew|extend(?:ed|sion)?\s+(?:term|period)/i;
    if (!has(ctx.text, renew)) {
      return result(ctx.type === 'contract' ? 'flag' : 'skip',
        ctx.type === 'contract' ? '没有续约条款。到期之后的安排不明。' : '文件没有提到续约。', {
        severity: 'low', ask: '写明到期后是结束、需另行签约，还是自动续约。',
      });
    }
    if (!has(ctx.text, auto)) {
      return result('pass', '有续约条款，但不是自动续约（需双方另行同意）。', {
        severity: 'low', evidence: quoteAround(ctx.flow ?? ctx.text, renew),
      });
    }

    // Auto-renewal found. The thing that matters is the notice window.
    const noticeWindow = /(?:提前|至少|不?少于|不?少於|到期前|期满前|期滿前|届满前|屆滿前|终止前|終止前|no\s+later\s+than|at\s+least|not\s+less\s+than|prior\s+to\s+expiry)\s*(\d+)\s*(天|日|个月|個月|周|週|days?|months?|weeks?)|(\d+)\s*(天|日|个月|個月|周|週|days?|months?|weeks?)\s*(?:前|之前|以前|prior|before|in\s+advance)/i;
    const m = ctx.text.match(noticeWindow);
    const priceClause = /价格|價格|费用|費用|调整|調整|上调|上調|涨|漲|price|fee|rate|increase|adjust|CPI/i;
    const noticeText = m ? `${m[1] || m[3]} ${m[2] || m[4]}` : null;

    if (!noticeText) {
      return result('fail', '自动续约，但找不到不续约的通知期。等于默认一直续下去。', {
        severity: 'high', evidence: quoteAround(ctx.flow ?? ctx.text, auto),
        ask: '查清不续约要提前多久通知，并把这个日期记进日历。',
      });
    }
    const asDays = (() => {
      const n = Number(m[1] || m[3]);
      const u = (m[2] || m[4] || '').toLowerCase();
      if (/month|个月|個月/.test(u)) return n * 30;
      if (/week|周|週/.test(u)) return n * 7;
      return n;
    })();
    const tight = asDays < 30;
    const priceRisk = !has(ctx.text, priceClause);
    if (tight || priceRisk) {
      return result('fail', `自动续约，通知期 ${noticeText}${tight ? '（偏短）' : ''}${priceRisk ? '，而且续约后价格没有封顶' : ''}。`, {
        severity: 'high', evidence: quoteAround(ctx.flow ?? ctx.text, auto),
        ask: `在到期前 ${noticeText} 之前决定是否续约${priceRisk ? '；要求续约期价格上限写进合同' : ''}。`,
        data: { noticeText, noticeDays: asDays },
      });
    }
    return result('flag', `自动续约，通知期 ${noticeText}，价格有约束。记得把通知截止日记进日历。`, {
      severity: 'medium', evidence: quoteAround(ctx.flow ?? ctx.text, auto),
      ask: `把「到期前 ${noticeText}」这一天设成提醒。`,
      data: { noticeText, noticeDays: asDays },
    });
  },

  data_freshness(ctx) {
    const thisYear = new Date().getFullYear();
    const DATA_SENT = /数据|數據|统计|統計|调查|調查|研究|报告|報告|市场|市場|份额|份額|规模|規模|增长率|增長率|调研|調研|survey|statistic|market\s+size|report|study|research|forecast|data/i;
    // "Dashboard 2018-03-16" is a label, not a statistic: keep only sentences
    // that still hold a number once their dates and years are taken out.
    const sents = ctx.sentences.filter(s => {
      if (!DATA_SENT.test(s)) return false;
      const rest = s.replace(DATE, ' ').replace(/\b(?:19|20)\d{2}\b\s*年?/g, ' ');
      return STAT.test(rest);
    });
    if (!sents.length) {
      return result('skip', '文件里没有需要判断时效的数据。', { severity: 'low' });
    }
    const years = [];
    for (const s of sents) {
      for (const m of s.matchAll(/\b(19\d{2}|20\d{2})\b/g)) years.push({ year: Number(m[1]), sent: s });
    }
    const dated = new Set(years.map(y => y.sent));
    const undated = sents.filter(s => !dated.has(s));
    const stale = years.filter(y => y.year <= thisYear - 3).sort((a, b) => a.year - b.year);

    if (stale.length) {
      return result(stale.length > 1 ? 'fail' : 'flag',
        `有 ${stale.length} 处数据来自 ${stale[0].year} 年或更早（今年 ${thisYear}）。价格、法规、市场规模这三类过期最快。`, {
        severity: stale.length > 1 ? 'high' : 'medium',
        evidence: stale[0].sent.slice(0, 220),
        ask: '换成最近两年的数据，或说明为什么旧数据在今天仍然适用。',
        data: { thisYear, stale: stale.slice(0, 5).map(y => y.year), undated: undated.length },
      });
    }
    if (undated.length) {
      return result('flag', `${undated.length}/${sents.length} 句数据没有标年份，无法判断还成不成立。`, {
        severity: 'medium', evidence: undated[0].slice(0, 220),
        ask: '给每组数据标上年份或采集时间。',
        data: { thisYear, undated: undated.length },
      });
    }
    return result('pass', `${sents.length} 句数据都标了年份，且都在最近三年内。`, { severity: 'low', data: { thisYear } });
  },

  figures_sourced(ctx) {
    const sents = ctx.sentences;
    const withNumbers = sents.filter(s => {
    if (!/\d/.test(s)) return false;
    // A statistic, a price or a magnitude -- not a bare year or a date.
    const claim = /\d[\d,]*(?:\.\d+)?\s*%|(?:RM|MYR|USD|SGD|\$|¥|€|£)\s?[\d]|[\d][\d,]*\s*(?:令吉|元|美元)|\d+\s*(?:万|萬|億|亿|千|倍)|(?:增长|增長|下降|提升|降低|节省|節省|提高)\D{0,8}\d/i;
    if (!claim.test(s)) return false;
    // Drop a sentence whose only numbers are dates.
    const stripped = s.replace(DATE, '').replace(/(?:19|20)\d{2}\s*年?/g, '');
    return /\d/.test(stripped);
  });
    if (!withNumbers.length) {
      return result('skip', '文件里没有需要出处的数字。', { severity: 'low', data: { total: 0 } });
    }
    const unsourced = withNumbers.filter(s => !SOURCE_HINT.test(s));
    const vague = withNumbers.filter(s => /业界普遍|業界普遍|大家都知道|众所周知|眾所周知|研究显示|研究顯示|数据显示|數據顯示|有研究|普遍认为|普遍認為|studies\s+show|research\s+shows|it\s+is\s+well\s+known|industry\s+standard/i.test(s) && !SOURCE_HINT.test(s));
    const ratio = unsourced.length / withNumbers.length;

    if (ratio > 0.7 && withNumbers.length >= 3) {
      return result('fail', `${withNumbers.length} 句带数字的话里，${unsourced.length} 句没有出处。`, {
        severity: 'high', evidence: unsourced[0]?.slice(0, 220) || '',
        ask: '为每个关键数字补上出处：报告名、年份、内部系统，或客户提供。',
        data: { total: withNumbers.length, unsourced: unsourced.length, vague: vague.length, samples: unsourced.slice(0, 5) },
      });
    }
    if (vague.length || unsourced.length) {
      return result('flag', `${unsourced.length}/${withNumbers.length} 句带数字的话没有出处${vague.length ? `，其中 ${vague.length} 句用了「研究显示」这类没有具体来源的说法` : ''}。`, {
        severity: vague.length ? 'medium' : 'low',
        evidence: (vague[0] || unsourced[0] || '').slice(0, 220),
        ask: '把没有出处的数字标出来，补来源或删掉。',
        data: { total: withNumbers.length, unsourced: unsourced.length, vague: vague.length, samples: unsourced.slice(0, 5) },
      });
    }
    return result('pass', `${withNumbers.length} 句带数字的话都有出处。`, { severity: 'low', data: { total: withNumbers.length, unsourced: 0 } });
  },
};

export function runRule(ruleId, ctx) {
  const fn = RULES[ruleId];
  if (!fn) return result('skip', `没有名为 ${ruleId} 的规则`, { severity: 'low' });
  try {
    return fn(ctx);
  } catch (err) {
    return result('skip', `规则执行出错：${err.message}`, { severity: 'low' });
  }
}

export function makeContext({ text, type = 'other', name = '' }) {
  const flow = reflow(text || '');
  return { text: text || '', flow, type, name, sentences: sentences(flow) };
}

export const RULE_IDS = Object.keys(RULES);
