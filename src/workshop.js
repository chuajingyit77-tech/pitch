// Reading what you hand the town: which files are accepted, and which lines in
// them actually carry meaning. The assembly itself lives in deliverables.js.

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

export function docToMarkdown(doc) {
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
