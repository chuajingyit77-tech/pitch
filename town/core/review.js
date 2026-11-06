// Run a review: the rule layer first (free), then the model layer, then
// assemble one report a person can act on.
//
// The prompt frame below is the single place to tune when you swap in a
// cheaper model. Everything that keeps a small model on task lives here:
// a narrow job, explicit steps, a fixed output shape, and a hard rule that
// quotes must be copied not paraphrased.

import { AGENTS, AGENT_BY_ID, GUILD_ROLES, agentsForDocType, DOC_TYPES } from './agents.data.js';
import { runRule, makeContext } from './rules.js';

export const MAX_DOC_CHARS = 24000;

const SEVERITY_RANK = { high: 0, medium: 1, low: 2 };
const VERDICT_RANK = { fail: 0, flag: 1, error: 2, skip: 3, pass: 4 };

export function systemPrompt(agent) {
  const role = GUILD_ROLES[agent.guild];
  return [
    `你是 ${agent.name}，${role.zh}公会的${agent.title}。`,
    `你只做一件事：${agent.duty}`,
    '',
    '规矩（违反任何一条，你的回答就没用）：',
    '1. 只输出 JSON，不要前言、不要解释、不要 markdown 代码块。',
    '2. 只根据给你的文件内容判断。文件里没写的，就是「没写」，不要用常识补全。',
    '3. evidence 必须是文件原文照抄，一个字都不能改。找不到原文就留空字符串。',
    '4. 不确定就给 flag，不要猜成 pass，也不要夸大成 fail。',
    '5. 不要改写文件，不要代写范例文案。',
    `6. 不做别人的事：${agent.out.join('；')}。`,
    '7. finding 和 ask 用中文，简短、具体、可执行。不要写「建议进一步完善」这类空话。',
  ].join('\n');
}

export function userPrompt(agent, doc) {
  const typeZh = DOC_TYPES.find(t => t.id === doc.type)?.zh || doc.type;
  const body = !doc.text?.trim()
    ? (doc.image
        ? '（这是一份图片档，内容就是随这段文字一起给你的那张图。请直接看图判断，不要说「文件里没有内容」。）'
        : '（这份文件读不出文字内容。）')
    : doc.text.length > MAX_DOC_CHARS
      ? doc.text.slice(0, MAX_DOC_CHARS) + `\n\n[文件过长，这里只给了前 ${MAX_DOC_CHARS} 字，共 ${doc.text.length} 字]`
      : doc.text;

  return [
    '### 文件',
    `名称：${doc.name}`,
    `类型：${typeZh}`,
    doc.project ? `项目：${doc.project}` : null,
    doc.author ? `提交人：${doc.author}` : null,
    doc.note ? `提交说明：${doc.note}` : null,
    '',
    '--- 文件内容开始 ---',
    body,
    '--- 文件内容结束 ---',
    '',
    '### 要查的事',
    agent.ask,
    '',
    '### 怎么查',
    ...agent.criteria.map((c, i) => `${i + 1}. ${c}`),
    '',
    '### 判定标准',
    `pass = ${agent.verdicts.pass}`,
    `flag = ${agent.verdicts.flag}`,
    `fail = ${agent.verdicts.fail}`,
    '',
    '### 只输出这个 JSON',
    '{"verdict":"pass|flag|fail","finding":"一两句话说你发现了什么","evidence":"原文照抄的那一句，没有就空字符串","severity":"low|medium|high","ask":"要对方改什么或补什么，一句话"}',
  ].filter(l => l !== null).join('\n');
}

function normalise(raw, agent) {
  const verdict = ['pass', 'flag', 'fail'].includes(raw?.verdict) ? raw.verdict : 'flag';
  const severity = ['low', 'medium', 'high'].includes(raw?.severity) ? raw.severity : (verdict === 'fail' ? 'high' : 'medium');
  return {
    agent: agent.id,
    name: agent.name,
    guild: agent.guild,
    title: agent.title,
    engine: 'llm',
    verdict,
    finding: String(raw?.finding ?? '').trim() || '（模型没有给出结论）',
    evidence: String(raw?.evidence ?? '').trim(),
    severity,
    ask: String(raw?.ask ?? '').trim(),
  };
}

// Keep a quote honest: a model that paraphrases instead of copying gets its
// evidence dropped rather than passed off as a quotation.
function verifyEvidence(entry, text) {
  if (!entry.evidence) return entry;
  const squash = s => s.replace(/\s+/g, '').replace(/[“”"'‘’]/g, '');
  if (squash(text).includes(squash(entry.evidence))) return entry;
  return { ...entry, evidence: '', evidenceNote: '模型给的引用在原文里找不到，已移除（可能是改写而非照抄）' };
}

async function pool(items, limit, worker) {
  const out = new Array(items.length);
  let next = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await worker(items[i], i);
    }
  });
  await Promise.all(runners);
  return out;
}

/**
 * Review one document.
 *
 * doc   { name, type, text, project?, author?, note?, visual?, readError? }
 * model a createModel() instance, or null to run the rule layer only
 * opts  { only, skip, concurrency, onProgress }
 */
export async function review(doc, model, opts = {}) {
  const { concurrency = 4, onProgress = null } = opts;
  const ctx = makeContext({ text: doc.text, type: doc.type, name: doc.name });

  let roster = agentsForDocType(doc.type);
  if (opts.only?.length) {
    const want = new Set(opts.only);
    roster = roster.filter(a => want.has(a.id) || want.has(a.guild));
  }
  if (opts.skip?.length) {
    const nope = new Set(opts.skip);
    roster = roster.filter(a => !nope.has(a.id) && !nope.has(a.guild));
  }

  const entries = [];
  const needModel = [];

  // Layer one: rules. Free, instant, identical every run.
  for (const agent of roster) {
    if (agent.engine === 'llm') { needModel.push(agent); continue; }
    const r = runRule(agent.ruleId, ctx);
    const entry = {
      agent: agent.id, name: agent.name, guild: agent.guild, title: agent.title,
      engine: agent.engine === 'hybrid' ? 'rule+llm' : 'rule',
      verdict: r.verdict, finding: r.finding, evidence: r.evidence,
      severity: r.severity, ask: r.ask, data: r.data, rule: agent.ruleId,
    };
    entries.push(entry);
    // A hybrid only pays for a model when the rule could not settle it.
    if (agent.engine === 'hybrid' && (r.verdict === 'skip' || r.verdict === 'flag')) needModel.push(agent);
    onProgress?.({ phase: 'rule', agent: agent.id, verdict: r.verdict });
  }

  // Layer two: the model. Skipped entirely when there is no model, or no text.
  const hasImage = !!doc.image?.base64;
  const canAskModel = !!model && ((doc.text?.trim().length > 40) || hasImage);
  if (!canAskModel) {
    for (const agent of needModel) {
      if (entries.some(e => e.agent === agent.id)) continue;
      entries.push({
        agent: agent.id, name: agent.name, guild: agent.guild, title: agent.title,
        engine: 'llm', verdict: 'skip',
        finding: model
          ? (doc.readError || (doc.visual
              ? '这是图片档，而且图没有送进模型（太大或格式不支持），这一项无法判断。'
              : '文件里没有可读的文字，这一项无法判断。'))
          : '没有接模型，这一项没有跑。',
        evidence: '', severity: 'low',
        ask: model ? '补一份可读的版本（PDF 文字版或 Word）。' : '设定 TOWN_PRESET 与 TOWN_API_KEY 后重跑。',
      });
    }
  } else {
    const results = await pool(needModel, concurrency, async agent => {
      const res = await model.ask({
        system: systemPrompt(agent),
        prompt: userPrompt(agent, doc),
        images: hasImage ? [doc.image] : null,
      });
      onProgress?.({ phase: 'model', agent: agent.id, ok: res.ok });
      if (!res.ok) {
        return {
          agent: agent.id, name: agent.name, guild: agent.guild, title: agent.title,
          engine: 'llm', verdict: 'error', finding: `模型没有回答：${res.error}`,
          evidence: '', severity: 'low', ask: '重跑这一项。',
        };
      }
      return verifyEvidence(normalise(res.json, agent), doc.text);
    });

    for (const r of results) {
      const existing = entries.findIndex(e => e.agent === r.agent);
      if (existing === -1) { entries.push(r); continue; }
      // Hybrid: keep the rule's hard evidence, take the model's judgement.
      const rule = entries[existing];
      entries[existing] = {
        ...rule,
        verdict: VERDICT_RANK[r.verdict] < VERDICT_RANK[rule.verdict] ? r.verdict : rule.verdict,
        finding: `${rule.finding}${rule.verdict === 'skip' ? '' : ' '}${r.finding}`.trim(),
        evidence: rule.evidence || r.evidence,
        severity: SEVERITY_RANK[r.severity] < SEVERITY_RANK[rule.severity] ? r.severity : rule.severity,
        ask: rule.ask || r.ask,
      };
    }
  }

  entries.sort((a, b) =>
    (VERDICT_RANK[a.verdict] - VERDICT_RANK[b.verdict]) ||
    (SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]) ||
    a.guild.localeCompare(b.guild));

  const tally = entries.reduce((acc, e) => { acc[e.verdict] = (acc[e.verdict] || 0) + 1; return acc; }, {});
  return {
    doc: { name: doc.name, type: doc.type, project: doc.project || null, author: doc.author || null, chars: doc.text?.length || 0 },
    model: model ? model.describe() : '未接模型（只跑规则层）',
    ranAt: new Date().toISOString(),
    agents: entries.length,
    tally,
    status: tally.fail ? 'needs-work' : (tally.flag ? 'review' : 'ok'),
    entries,
  };
}

const VERDICT_LABEL = { fail: '不过', flag: '留意', error: '出错', skip: '未跑', pass: '通过' };
const SEV_MARK = { high: '●●●', medium: '●●', low: '●' };

export function reportMarkdown(r) {
  const L = [];
  L.push(`# 评审报告：${r.doc.name}`);
  L.push('');
  L.push(`- 类型：${DOC_TYPES.find(t => t.id === r.doc.type)?.zh || r.doc.type}`);
  if (r.doc.project) L.push(`- 项目：${r.doc.project}`);
  if (r.doc.author) L.push(`- 提交人：${r.doc.author}`);
  L.push(`- 评审时间：${r.ranAt.replace('T', ' ').slice(0, 16)}`);
  L.push(`- 模型：${r.model}`);
  L.push(`- 参与检查：${r.agents} 项 · 不过 ${r.tally.fail || 0} · 留意 ${r.tally.flag || 0} · 通过 ${r.tally.pass || 0} · 未跑 ${(r.tally.skip || 0) + (r.tally.error || 0)}`);
  L.push('');

  const musts = r.entries.filter(e => e.verdict === 'fail');
  L.push('## 必须处理');
  if (!musts.length) L.push('没有。');
  for (const e of musts) {
    L.push(`### ${SEV_MARK[e.severity]} ${e.finding}`);
    L.push(`${e.name}（${GUILD_ROLES[e.guild].zh}·${e.title}）`);
    if (e.evidence) L.push(`> ${e.evidence.replace(/\n/g, ' ')}`);
    if (e.evidenceNote) L.push(`*${e.evidenceNote}*`);
    if (e.ask) L.push(`**要做的：** ${e.ask}`);
    L.push('');
  }

  const flags = r.entries.filter(e => e.verdict === 'flag');
  L.push('## 值得留意');
  if (!flags.length) L.push('没有。');
  for (const e of flags) {
    L.push(`- **${e.finding}** — ${e.name}${e.ask ? `｜${e.ask}` : ''}`);
    if (e.evidence) L.push(`  > ${e.evidence.replace(/\n/g, ' ').slice(0, 200)}`);
  }
  L.push('');

  L.push('## 全部结果');
  L.push('');
  L.push('| 结果 | 检查 | 负责 | 发现 |');
  L.push('| --- | --- | --- | --- |');
  for (const e of r.entries) {
    const cell = s => String(s || '').replace(/\|/g, '/').replace(/\n/g, ' ');
    L.push(`| ${VERDICT_LABEL[e.verdict]} | ${cell(e.title)} | ${e.name} | ${cell(e.finding).slice(0, 110)} |`);
  }
  L.push('');

  const skipped = r.entries.filter(e => e.verdict === 'skip' || e.verdict === 'error');
  if (skipped.length) {
    L.push('## 没跑成的');
    L.push('');
    for (const e of skipped) L.push(`- ${e.name}（${e.title}）：${e.finding}`);
    L.push('');
  }
  L.push('---');
  L.push('*这份报告由镇上的检查员自动生成。规则层的结论是确定的；模型层的结论需要人判断，不要当成定论。*');
  return L.join('\n');
}

export { AGENTS, AGENT_BY_ID, GUILD_ROLES, DOC_TYPES };
