// What the town can make for you. Every deliverable is assembled from your brief
// and your material, section by section, and signed by the citizen whose craft
// that section belongs to.

import { GUILDS } from './data.js';

/* ------------------------------------------------------------- authorship */

// The best-performing citizen of a guild who has not already signed a section.
export function pickAuthor(town, guildId, used) {
  const ofGuild = town.citizens
    .filter((c) => c.guild === guildId && c.stage === 'employed' && !used.has(c.id))
    .sort((a, b) => b.performance - a.performance);
  const anyone = town.citizens
    .filter((c) => c.stage === 'employed' && !used.has(c.id))
    .sort((a, b) => b.performance - a.performance);
  const stillStudying = town.citizens.filter((c) => !used.has(c.id));
  const pick = ofGuild[0] || anyone[0] || stillStudying[0] || null;
  if (pick) used.add(pick.id);
  return pick;
}

function sign(town, guildId, used) {
  const c = pickAuthor(town, guildId, used);
  if (!c) return null;
  const guild = GUILDS.find((g) => g.id === c.guild) || GUILDS[0];
  return { id: c.id, name: c.name, role: c.role || (c.stage === 'student' ? 'Student' : 'Citizen'), guild: guild.name, emoji: guild.emoji };
}

/* ----------------------------------------------------------------- lenses */

// Each guild reads a problem through its own craft. These are the eleven angles
// the town can put on anything you bring it.
export const LENSES = [
  {
    guild: 'aether', en: 'The engine', zh: '发动机',
    askEn: (t) => `What is the engine behind ${t}? It will not happen through a run of separate decisions — what is the one thing that, once built, makes the seventh easier than the second?`,
    moveEn: 'Build the repeatable part first, even if it is ugly. Then measure how long the second one takes against the seventh.',
    askZh: (t) => `${t}背后的发动机是什么？靠一次次单独决定是做不成的——有没有一件事，一旦建好，第七次就比第二次轻松？`,
    moveZh: '先把可重复的那部分做出来，哪怕粗糙。然后量一量第二次和第七次分别花多久。',
  },
  {
    guild: 'verdant', en: 'What grows by itself', zh: '自己会长的部分',
    askEn: (t) => `Which part of ${t} could seed the next part without you pushing it?`,
    moveEn: 'Find the piece that compounds — a customer who brings a customer, a template that writes the next template — and put your effort there instead of spreading it evenly.',
    askZh: (t) => `${t}里面，哪一部分能自己带出下一部分，不用你推？`,
    moveZh: '找到会复利的那一块——一个客户带来下一个客户，一个模板生出下一个模板——把力气压在那里，而不是平均分配。',
  },
  {
    guild: 'forge', en: 'The smallest real thing', zh: '最小的真东西',
    askEn: (t) => `What is the smallest version of ${t} you could actually build this week?`,
    moveEn: 'Cut it down until it fits a week. If it cannot fit a week, you do not understand it well enough yet.',
    askZh: (t) => `${t}最小的一个版本是什么——小到这个星期就能做出来？`,
    moveZh: '一直砍到能塞进一个星期。如果塞不进，说明你还没把它想清楚。',
  },
  {
    guild: 'lattice', en: 'The early signal', zh: '最早的信号',
    askEn: (t) => `What signal would tell you ${t} is working, before the money does?`,
    moveEn: 'Name one number you could read every Monday morning. If you cannot name it, you are flying on feeling.',
    askZh: (t) => `在钱有反应之前，什么信号能告诉你${t}走对了？`,
    moveZh: '说出一个你每周一早上都能看一眼的数字。说不出来，就说明你在凭感觉飞。',
  },
  {
    guild: 'mender', en: 'What breaks first', zh: '最先坏掉的地方',
    askEn: (t) => `When ${t} works, what breaks first — the people, the supply, or the promise you made?`,
    moveEn: 'Write down the failure that would embarrass you most, then spend one hour making it less likely.',
    askZh: (t) => `等${t}真的成了，最先坏掉的会是什么——人、供给，还是你许下的承诺？`,
    moveZh: '写下那个会让你最难堪的失败，然后花一小时让它不那么容易发生。',
  },
  {
    guild: 'ledger', en: 'Where the value sits', zh: '价值到底在哪',
    askEn: (t) => `Who pays for ${t}, and what are they actually buying — the thing, or what the thing spares them?`,
    moveEn: 'Say the price out loud to one real person. Their flinch tells you more than a spreadsheet will.',
    askZh: (t) => `谁为${t}付钱？他们买的到底是这个东西，还是这个东西替他们省掉的麻烦？`,
    moveZh: '找一个真人，把价格说出口。对方的反应比一张表格有用得多。',
  },
  {
    guild: 'wayfinder', en: 'The route', zh: '路线',
    askEn: (t) => `What is the path from where you are today to ${t} — and which leg of it is longest?`,
    moveEn: 'Draw the route as one line with the stops marked. The longest leg is the real project; the rest is admin.',
    askZh: (t) => `从今天的位置到${t}，路是怎么走的？哪一段最长？`,
    moveZh: '把路线画成一条线，标出停靠点。最长的那一段才是真正的项目，其余都是杂务。',
  },
  {
    guild: 'keystone', en: 'The rule that decides', zh: '能自己拍板的规则',
    askEn: (t) => `What rule would let ${t} decide itself, without you in the room?`,
    moveEn: 'Write one sentence anyone on the team could apply to say yes or no. If it needs you to interpret it, it is not a rule yet.',
    askZh: (t) => `有没有一条规则，能让${t}在你不在场的时候自己拍板？`,
    moveZh: '写一句话，团队里任何人拿着都能判断该不该做。如果还需要你来解释，那就还不是规则。',
  },
  {
    guild: 'lumen', en: 'How you would be wrong', zh: '你可能错在哪',
    askEn: (t) => `What would have to be true for ${t} to be a bad idea?`,
    moveEn: 'Go looking for that evidence for thirty minutes. It is much cheaper to find now than after you have committed.',
    askZh: (t) => `要满足什么条件，${t}才会是个坏主意？`,
    moveZh: '花三十分钟去找这个证据。现在找到，比投入之后才发现便宜得多。',
  },
  {
    guild: 'chorus', en: 'The story told back', zh: '别人怎么转述',
    askEn: (t) => `What does someone say about ${t} when they describe it to a friend, in their own words?`,
    moveEn: 'Write that one sentence the way they would say it, not the way you would. If it is boring, the idea is not finished.',
    askZh: (t) => `别人跟朋友描述${t}的时候，会怎么说？用他们的话，不是你的话。`,
    moveZh: '把那一句写下来，用对方的口吻。如果读起来很无聊，说明这个想法还没做完。',
  },
  {
    guild: 'hearth', en: 'Who has to learn what', zh: '谁得学会什么',
    askEn: (t) => `Who has to be able to do something new for ${t} to work?`,
    moveEn: 'Name the person and name the skill. Teaching someone you already trust is usually cheaper and faster than hiring.',
    askZh: (t) => `要让${t}成立，谁必须学会一件他现在还不会的事？`,
    moveZh: '把人和那项技能都写出来。教会一个你已经信任的人，通常比招人更快也更便宜。',
  },
];

/* ------------------------------------------------------------------ copy */

const T = {
  en: {
    preparedFor: (c) => (c ? `Prepared for ${c}` : 'Assembled by the town'),
    subject: 'the work',
    note: 'Assembled from your brief and your material. Your words, ordered by the town.',
    from: (names) => `Drawn from what you shared (${names}):`,
    yourPoints: 'The points you gave the town:',
  },
  zh: {
    preparedFor: (c) => (c ? `致 ${c}` : '由小镇整理'),
    subject: '这件事',
    note: '由你的要点与资料组装而成。用的是你的话，小镇只负责排好它们。',
    from: (names) => `摘自你提供的资料（${names}）：`,
    yourPoints: '你交给小镇的重点：',
  },
};

const isLatin = (v) => /^[A-Za-z0-9(]/.test(String(v || '').trim());
const pad = (v, lang) => (lang === 'zh' && isLatin(v) ? ` ${String(v).trim()} ` : String(v || '').trim());

function topicOf(brief, lang) {
  const raw = brief.goal || brief.title || '';
  return raw ? pad(raw, lang) : T[lang].subject;
}

function quotesBlock(sources, lang, limit = 6) {
  const all = sources.flatMap((s) => s.highlights.map((h) => ({ h, from: s.name })));
  if (!all.length) return [];
  const names = [...new Set(all.map((x) => x.from))].join(', ');
  return [
    { type: 'p', text: T[lang].from(names) },
    { type: 'quotes', items: all.slice(0, limit).map((x) => x.h) },
  ];
}

const pointsBlock = (points, lang) =>
  (points.length ? [{ type: 'p', text: T[lang].yourPoints }, { type: 'list', items: points }] : []);

/* ------------------------------------------------------------- builders */

function buildIdeas(brief, sources, town, lang) {
  const topic = topicOf(brief, lang);
  const used = new Set();
  const sections = LENSES.map((lens) => {
    const guild = GUILDS.find((g) => g.id === lens.guild);
    return {
      key: `lens-${lens.guild}`,
      heading: `${guild.name.replace(' Guild', '')} — ${lang === 'zh' ? lens.zh : lens.en}`,
      blocks: [
        { type: 'p', text: lang === 'zh' ? lens.askZh(topic) : lens.askEn(topic) },
        { type: 'p', text: lang === 'zh' ? lens.moveZh : lens.moveEn },
      ],
      author: sign(town, lens.guild, used),
    };
  });
  if (sources.length) {
    sections.push({
      key: 'material',
      heading: lang === 'zh' ? '你的资料里值得再看一眼的' : 'Worth another look in your material',
      blocks: quotesBlock(sources, lang, 8),
      author: sign(town, 'lumen', used),
    });
  }
  return {
    title: brief.title || (lang === 'zh' ? '十一个角度' : 'Eleven angles'),
    subtitle: lang === 'zh'
      ? `每个公会用自己的手艺读同一件事${brief.goal ? '：' + brief.goal : ''}`
      : `Each guild reads the same problem through its own craft${brief.goal ? ': ' + brief.goal : ''}`,
    sections,
  };
}

function buildProposalDoc(brief, sources, town, lang) {
  const used = new Set();
  const points = brief.points;
  const topic = topicOf(brief, lang);
  const en = lang !== 'zh';
  const S = (key, heading, blocks, guild) => ({ key, heading, blocks, author: sign(town, guild, used) });

  const passes = en
    ? [['Understand', 'We go through your material and agree the shape of the problem before anything is built.'],
       ['Build', 'The work is made in the open, in pieces you can react to, so nothing arrives as a surprise.'],
       ['Hand over', 'You get the finished work, the reasoning behind it, and what would come next.']]
    : [['读懂', '先把你的资料读完，把问题的形状和你确认清楚，再动手。'],
       ['做出来', '过程公开，分阶段给你看，不会到最后才拿出一个意外。'],
       ['交接', '交付成品、背后的判断依据，以及接下来该做什么。']];
  const phases = en
    ? ['Understand and agree scope', 'First working version', 'Revision on your notes', 'Handover']
    : ['读懂需求、确认范围', '第一版可用成果', '按你的意见修改', '交接'];

  return {
    title: brief.title || (en ? 'Proposal draft' : '提案草稿'),
    subtitle: T[lang].preparedFor(brief.client),
    sections: [
      S('overview', en ? 'Overview' : '概述', [{
        type: 'p',
        text: en
          ? `${brief.client ? `${brief.client} is looking to ${topic}.` : `This proposal covers ${topic}.`} It sets out what we understand of the task, how we would approach it, what you would receive, and what it would take.`
          : `${brief.client ? `${brief.client} 希望${topic}。` : `本提案关于${topic}。`}以下说明我们对任务的理解、打算怎么做、你会拿到什么，以及需要多少投入。`,
      }], 'hearth'),
      S('understand', en ? 'What we understand' : '我们理解的需求',
        [...pointsBlock(points, lang), ...quotesBlock(sources, lang, 8)].length
          ? [...pointsBlock(points, lang), ...quotesBlock(sources, lang, 8)]
          : [{ type: 'p', text: en ? 'To be filled in with you.' : '待与你一起补齐。' }], 'lumen'),
      S('approach', en ? 'How we would work' : '我们的做法', [
        { type: 'p', text: en ? 'Three passes, each ending with something you can look at:' : '分三轮推进，每一轮结束都有你可以直接看的东西：' },
        { type: 'steps', items: passes.map(([name, text], i) => ({ n: i + 1, name, text })) },
      ], 'keystone'),
      S('deliverables', en ? 'What you get' : '交付内容',
        points.length
          ? [{ type: 'p', text: en ? 'On the points you raised, you would receive:' : '针对你提出的重点，你会拿到：' }, { type: 'list', items: points }]
          : [{ type: 'p', text: en ? 'A finished piece of work, the reasoning behind it, and a short handover.' : '一份完成的作品、背后的判断依据，以及一次简短的交接。' }], 'forge'),
      S('timeline', en ? 'Timeline' : '时间安排', [
        { type: 'p', text: brief.timeline
          ? (en ? `Your timing: ${brief.timeline}. On that basis:` : `你的时间要求：${pad(brief.timeline, lang)}。据此安排：`)
          : (en ? 'A working shape, to be fixed with you:' : '大致节奏，具体与你敲定：') },
        { type: 'steps', items: phases.map((name, i) => ({ n: i + 1, name, text: '' })) },
      ], 'wayfinder'),
      S('investment', en ? 'Investment' : '投入', [{
        type: 'p',
        text: brief.budget
          ? (en ? `Budget discussed: ${brief.budget}. Below that line is what the work costs to do properly; above it is scope we can talk about.`
                : `已谈到的预算：${pad(brief.budget, lang)}。这条线以下是把事情做好所需的成本；线以上属于可以商量的范围。`)
          : (en ? 'Costed once scope is agreed — we would rather price the work we actually agree than a guess.'
                : '范围确定后再报价——我们宁可为真正谈定的工作定价，也不愿先给一个猜测。'),
      }], 'ledger'),
      S('why', en ? 'Why this team' : '为什么是这个团队', [
        { type: 'p', text: teamLine(town, lang) },
        { type: 'p', text: en ? 'Every section above is signed by the person who would do that part.' : '上面每一节，都由真正会做那件事的人署名。' },
      ], 'chorus'),
      S('next', en ? 'Next steps' : '下一步', [{
        type: 'steps',
        items: (en
          ? ['You tell us what is wrong with this draft.', 'We agree scope and price.', 'We start, and you see the first version early.']
          : ['你告诉我们这份草稿哪里不对。', '确认范围与价格。', '开工，并且很早就让你看到第一版。']
        ).map((name, i) => ({ n: i + 1, name, text: '' })),
      }], 'hearth'),
    ],
  };
}

function teamLine(town, lang) {
  const employed = town.citizens.filter((c) => c.stage === 'employed');
  const perf = employed.length
    ? Math.round((employed.reduce((a, c) => a + c.performance, 0) / employed.length) * 100)
    : 0;
  const n = employed.length || town.citizens.length;
  return lang === 'zh'
    ? `这项工作由 ${n} 人的团队承担，目前他们自己的绩效为 ${perf}%。`
    : `This work would be carried by a team of ${n}, currently running at ${perf}% on their own measures.`;
}

function buildPitch(brief, sources, town, lang) {
  const used = new Set();
  const en = lang !== 'zh';
  const topic = topicOf(brief, lang);
  const slides = en ? [
    ['The one line', 'guild:chorus', `Say ${topic} in one sentence a stranger repeats correctly.`],
    ['The problem', 'guild:lumen', 'Whose problem, how often it bites, and what they do about it today.'],
    ['Why now', 'guild:aether', 'What changed recently that makes this possible or urgent now, not two years ago.'],
    ['What we do', 'guild:forge', 'The thing itself, in plain words. No adjectives.'],
    ['How it works', 'guild:lattice', 'The mechanism, in three steps a listener can hold in their head.'],
    ['Proof', 'guild:lumen', 'The most inconvenient evidence you have that this is real.'],
    ['The market', 'guild:ledger', 'Who pays, how many of them there are, and what they pay today for the alternative.'],
    ['The team', 'guild:hearth', 'Why these people, on this problem, are not a random choice.'],
    ['The plan', 'guild:wayfinder', 'What happens in the next two quarters, and what it depends on.'],
    ['The ask', 'guild:keystone', 'Exactly what you want from the room, and what it buys.'],
  ] : [
    ['一句话', 'guild:chorus', `用一句话说清${topic}——陌生人听完能准确复述。`],
    ['问题', 'guild:lumen', '谁的问题，多久疼一次，他们现在怎么应付。'],
    ['为什么是现在', 'guild:aether', '最近发生了什么变化，让这件事现在可行或紧迫，而不是两年前。'],
    ['我们做什么', 'guild:forge', '事情本身，用大白话说。不要形容词。'],
    ['怎么运作', 'guild:lattice', '三步讲清机制，听众能记住。'],
    ['证据', 'guild:lumen', '拿出你手上最不讨巧、但最真实的那条证据。'],
    ['市场', 'guild:ledger', '谁付钱、有多少这样的人、他们今天为替代方案付多少。'],
    ['团队', 'guild:hearth', '为什么是这群人做这件事，而不是随便谁。'],
    ['计划', 'guild:wayfinder', '接下来两个季度会发生什么，取决于什么。'],
    ['请求', 'guild:keystone', '你到底要对方给什么，这笔投入换来什么。'],
  ];
  const sections = slides.map(([name, g, hint], i) => ({
    key: `slide-${i + 1}`,
    heading: `${i + 1}. ${name}`,
    blocks: [{ type: 'p', text: hint }],
    author: sign(town, g.split(':')[1], used),
  }));
  if (brief.points.length) {
    sections.splice(4, 0, {
      key: 'your-points',
      heading: en ? 'Your material, placed' : '你的重点，先放这里',
      blocks: [...pointsBlock(brief.points, lang), ...quotesBlock(sources, lang, 5)],
      author: sign(town, 'lattice', used),
    });
  }
  return {
    title: brief.title || (en ? 'Pitch outline' : '路演大纲'),
    subtitle: en ? 'Ten slides, in the order a room can follow' : '十页，按听众能跟上的顺序',
    sections,
  };
}

function buildBrief(brief, sources, town, lang) {
  const used = new Set();
  const en = lang !== 'zh';
  const rows = en ? [
    ['Background', 'lumen', brief.client ? `For ${brief.client}.` : 'Where this came from and why it is on the table.'],
    ['Objective', 'keystone', brief.goal || 'The single outcome this work is judged on.'],
    ['Audience', 'chorus', 'Who this is for, and what they already believe.'],
    ['Scope', 'forge', brief.points.length ? '' : 'What is included — list it plainly.'],
    ['Not in scope', 'ledger', 'What this deliberately does not cover. Write it down now, not in an argument later.'],
    ['Success looks like', 'lattice', 'The observable thing that is true if this worked.'],
    ['Timing', 'wayfinder', brief.timeline || 'Key dates and what depends on them.'],
    ['Budget', 'ledger', brief.budget || 'The number, or the range, or who decides it.'],
  ] : [
    ['背景', 'lumen', brief.client ? `客户：${brief.client}。` : '这件事从哪来，为什么现在摆上桌。'],
    ['目标', 'keystone', brief.goal || '这项工作最终用哪一个结果来评判。'],
    ['受众', 'chorus', '这是给谁看的，他们原本就相信什么。'],
    ['范围', 'forge', brief.points.length ? '' : '包含哪些内容——直白列出来。'],
    ['不做什么', 'ledger', '明确不覆盖的部分。现在写下来，别等到吵架的时候。'],
    ['成功的样子', 'lattice', '如果做成了，什么是能被观察到的事实。'],
    ['时间', 'wayfinder', brief.timeline || '关键日期，以及它们各自依赖什么。'],
    ['预算', 'ledger', brief.budget || '数字、区间，或者由谁来定。'],
  ];
  const sections = rows.map(([name, guild, text], i) => ({
    key: `brief-${i}`,
    heading: name,
    blocks: name === (en ? 'Scope' : '范围') && brief.points.length
      ? [{ type: 'list', items: brief.points }]
      : [{ type: 'p', text }],
    author: sign(town, guild, used),
  }));
  if (sources.length) {
    sections.push({
      key: 'refs',
      heading: en ? 'Reference material' : '参考资料',
      blocks: quotesBlock(sources, lang, 8),
      author: sign(town, 'lumen', used),
    });
  }
  return {
    title: brief.title || (en ? 'Working brief' : '工作简报'),
    subtitle: T[lang].preparedFor(brief.client),
    sections,
  };
}

function buildEmail(brief, sources, town, lang) {
  const used = new Set();
  const en = lang !== 'zh';
  const topic = topicOf(brief, lang);
  const who = brief.client || (en ? 'there' : '你好');
  const body = en ? [
    `Hi ${who},`,
    `${brief.goal ? `You mentioned ${brief.goal}.` : `About ${topic}.`} I have put down what I understand and what I would do about it.`,
    brief.points.length ? 'In short:' : '',
  ] : [
    `${who}，你好：`,
    `${brief.goal ? `你提到${pad(brief.goal, lang)}。` : `关于${topic}。`}我把我理解到的和打算怎么做写在下面。`,
    brief.points.length ? '简单说：' : '',
  ];
  const close = en
    ? [`If that reads right, I can have a fuller version to you ${brief.timeline || 'this week'}. If it does not, tell me which part is off and I will redo it.`, 'Thanks,']
    : [`如果方向没错，我可以在${pad(brief.timeline, lang) || '本周内'}给你一版更完整的。如果不对，告诉我哪一段偏了，我重写。`, '谢谢，'];

  return {
    title: brief.title || (en ? 'Email draft' : '邮件草稿'),
    subtitle: en
      ? `Subject: ${brief.title || brief.goal || 'Following up'}`
      : `主题：${brief.title || brief.goal || '跟进'}`,
    sections: [
      {
        key: 'body',
        heading: en ? 'Draft' : '正文',
        blocks: [
          ...body.filter(Boolean).map((text) => ({ type: 'p', text })),
          ...(brief.points.length ? [{ type: 'list', items: brief.points }] : []),
          ...close.map((text) => ({ type: 'p', text })),
        ],
        author: sign(town, 'chorus', used),
      },
      ...(sources.length ? [{
        key: 'notes',
        heading: en ? 'Not in the email — your notes' : '不放进邮件——你的资料',
        blocks: quotesBlock(sources, lang, 5),
        author: sign(town, 'lumen', used),
      }] : []),
    ],
  };
}

/* ------------------------------------------------------------- registry */

export const DELIVERABLES = [
  { id: 'proposal', emoji: '\u{1F4DC}', en: 'Proposal', zh: '提案', build: buildProposalDoc },
  { id: 'ideas', emoji: '\u{1F4A1}', en: 'Ideas', zh: '想法', build: buildIdeas },
  { id: 'pitch', emoji: '\u{1F5E3}', en: 'Pitch outline', zh: '路演大纲', build: buildPitch },
  { id: 'brief', emoji: '\u{1F4CB}', en: 'Brief', zh: '简报', build: buildBrief },
  { id: 'email', emoji: '\u{2709}', en: 'Email', zh: '邮件', build: buildEmail },
];

export const DELIVERABLE_BY_ID = Object.fromEntries(DELIVERABLES.map((d) => [d.id, d]));

// Assemble one deliverable. `brief.points` is always an array.
export function assemble(kind, brief, sources, town, lang = 'en') {
  const spec = DELIVERABLE_BY_ID[kind] || DELIVERABLE_BY_ID.proposal;
  const safeBrief = { ...brief, points: (brief.points || []).map((p) => String(p).trim()).filter(Boolean) };
  const doc = spec.build(safeBrief, sources || [], town, lang === 'zh' ? 'zh' : 'en');
  return {
    ...doc,
    kind: spec.id,
    kindName: lang === 'zh' ? spec.zh : spec.en,
    lang: lang === 'zh' ? 'zh' : 'en',
    note: T[lang === 'zh' ? 'zh' : 'en'].note,
    sourceCount: (sources || []).length,
  };
}
