// The Workshop: you hand the town your material and the points you care about,
// and the guilds assemble a proposal draft — each section signed by the citizen
// whose craft it belongs to.
//
// The assembly is deterministic: your words, your material, and a structure the
// town knows how to hold. It is a draft to work from, not a piece of writing
// invented for you.

import { GUILDS } from './data.js';

const MAX_FILE_BYTES = 512 * 1024;
const MAX_TOTAL_BYTES = 2 * 1024 * 1024;
export const ACCEPTED = ['.txt', '.md', '.markdown', '.csv', '.tsv', '.json', '.log', '.rtf'];

// Lines that tend to matter in a brief, in either language.
const SIGNAL_WORDS = [
  'goal', 'objective', 'aim', 'target', 'budget', 'cost', 'price', 'deadline', 'timeline',
  'launch', 'deliver', 'must', 'need', 'require', 'kpi', 'metric', 'growth', 'revenue',
  'risk', 'scope', 'audience', 'user', 'problem', 'challenge', 'opportunity',
  '目标', '目的', '预算', '成本', '价格', '期限', '时间', '上线', '交付', '必须', '需求',
  '需要', '指标', '增长', '收入', '风险', '范围', '受众', '用户', '问题', '挑战', '机会',
];

function scoreLine(line) {
  const t = line.trim();
  if (t.length < 12 || t.length > 260) return 0;
  let score = 0;
  const lower = t.toLowerCase();
  for (const w of SIGNAL_WORDS) if (lower.includes(w)) { score += 3; break; }
  if (/\d/.test(t)) score += 2;
  if (/^[-*•·\d]+[.)\s]/.test(t)) score += 1;
  if (t.length > 40 && t.length < 180) score += 1;
  if (/[.。!！?？]$/.test(t)) score += 1;
  return score;
}

// Pull the lines worth quoting out of one uploaded file.
export function digestSource(name, text, take = 4) {
  const clean = String(text).replace(/\r/g, '');
  const lines = clean.split('\n').map((l) => l.replace(/^[-*•·]\s*/, '').trim()).filter(Boolean);
  const scored = lines
    .map((line, i) => ({ line, i, score: scoreLine(line) }))
    .filter((x) => x.score > 2)
    .sort((a, b) => b.score - a.score || a.i - b.i);
  const seen = new Set();
  const highlights = [];
  for (const { line } of scored) {
    const key = line.slice(0, 40).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    highlights.push(line.length > 200 ? `${line.slice(0, 197)}…` : line);
    if (highlights.length >= take) break;
  }
  return { name, chars: clean.length, lines: lines.length, highlights };
}

export function fileTooLarge(size) { return size > MAX_FILE_BYTES; }
export function totalTooLarge(bytes) { return bytes > MAX_TOTAL_BYTES; }
export function isAccepted(name) {
  const lower = String(name).toLowerCase();
  return ACCEPTED.some((ext) => lower.endsWith(ext));
}

/* ------------------------------------------------------------- authorship */

// Which guild's craft each section belongs to.
const SECTION_PLAN = [
  { key: 'overview',     guild: 'hearth' },
  { key: 'understand',   guild: 'lumen' },
  { key: 'approach',     guild: 'keystone' },
  { key: 'deliverables', guild: 'forge' },
  { key: 'timeline',     guild: 'wayfinder' },
  { key: 'investment',   guild: 'ledger' },
  { key: 'why',          guild: 'chorus' },
  { key: 'next',         guild: 'hearth' },
];

// The best-performing citizen of a guild who has not already signed a section.
function pickAuthor(town, guildId, used) {
  const pool = town.citizens
    .filter((c) => c.guild === guildId && c.stage === 'employed' && !used.has(c.id))
    .sort((a, b) => b.performance - a.performance);
  const fallback = town.citizens
    .filter((c) => c.stage === 'employed' && !used.has(c.id))
    .sort((a, b) => b.performance - a.performance);
  const pick = pool[0] || fallback[0] || null;
  if (pick) used.add(pick.id);
  return pick;
}

// Latin text dropped into a Chinese sentence reads better with breathing room.
const sp = (v) => (v && /^[A-Za-z0-9(]/.test(String(v).trim()) ? ` ${String(v).trim()} ` : String(v || '').trim());

const COPY = {
  en: {
    headings: {
      overview: 'Overview', understand: 'What we understand', approach: 'How we would work',
      deliverables: 'What you get', timeline: 'Timeline', investment: 'Investment',
      why: 'Why this team', next: 'Next steps',
    },
    prepared: (client) => (client ? `Prepared for ${client}` : 'Proposal draft'),
    overview: (b) => [
      b.client
        ? `${b.client} is looking to ${b.goal || b.title || 'move a piece of work forward'}.`
        : `This proposal covers ${b.goal || b.title || 'the work discussed'}.`,
      'This proposal sets out what we understand of the task, how we would approach it, what you would receive, and what it would take.',
    ].join(' '),
    understandLead: 'These are the points we are working to:',
    sourceLead: (names) => `Drawn from the material you shared (${names}):`,
    approachLead: 'We would work in three passes, each ending with something you can look at:',
    passes: [
      ['Understand', 'We go through your material and agree the shape of the problem before anything is built.'],
      ['Build', 'The work is made in the open, in pieces you can react to, so nothing arrives as a surprise at the end.'],
      ['Hand over', 'You get the finished work, the reasoning behind it, and what would come next.'],
    ],
    deliverLead: 'On the points you raised, you would receive:',
    deliverFallback: 'A finished piece of work, the reasoning behind it, and a short handover.',
    timelineLead: (t) => (t ? `Your timing: ${t}. On that basis:` : 'A working shape, to be fixed with you:'),
    phases: ['Understand and agree scope', 'First working version', 'Revision on your notes', 'Handover'],
    investment: (b) => (b.budget
      ? `Budget discussed: ${b.budget}. The figure below the line is what the work costs to do properly; anything above it is scope we can talk about.`
      : 'Costed once scope is agreed — we would rather price the work we actually agree than a guess.'),
    whyLead: (n, perf) => `This work would be carried by a team of ${n}, currently running at ${perf}% on their own measures.`,
    whyTeam: 'The sections above are signed by the people who would do them.',
    nextSteps: [
      'You tell us what is wrong with this draft.',
      'We agree scope and price.',
      'We start, and you see the first version early.',
    ],
    signature: (name, role) => `${name} · ${role}`,
    draftNote: 'Draft assembled from your brief and material.',
  },
  zh: {
    headings: {
      overview: '概述', understand: '我们理解的需求', approach: '我们的做法',
      deliverables: '交付内容', timeline: '时间安排', investment: '投入',
      why: '为什么是这个团队', next: '下一步',
    },
    prepared: (client) => (client ? `致 ${client}` : '提案草稿'),
    overview: (b) => [
      b.client
        ? `${b.client} 希望${sp(b.goal || b.title) || '把这件事推进下去'}。`
        : `本提案关于${sp(b.goal || b.title) || '我们讨论的这项工作'}。`,
      '以下说明我们对任务的理解、打算怎么做、你会拿到什么，以及需要多少投入。',
    ].join(''),
    understandLead: '我们围绕这几点展开：',
    sourceLead: (names) => `摘自你提供的资料（${names}）：`,
    approachLead: '我们分三轮推进，每一轮结束都有你可以直接看的东西：',
    passes: [
      ['读懂', '先把你的资料读完，把问题的形状和你确认清楚，再动手。'],
      ['做出来', '过程公开，分阶段给你看，不会到最后才拿出一个意外。'],
      ['交接', '交付成品、背后的判断依据，以及接下来该做什么。'],
    ],
    deliverLead: '针对你提出的重点，你会拿到：',
    deliverFallback: '一份完成的作品、背后的判断依据，以及一次简短的交接。',
    timelineLead: (t) => (t ? `你的时间要求：${sp(t)}。据此安排：` : '大致节奏，具体与你敲定：'),
    phases: ['读懂需求、确认范围', '第一版可用成果', '按你的意见修改', '交接'],
    investment: (b) => (b.budget
      ? `已谈到的预算：${sp(b.budget)}。这条线以下是把事情做好所需的成本；线以上属于可以商量的范围。`
      : '范围确定后再报价——我们宁可为真正谈定的工作定价，也不愿先给一个猜测。'),
    whyLead: (n, perf) => `这项工作由 ${n} 人的团队承担，目前他们自己的绩效为 ${perf}%。`,
    whyTeam: '上面每一节，都由真正会做那件事的人署名。',
    nextSteps: ['你告诉我们这份草稿哪里不对。', '确认范围与价格。', '开工，并且很早就让你看到第一版。'],
    signature: (name, role) => `${name} · ${role}`,
    draftNote: '本草稿由你的要点与资料组装而成。',
  },
};

/* -------------------------------------------------------------- assembly */

export function buildProposal(brief, sources, town, lang = 'en') {
  const t = COPY[lang] || COPY.en;
  const used = new Set();
  const points = (brief.points || []).map((p) => p.trim()).filter(Boolean);
  const highlights = sources.flatMap((s) => s.highlights.map((h) => ({ h, from: s.name })));
  const employed = town.citizens.filter((c) => c.stage === 'employed');
  const avgPerf = employed.length
    ? Math.round((employed.reduce((a, c) => a + c.performance, 0) / employed.length) * 100)
    : 0;

  const body = {};
  body.overview = [{ type: 'p', text: t.overview(brief) }];

  body.understand = [];
  if (points.length) {
    body.understand.push({ type: 'p', text: t.understandLead });
    body.understand.push({ type: 'list', items: points });
  }
  if (highlights.length) {
    const names = [...new Set(highlights.map((x) => x.from))].join(', ');
    body.understand.push({ type: 'p', text: t.sourceLead(names) });
    body.understand.push({ type: 'quotes', items: highlights.slice(0, 8).map((x) => x.h) });
  }
  if (!body.understand.length) body.understand.push({ type: 'p', text: t.understandLead });

  body.approach = [
    { type: 'p', text: t.approachLead },
    { type: 'steps', items: t.passes.map(([name, text], i) => ({ n: i + 1, name, text })) },
  ];

  body.deliverables = points.length
    ? [{ type: 'p', text: t.deliverLead }, { type: 'list', items: points }]
    : [{ type: 'p', text: t.deliverFallback }];

  body.timeline = [
    { type: 'p', text: t.timelineLead(brief.timeline) },
    { type: 'steps', items: t.phases.map((name, i) => ({ n: i + 1, name, text: '' })) },
  ];

  body.investment = [{ type: 'p', text: t.investment(brief) }];

  body.why = [
    { type: 'p', text: t.whyLead(employed.length || town.citizens.length, avgPerf) },
    { type: 'p', text: t.whyTeam },
  ];

  body.next = [{ type: 'steps', items: t.nextSteps.map((text, i) => ({ n: i + 1, name: text, text: '' })) }];

  const sections = SECTION_PLAN.map((plan) => {
    const author = pickAuthor(town, plan.guild, used);
    const guild = GUILDS.find((g) => g.id === plan.guild);
    return {
      key: plan.key,
      heading: t.headings[plan.key],
      blocks: body[plan.key],
      author: author ? { name: author.name, role: author.role, guild: guild.name, emoji: guild.emoji } : null,
    };
  });

  return {
    title: brief.title || (lang === 'zh' ? '提案草稿' : 'Proposal draft'),
    subtitle: t.prepared(brief.client),
    lang,
    note: t.draftNote,
    sections,
    sourceCount: sources.length,
  };
}

export function proposalToMarkdown(doc) {
  const out = [`# ${doc.title}`, '', `_${doc.subtitle}_`, ''];
  for (const s of doc.sections) {
    out.push(`## ${s.heading}`, '');
    for (const b of s.blocks) {
      if (b.type === 'p') out.push(b.text, '');
      if (b.type === 'list') { for (const i of b.items) out.push(`- ${i}`); out.push(''); }
      if (b.type === 'quotes') { for (const i of b.items) out.push(`> ${i}`, ''); }
      if (b.type === 'steps') {
        for (const i of b.items) out.push(i.text ? `${i.n}. **${i.name}** — ${i.text}` : `${i.n}. ${i.name}`);
        out.push('');
      }
    }
    if (s.author) out.push(`*— ${s.author.name}, ${s.author.role}, ${s.author.guild}*`, '');
  }
  out.push('---', '', `_${doc.note}_`);
  return out.join('\n');
}

export function slugify(text, fallback = 'proposal') {
  const base = String(text || '').toLowerCase().replace(/[^a-z0-9一-龥]+/g, '-').replace(/^-+|-+$/g, '');
  return (base || fallback).slice(0, 48);
}
