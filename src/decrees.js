// Decrees: orders the town can be given. Each one changes how the simulation runs
// for a number of days, and each one costs something from the stores.

import { RESOURCES } from './data.js';

// Focus decrees: the guilds throw themselves at one resource and ease off the rest.
const FOCUS_EMOJI = {
  energy: '⚡', food: '\u{1F33E}', materials: '\u{1F9F1}', data: '\u{1F4E1}',
  compute: '\u{1F9EE}', credits: '\u{1FA99}', knowledge: '\u{1F4DA}', care: '\u{1F49A}',
};

function focusDecree(resource) {
  const r = RESOURCES.find((x) => x.id === resource);
  return {
    key: `focus:${resource}`,
    slot: 'focus',                       // only one focus decree runs at a time
    name: `Focus on ${r.name}`,
    emoji: FOCUS_EMOJI[resource],
    blurb: `Every hall that makes ${r.name.toLowerCase()} works flat out; everything else eases off.`,
    days: 12,
    cost: { credits: 40 },
    effects: { mul: { [resource]: 1.45 }, mulDefault: 0.93 },
  };
}

export const DECREES = [
  ...['energy', 'food', 'materials', 'data', 'compute', 'credits', 'knowledge', 'care'].map(focusDecree),
  {
    key: 'expand_academy',
    slot: 'academy',
    name: 'Expand the Academy',
    emoji: '\u{1F393}',
    blurb: 'Extra faculty and longer terms: students reach their finals far sooner.',
    days: 14,
    cost: { knowledge: 60, credits: 40 },
    effects: { study: 1.8 },
  },
  {
    key: 'innovate',
    slot: 'research',
    name: 'Season of Research',
    emoji: '\u{1F52D}',
    blurb: 'The town turns to study — knowledge and data pour in, other work slows a little.',
    days: 12,
    cost: { compute: 60 },
    effects: { mul: { knowledge: 1.55, data: 1.4 }, mulDefault: 0.94 },
  },
  {
    key: 'festival',
    slot: 'mood',
    name: 'Hold a Festival',
    emoji: '\u{1F386}',
    blurb: 'Lanterns on every isle. Wellbeing climbs and the whole town works happier.',
    days: 8,
    cost: { food: 80, credits: 60 },
    effects: { mul: { care: 1.5 }, wellAdd: 0.12, perfAdd: 0.02 },
  },
  {
    key: 'rest',
    slot: 'mood',
    name: 'Call a Rest',
    emoji: '\u{1F319}',
    blurb: 'Shorter days for a while. Output dips now; wellbeing and results recover after.',
    days: 6,
    cost: {},
    effects: { mulDefault: 0.88, wellAdd: 0.18, perfAdd: -0.03 },
  },
  {
    key: 'mentor_all',
    slot: 'mentors',
    name: 'Pair Every Mentor',
    emoji: '\u{1F91D}',
    blurb: 'Every citizen without a mentor gets one today, and keeps them a fortnight.',
    days: 14,
    cost: { care: 50 },
    effects: { perfAdd: 0.04 },
    once: 'mentorAll',
  },
  {
    key: 'open_posts',
    slot: 'posts',
    name: 'Charter New Posts',
    emoji: '\u{1F4DC}',
    blurb: 'Three new posts where the town is shortest handed, then anyone badly matched is moved.',
    days: 1,
    instant: true,
    cost: { materials: 60, credits: 60 },
    effects: {},
    once: 'charterPosts',
  },
];

export const DECREE_BY_KEY = Object.fromEntries(DECREES.map((d) => [d.key, d]));

// Quick buttons on the console, in order.
export const QUICK_DECREES = ['focus:energy', 'focus:food', 'expand_academy', 'festival', 'mentor_all', 'innovate'];

// Written orders are matched by keyword, in English or Chinese.
const KEYWORDS = [
  [['energy', 'power', 'electric', '能量', '电', '能源', '发电'], 'focus:energy'],
  [['food', 'farm', 'harvest', 'grain', '粮', '食物', '农', '种'], 'focus:food'],
  [['material', 'build', 'forge', 'steel', '材料', '建材', '锻', '造'], 'focus:materials'],
  [['data', '数据', '资料'], 'focus:data'],
  [['compute', 'cluster', 'processing', '算力', '计算'], 'focus:compute'],
  [['credit', 'money', 'trade', 'market', 'wealth', '钱', '财', '贸易', '市场', '经济'], 'focus:credits'],
  [['academy', 'school', 'teach', 'student', 'learn', 'graduate', '书院', '学院', '学校', '教育', '教学', '学习', '毕业'], 'expand_academy'],
  [['research', 'science', 'study', 'discover', 'innovat', 'knowledge', '研究', '钻研', '科研', '创新', '知识', '学问'], 'innovate'],
  [['festival', 'celebrat', 'party', 'lantern', 'holiday', '庆典', '节日', '庆祝', '灯会', '过节'], 'festival'],
  [['rest', 'slow', 'break', 'recover', 'pause work', '休息', '休整', '放假', '慢'], 'rest'],
  [['mentor', 'teach each', 'pair', 'coach', 'support', '师徒', '导师', '带教', '结对', '帮扶'], 'mentor_all'],
  [['hire', 'recruit', 'post', 'job', 'expand the town', 'more work', '招', '岗位', '扩编', '增岗', '用人'], 'open_posts'],
  [['care', 'health', 'heal', 'clinic', 'wellbeing', '关怀', '医疗', '健康', '照顾', '养'], 'focus:care'],
];

// Returns a decree key, or null when nothing matches.
export function parseDecree(text) {
  const q = String(text || '').toLowerCase().trim();
  if (!q) return null;
  let best = null;
  for (const [words, key] of KEYWORDS) {
    for (const w of words) {
      if (q.includes(w) && (!best || w.length > best.len)) best = { key, len: w.length };
    }
  }
  return best ? best.key : null;
}

export function decreeCostText(d) {
  const parts = Object.entries(d.cost).map(([r, v]) => {
    const res = RESOURCES.find((x) => x.id === r);
    return `${v} ${res ? res.name.toLowerCase() : r}`;
  });
  return parts.length ? parts.join(' + ') : 'free';
}
