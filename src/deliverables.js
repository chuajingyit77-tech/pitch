// What the town can make for you. Every deliverable is assembled from your brief
// and your material, section by section, and signed by the citizen whose craft
// that section belongs to.

import { GUILDS } from './data.js';
import { readDocument, diaryDates } from './reading-room.js';

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
  { id: 'proposal', emoji: '\u{1F4DC}', en: 'Proposal', zh: '提案', ctaEn: 'Ask the town for a proposal', ctaZh: '让小镇写提案', build: buildProposalDoc },
  { id: 'ideas', emoji: '\u{1F4A1}', en: 'Ideas', zh: '想法', ctaEn: 'Ask the town for ideas', ctaZh: '让小镇给想法', build: buildIdeas },
  { id: 'pitch', emoji: '\u{1F5E3}', en: 'Pitch outline', zh: '路演大纲', ctaEn: 'Ask the town for an outline', ctaZh: '让小镇列大纲', build: buildPitch },
  { id: 'brief', emoji: '\u{1F4CB}', en: 'Brief', zh: '简报', ctaEn: 'Ask the town for a brief', ctaZh: '让小镇写简报', build: buildBrief },
  { id: 'email', emoji: '\u{2709}', en: 'Email', zh: '邮件', ctaEn: 'Ask the town to draft it', ctaZh: '让小镇拟邮件', build: buildEmail },
  { id: 'review', emoji: '\u{1F50D}', en: 'Check my proposal', zh: '检查我的提案', ctaEn: 'Ask the town to check it', ctaZh: '让小镇检查', build: buildReview },
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

/* ------------------------------------------------------------- reviewing */

const CLICHES = [
  'world-class', 'cutting-edge', 'best-in-class', 'synergy', 'synergies', 'leverage',
  'seamless', 'holistic', 'paradigm', 'game-changing', 'value-add', 'turnkey',
  'state-of-the-art', 'robust solution', 'bespoke solution',
  '一站式', '赋能', '闭环', '抓手', '颠覆', '业界领先', '世界一流', '全方位',
];
const OVERPROMISE = [
  'guarantee', 'guaranteed', '100%', 'unlimited', 'always', 'never fail', 'risk-free',
  'no risk', 'any time', 'fully automated',
  '保证', '一定能', '无限', '绝对', '零风险', '百分之百',
];

const has = (text, words) => words.filter((w) => text.toLowerCase().includes(w.toLowerCase()));
const oneLine = (v) => String(v).replace(/\s+/g, ' ').trim();

const firstMatch = (text, re) => {
  const m = re.exec(text);
  return m ? m[0].trim() : null;
};

// The sentence a match sits in, so a finding can point at real words.
function sentenceAround(text, needle) {
  const at = text.toLowerCase().indexOf(String(needle).toLowerCase());
  if (at < 0) return null;
  const from = Math.max(0, text.lastIndexOf('\n', at) + 1);
  // A full stop only ends a sentence when something other than a digit follows,
  // so "RM 4.5 million" stays in one piece.
  const stop = text.slice(at).search(/[。!！?？\n]|\.(?=\s|$)/);
  const to = stop < 0 ? Math.min(text.length, at + 160) : at + stop + 1;
  const line = text.slice(from, to).trim();
  return line.length > 220 ? `${line.slice(0, 217)}...` : line;
}

// Everything the checks below need to know about the document, measured once.
export function measureText(text) {
  const words = (text.match(/[\p{L}\p{N}][\p{L}\p{N}'-]*/gu) || []).length;
  const cjk = (text.match(/[一-鿿]/g) || []).length;
  const sentences = (text.match(/[^.。!！?？\n]{6,}[.。!！?？]/g) || []);
  const avgSentence = sentences.length
    ? Math.round(sentences.reduce((a, s) => a + (s.match(/\S+/g) || []).length, 0) / sentences.length)
    : 0;
  return {
    words: words + Math.round(cjk / 1.6),
    cjk,
    sentences: sentences.length,
    avgSentence,
    longest: sentences.slice().sort((a, b) => b.length - a.length)[0] || '',
    paragraphs: text.split(/\n\s*\n/).filter((p) => p.trim().length > 40).length,
    numbers: (text.match(/\d[\d,.]*/g) || []).length,
    money: text.match(/(?:RM|USD|SGD|MYR|\$|£|€|¥|RMB)\s?[\d,.]+\s?(?:m|k|million|billion|万|亿)?|\d[\d,.]*\s*(?:万|亿|元|令吉|dollars?)/gi) || [],
    dates: text.match(/\b(?:Q[1-4]|202\d|20[3-9]\d)\b|\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\b|\d+\s*(?:weeks?|months?|days?)|\d+\s*(?:周|个月|天|月份)|第[一二三四]季度/gi) || [],
    you: (text.match(/\byou\b|\byour\b|你们|贵[公司方]/gi) || []).length,
    we: (text.match(/\bwe\b|\bour\b|\bus\b|我们|本[公司司]/gi) || []).length,
    passive: (text.match(/\b(?:is|are|was|were|be|been|being)\s+\w+(?:ed|en)\b/gi) || []).length,
    cliches: has(text, CLICHES),
    overpromise: has(text, OVERPROMISE),
  };
}

// Each guild checks the one thing its craft cares about.
const CHECKS = [
  {
    guild: 'ledger', en: 'The money', zh: '钱',
    run: (t, m, lang) => (m.money.length
      ? { ok: true,
          en: `A price is stated — ${m.money.slice(0, 3).map(oneLine).join(', ')}. A reader can act on that.`,
          zh: `文中写了价格——${m.money.slice(0, 3).map(oneLine).join('、')}。读者能据此行动。`,
          quote: sentenceAround(t, m.money[0]) }
      : { ok: false,
          en: 'No price anywhere in this document. A proposal without a number makes the reader do the work of guessing, and they will guess low or walk away.',
          zh: '整份文件里没有价格。没有数字的提案，等于让对方替你猜——他们要么猜低，要么走开。' }),
  },
  {
    guild: 'wayfinder', en: 'The dates', zh: '时间',
    run: (t, m) => (m.dates.length
      ? { ok: true,
          en: `Timing is on the page — ${[...new Set(m.dates.map(oneLine))].slice(0, 4).join(', ')}.`,
          zh: `时间写清楚了——${[...new Set(m.dates.map(oneLine))].slice(0, 4).join('、')}。`,
          quote: sentenceAround(t, m.dates[0]) }
      : { ok: false,
          en: 'No dates and no durations. "Soon" is not a plan; give at least a start and a first milestone.',
          zh: '没有日期，也没有周期。「尽快」不是计划——至少给出开始时间和第一个里程碑。' }),
  },
  {
    guild: 'keystone', en: 'What is not included', zh: '不包含什么',
    run: (t) => {
      const found = firstMatch(t, /(not included|out of scope|excludes?|does not cover|不包[含括]|不在范围|不负责)/i);
      return found
        ? { ok: true, en: 'The boundary is written down. That sentence is what protects you later.', zh: '边界写下来了。以后保护你的就是这句话。', quote: sentenceAround(t, found) }
        : { ok: false,
            en: 'Nothing says what this does NOT cover. Every argument about scope starts here — one short paragraph now saves a hard conversation later.',
            zh: '没有一句话说明「不做什么」。所有关于范围的争执都从这里开始——现在写一小段，省掉以后一场硬仗。' };
    },
  },
  {
    guild: 'lattice', en: 'How success is measured', zh: '怎么算成功',
    run: (t) => {
      const found = firstMatch(t, /(success (?:is|will be|looks)|measured? by|KPI|metrics?|benchmark|成功的标准|衡量|指标)/i);
      return found
        ? { ok: true, en: 'There is a stated measure. Both sides can tell whether this worked.', zh: '写了衡量标准，双方都能判断这件事成没成。', quote: sentenceAround(t, found) }
        : { ok: false,
            en: 'No measure of success. Without one, "done" is whatever the client feels on the day.',
            zh: '没有成功的衡量标准。没有它，「做完了」就取决于客户当天的心情。' };
    },
  },
  {
    guild: 'lumen', en: 'Evidence', zh: '证据',
    run: (t, m) => (m.numbers >= 6
      ? { ok: true, en: `${m.numbers} figures in the document — the argument rests on something.`, zh: `文中有 ${m.numbers} 处数字——论证有落点。` }
      : { ok: false,
          en: `Only ${m.numbers} figure${m.numbers === 1 ? '' : 's'} in the whole document. Claims without numbers read as opinion. Add one piece of evidence per claim that matters.`,
          zh: `全文只有 ${m.numbers} 处数字。没有数字的主张读起来只是意见——给每个重要主张配一条证据。` }),
  },
  {
    guild: 'forge', en: 'What they actually get', zh: '他们到底拿到什么',
    run: (t) => {
      const found = firstMatch(t, /(you (?:will )?(?:get|receive)|deliverables?|we will (?:deliver|produce|build|provide)|交付|你会拿到|我们会提供)/i);
      return found
        ? { ok: true, en: 'Deliverables are named. The reader knows what lands on their desk.', zh: '交付物写明了，读者知道最后拿到什么。', quote: sentenceAround(t, found) }
        : { ok: false,
            en: 'The document never names what the client ends up holding. Describe the artefacts, not the activity.',
            zh: '文件里始终没说客户最后手里有什么。要描述产出物，而不是过程。' };
    },
  },
  {
    guild: 'chorus', en: 'The opening', zh: '开头',
    run: (t, m, lang) => {
      const first = t.split(/\n/).map((l) => l.trim()).find((l) => l.length > 45) || '';
      if (m.cliches.length) {
        return { ok: false,
          en: `The language leans on stock phrases: ${m.cliches.slice(0, 4).join(', ')}. Every competitor writes these; they carry no information. Say the specific thing instead.`,
          zh: `文字里有套话：${m.cliches.slice(0, 4).join('、')}。每个竞争对手都在写这些，它们不携带信息——换成具体的说法。`,
          quote: sentenceAround(t, m.cliches[0]) };
      }
      return first
        ? { ok: true, en: 'The opening says something specific rather than clearing its throat.', zh: '开头直接说事，没有绕圈子。', quote: first.length > 200 ? `${first.slice(0, 197)}...` : first }
        : { ok: false, en: 'There is no real opening paragraph — the document starts mid-thought.', zh: '没有真正的开头段落，文件像是从半句话开始的。' };
    },
  },
  {
    guild: 'mender', en: 'Promises you may regret', zh: '可能后悔的承诺',
    run: (t, m) => (m.overpromise.length
      ? { ok: false,
          en: `Absolute promises: ${m.overpromise.slice(0, 4).join(', ')}. These are the lines that get quoted back at you. Soften them or make them conditional.`,
          zh: `出现了绝对化的承诺：${m.overpromise.slice(0, 4).join('、')}。这些话日后会被原样引用回来——要么放软，要么加条件。`,
          quote: sentenceAround(t, m.overpromise[0]) }
      : { ok: true, en: 'No absolute promises. Nothing here will be read back to you in a dispute.', zh: '没有绝对化的承诺，将来不会有人拿着某句话来质问你。' }),
  },
  {
    guild: 'hearth', en: 'Who it is written for', zh: '写给谁看',
    run: (t, m) => {
      if (m.you === 0 && m.words > 80) {
        return { ok: false,
          en: 'The document never addresses the reader directly — not one "you". It reads as a description of the seller. Rewrite the opening in the second person.',
          zh: '整份文件没有一次直接称呼读者——一个「你」都没有。它读起来像在描述卖方。把开头改成对着对方说。' };
      }
      if (m.we > m.you * 2 && m.we > 6) {
        return { ok: false,
          en: `The document says "we" ${m.we} times and "you" ${m.you}. It is about the seller, not the buyer. Turn the sentences around.`,
          zh: `文中「我们」出现 ${m.we} 次，「你/贵司」只有 ${m.you} 次。这份东西在讲卖方，不是买方——把句子调转过来。` };
      }
      return { ok: true, en: `Balanced address — "you" ${m.you}, "we" ${m.we}. It reads as being written for the reader.`, zh: `称呼比例合适——「你」${m.you} 次，「我们」${m.we} 次，读起来是写给对方的。` };
    },
  },
  {
    guild: 'aether', en: 'Why now', zh: '为什么是现在',
    run: (t) => {
      const found = firstMatch(t, /(right now|this year|window|urgent|before the|opportunity to|现在|当下|今年|窗口|时机)/i);
      return found
        ? { ok: true, en: 'There is a reason this is happening now rather than later.', zh: '说明了为什么是现在做，而不是以后。', quote: sentenceAround(t, found) }
        : { ok: false,
            en: 'Nothing explains why now. Without urgency, a good proposal simply waits on someone’s desk.',
            zh: '没有说明为什么是现在。缺了紧迫感，再好的提案也只是躺在别人桌上。' };
    },
  },
  {
    guild: 'verdant', en: 'What happens next', zh: '接下来做什么',
    run: (t) => {
      const found = firstMatch(t, /(next steps?|to proceed|to get started|sign|approve|下一步|如何开始|签署|确认后)/i);
      return found
        ? { ok: true, en: 'The reader is told what to do next. That is what turns reading into a decision.', zh: '告诉了读者下一步该做什么——这才把「读完」变成「决定」。', quote: sentenceAround(t, found) }
        : { ok: false,
            en: 'The document ends without asking for anything. Tell them exactly what the next action is, and who takes it.',
            zh: '文件结束时什么都没要。明确写出下一步动作是什么、由谁来做。' };
    },
  },
];

// Read a document and report on it, guild by guild.
function buildReview(brief, sources, town, lang) {
  const en = lang !== 'zh';
  const text = sources
    .map((s) => s.text || s.highlights.join('\n'))
    .join('\n\n')
    .trim();
  const used = new Set();

  if (text.length < 200) {
    return {
      title: en ? 'Nothing to review yet' : '还没有可以审阅的东西',
      subtitle: en ? 'The town needs the document itself' : '小镇需要文件本身',
      sections: [{
        key: 'empty',
        heading: en ? 'Hand over the proposal' : '把提案交过来',
        blocks: [{
          type: 'p',
          text: en
            ? 'Upload the PDF or paste the text of the proposal you want checked. Key points alone are not enough to review — the town reads the actual words.'
            : '上传 PDF，或把要检查的提案正文贴进来。只有要点是没法审阅的——小镇读的是实际的字句。',
        }],
        author: sign(town, 'hearth', used),
      }],
    };
  }

  const m = measureText(text);
  const results = CHECKS.map((check) => ({ check, verdict: check.run(text, m, lang) }));
  const flagged = results.filter((r) => !r.verdict.ok);

  const overview = {
    key: 'overview',
    heading: en ? 'What the town found' : '小镇看到的',
    status: flagged.length === 0 ? 'good' : flagged.length > 4 ? 'look' : 'mixed',
    blocks: [
      { type: 'p', text: en
        ? `${results.length - flagged.length} of ${results.length} checks pass. ${flagged.length ? `${flagged.length} need${flagged.length === 1 ? 's' : ''} your attention, below.` : 'Nothing is missing that the town knows to look for.'}`
        : `${results.length} 项检查里通过 ${results.length - flagged.length} 项。${flagged.length ? `有 ${flagged.length} 项需要你处理，列在下面。` : '小镇知道要找的东西，都在。'}` },
      { type: 'p', text: en
        ? `${m.words} words, ${m.paragraphs} paragraph${m.paragraphs === 1 ? '' : 's'}, ${m.numbers} figure${m.numbers === 1 ? '' : 's'}, average sentence ${m.avgSentence} words.${m.avgSentence > 26 ? ' That average is long — a reader skimming will lose the thread.' : ''}`
        : `全文约 ${m.words} 字，${m.paragraphs} 个段落，${m.numbers} 处数字，平均句长 ${m.avgSentence} 词。${m.avgSentence > 26 ? ' 句子偏长，快速浏览的读者会跟丢。' : ''}` },
      ...(flagged.length ? [{
        type: 'list',
        items: flagged.map((r) => (en ? r.check.en : r.check.zh)),
      }] : []),
    ],
    author: sign(town, 'keystone', used),
  };

  const sections = results.map(({ check, verdict }) => {
    const guild = GUILDS.find((g) => g.id === check.guild);
    return {
      key: `check-${check.guild}`,
      heading: `${guild.name.replace(' Guild', '')} — ${en ? check.en : check.zh}`,
      status: verdict.ok ? 'good' : 'look',
      blocks: [
        { type: 'p', text: en ? verdict.en : verdict.zh },
        ...(verdict.quote ? [{ type: 'quotes', items: [verdict.quote] }] : []),
      ],
      author: sign(town, check.guild, used),
    };
  });

  return {
    title: brief.title || (en ? 'Proposal review' : '提案审阅'),
    subtitle: en
      ? `${sources.length} document${sources.length === 1 ? '' : 's'} read, ${results.length} checks`
      : `读了 ${sources.length} 份文件，做了 ${results.length} 项检查`,
    sections: [overview, ...sections],
  };
}

/* ---------------------------------------------------------- the council */

// The eleven questions the council holds, as they appear inside the prompt.
const COUNCIL_SEATS = [
  ['aether', 'the real driver',
    'What am I actually trying to fix? Name the underlying want, not the stated one. Often the question itself is wrong.',
    '我到底想解决什么？说出底下那个真实的渴望，而不是我嘴上说的。很多时候问题本身就问错了。'],
  ['lumen', 'the evidence',
    'What does the evidence actually say? Study quality, sample sizes, who funded it, whether it replicated. Name the strongest study against my instinct.',
    '证据到底说了什么？研究质量、样本量、谁出的钱、有没有被重复验证。把最能反驳我直觉的那项研究点出来。'],
  ['mender', 'body and mind',
    'Physical and psychological consequences. Dose-dependent, on what timeline, and how reversible.',
    '生理和心理后果。跟剂量的关系、多久出现、可不可逆。'],
  ['keystone', 'law and record',
    'Legality where I live, realistic consequences if caught, what ends up on a permanent record.',
    '在我所在地是否合法、被抓到的现实后果、什么会留在永久记录上。'],
  ['ledger', 'the money',
    'Full cost including the hidden ones, the opportunity cost, and who is selling to me.',
    '全部成本，包括看不见的；机会成本；以及谁在向我兜售。'],
  ['wayfinder', 'the alternatives',
    'What else gets me the same outcome, and what each of those costs.',
    '还有什么别的办法能达到同样的结果，各自的代价是多少。'],
  ['forge', 'the smallest test',
    'The cheapest reversible version of this, and what trying it would actually tell me.',
    '这件事最便宜、最可逆的试法是什么，试完能告诉我什么。'],
  ['lattice', 'the signals',
    'What would show me it is working, and what would tell me to stop. Observable, specific, checkable.',
    '什么现象说明它起作用了，什么现象说明我该停。要可观察、具体、能核对。'],
  ['verdant', 'the long run',
    'Where this leads in one year and in five if I keep going. Compounding, in both directions.',
    '如果一直做下去，一年后、五年后会走到哪。两个方向的复利都要说。'],
  ['chorus', 'the story',
    'How I would explain this to someone whose judgement I respect, and what that explanation reveals about my real reasons.',
    '如果要向一个我尊重其判断力的人解释这件事，我会怎么说——而这个说法暴露了我真正的理由是什么。'],
  ['hearth', 'the people around me',
    'Who else carries the consequences, and who picks up the pieces if it goes badly.',
    '谁会一起承担后果，出事时谁来收拾。'],
];

function councilPrompt(question, context, material, lang) {
  const named = (id) => (GUILDS.find((g) => g.id === id) || {}).name.replace(' Guild', '');
  const seats = COUNCIL_SEATS.map(([id, title, en]) => `- **${named(id)}** — ${title}: ${en}`);
  const zhSeats = COUNCIL_SEATS.map(([id, , , zh]) => `- **${named(id)}**：${zh}`);

  if (lang === 'zh') {
    return `你们是渐层小镇的常设议会——十一个公会，每一个都是一个专业顾问团。
决定由我来做。你们是顾问，不是守门人。你们的职责是让我的决定更有依据，不是替我做决定，也不是保护我不受我自己影响。

## 议事规则

1. 要数字，不要形容词。「有风险」没有用；「大约每 200 人里有 1 个会出现某症状，通常在头一个月内」才有用。没有数字就直说，并给出估计和依据。
2. 标明把握：每条实质说法标上 [已确立] / [有争议] / [我的推断] / [未知]。证据薄弱就说薄弱。
3. 警告一次，然后往下走。带上量级，讲一次。不要每节重复，不要说教，不要加我没要的免责声明。
4. 不要含糊到没用。「看情况」不算回答，除非说清看什么情况，然后针对我的实际情况回答。
5. 看钱流向哪：我选「是」谁获利，选「否」谁获利，包括出资做那些警告的人。
6. 假设我可能还是会去做。结尾一定要给：如果我执意要做，最聪明的做法是什么，出现哪些信号我该停手。
7. 你们之间可以吵。有分歧就摆出来，不要为了统一而制造共识。
8. 不确定就先问，最多三个问题；我不回答就按明确列出的假设继续。
9. 按问题大小开会：小问题只召集三四个公会，说明跳过了谁。

## 十一个公会

${zhSeats.join('\n')}

## 输出格式

先给一句话最诚实的结论。然后每个被召集的公会一小段（不超过 150 字，用自己的口吻，标注确定程度），没话说的直接跳过。最后是判词：

- **建议**：去做 / 满足这些条件再做 / 别做 / 信息还不够——一句话，不打太极
- **把握**：高 / 中 / 低，以及什么会改变它
- **一条不能忘的事实**
- **公会之间的分歧**（如果有）
- **如果我执意要做**：最聪明的做法，以及什么情况下必须停

## 关于难问题

我问的事情里有些会有风险、在我所在地不合法、或者对我明显不好。按上面的规矩处理：真实的量级、真实的法律后果、如果我执意要做时真实的减害建议。不要拒绝分析，不要说教，不要用一句警告代替回答。我不是在要「怎么弄到」或「怎么制造」的操作指导——那不是分析。除此之外，我要直话直说。

---

## 我的问题

${question}
${context ? `\n## 你需要知道的我的情况\n\n${context}` : ''}${material ? `\n## 相关资料（我提供的）\n\n${material}` : ''}

现在开始议事。`;
  }

  return `You are the standing council of Gradient Town — eleven guilds, each a specialist advisory body.
I am the one who decides. You are advisors, not gatekeepers. Your job is to make my decision better informed. It is not to make the decision for me, and it is not to protect me from myself.

## Rules of the council

1. Numbers over adjectives. "Risky" is useless; "roughly 1 in 200 people who do this have that happen, usually inside the first month" is useful. No number — say so, then give your best estimate and its basis.
2. Mark how sure you are: tag every material claim [established] / [contested] / [my estimate] / [unknown]. Thin evidence should be called thin, not padded.
3. Warn once, then move on. State the danger plainly, one time, with its magnitude. Do not repeat it in every section, do not moralise, do not add a disclaimer I did not ask for.
4. No hedging into uselessness. "It depends" is a non-answer unless you say what it depends on, then answer for my actual case.
5. Follow the money: who profits if I decide yes, who profits if I decide no — including whoever funds the warnings.
6. Assume I may do it anyway. Always end with the smartest way to proceed if I go ahead regardless, and the specific signals that should make me stop.
7. Disagree with each other. Show the split; never manufacture consensus.
8. Ask before assuming — up to three questions if the answer turns on something you do not know about me, then proceed on stated assumptions.
9. Scale to the question: a small question convenes three or four guilds, not eleven. Say which you skipped.

## The eleven guilds

${seats.join('\n')}

## Output

One honest headline first. Then a short section per convened guild — 120 words maximum, in its own voice, findings tagged for certainty. Skip guilds with nothing to add. Then the verdict:

- **Recommendation**: do it / do it with these conditions / do not / not enough information — one sentence, no hedging
- **Confidence**: high / medium / low, and what would change it
- **The one fact** I should not forget
- **Where the guilds disagreed**, if they did
- **If I proceed anyway**: the smartest version, and the conditions under which I should stop

## On the hard questions

Some of what I bring will be risky, illegal where I live, or plainly bad for me. Handle those exactly as above: real magnitudes, real legal exposure, real harm reduction if I proceed. Do not refuse to analyse, do not lecture, do not substitute a warning for an answer. I am not asking for procurement or manufacture instructions — that is not analysis. Everything else, I want straight.

---

## My question

${question}
${context ? `\n## What you should know about me\n\n${context}` : ''}${material ? `\n## Material I am giving you\n\n${material}` : ''}

Convene the council.`;
}

function buildCouncil(brief, sources, town, lang) {
  const en = lang !== 'zh';
  const used = new Set();
  const question = brief.goal || brief.title
    || (en ? '(write your question here)' : '（在这里写下你的问题）');
  const context = brief.points.join('\n');
  const material = sources
    .flatMap((s) => s.highlights.map((h) => `- ${h}`))
    .slice(0, 12)
    .join('\n');

  return {
    title: brief.title || (en ? 'A question for the council' : '给议会的一个问题'),
    subtitle: en
      ? 'Copy this into any assistant — it carries your question with it'
      : '把这份贴进任何 AI——它已经带上了你的问题',
    sections: [
      {
        key: 'how',
        heading: en ? 'How to use this' : '怎么用',
        blocks: [{
          type: 'p',
          text: en
            ? 'Copy the whole block below and paste it as your first message to any assistant — Claude, ChatGPT, Gemini, a local model. It sets up the eleven guilds as your advisory council, states the rules they answer under, and carries your question and material with it. Reply to their questions as they come.'
            : '把下面整段复制，作为第一条消息贴给任何 AI——Claude、ChatGPT、Gemini、本地模型都行。它会把十一个公会设成你的顾问团，定好他们回答的规矩，并且已经带上了你的问题和资料。他们反问你时，照实回答就行。',
        }],
        author: sign(town, 'hearth', used),
      },
      {
        key: 'prompt',
        heading: en ? 'The council prompt' : '议会 prompt',
        blocks: [{ type: 'prompt', text: councilPrompt(question, context, material, en ? 'en' : 'zh') }],
        author: sign(town, 'keystone', used),
      },
    ],
  };
}

DELIVERABLES.push({
  id: 'council', emoji: '\u{1F3DB}', en: 'Ask the council', zh: '召集议会',
  ctaEn: 'Build a council prompt', ctaZh: '生成议会 prompt', build: buildCouncil,
});
DELIVERABLE_BY_ID.council = DELIVERABLES[DELIVERABLES.length - 1];


/* ------------------------------------------------------- the reading room */

const READ_COPY = {
  en: {
    nothing: 'Hand the town a document',
    nothingBody: 'Upload the PDF, or paste the text of the contract, quotation, policy or letter you want read. The town reads the words themselves - a few notes are not enough.',
    overview: 'What this is',
    numbers: 'The numbers in it',
    diary: 'Put these in your calendar',
    missing: 'Not in here',
    asks: 'Ask them this',
    further: 'Take it further',
    kinds: { money: 'Money', percent: 'Rate', duration: 'Period', date: 'Date' },
    role: { rent: 'Rent', deposit: 'Deposit', penalty: 'Penalty', fee: 'Fee', notice: 'Notice period', term: 'Term', increase: 'Increase' },
    cols: ['What', 'Value', 'Where it says so'],
    diaryCols: ['Date', 'What happens', 'From'],
    noneMissing: 'Everything the town knows to look for in this kind of document is present.',
    askLead: 'Copy these and send them. Each one is a real gap in what you have been given.',
    furtherLead: 'This prompt carries the document and the findings. Paste it into any assistant to go deeper on the clauses that worry you.',
  },
  zh: {
    nothing: '先把文件交给小镇',
    nothingBody: '上传 PDF，或把合同、报价、保单、通知的正文贴进来。小镇读的是文件本身的字句，几条笔记是不够的。',
    overview: '这是什么',
    numbers: '文件里的数字',
    diary: '把这些放进日历',
    missing: '这里面没有的',
    asks: '把这些问回去',
    further: '继续深挖',
    kinds: { money: '金额', percent: '比率', duration: '期限', date: '日期' },
    role: { rent: '租金', deposit: '押金', penalty: '罚则', fee: '费用', notice: '通知期', term: '期限', increase: '涨幅' },
    cols: ['是什么', '数值', '出自哪一句'],
    diaryCols: ['日期', '会发生什么', '出处'],
    noneMissing: '小镇知道要在这类文件里找的东西，这份都有。',
    askLead: '把这些复制发过去。每一条都对应你手上真实缺的东西。',
    furtherLead: '这段 prompt 已经带上文件和发现。贴给任何 AI，就能针对你担心的条款继续深挖。',
  },
};

function readingPrompt(text, read, lang) {
  const en = lang === 'en';
  const concerns = read.found
    .map((f) => `- ${en ? f.check.en : f.check.zh}: "${f.quote}"`)
    .join('\n');
  const gaps = read.missing.map((c) => `- ${en ? c.en : c.zh}`).join('\n');
  const body = text.length > 12000 ? `${text.slice(0, 12000)}\n[...truncated]` : text;

  if (!en) {
    return `你是一位替我看文件的资深顾问。下面是一份${read.type.zh}的全文，以及我已经标出的疑点。

请你做三件事：
1. 逐条评估我标出的疑点：这在同类文件里是否常见？对我实际的风险有多大？给出量级，不要只说「有风险」。
2. 找出我漏掉的问题——特别是那些看起来正常、实际上对我不利的措辞。
3. 给我一份改写建议：哪几句该改成什么，用可以直接发给对方的说法。

规矩：引用原文时要写清是哪一条。不确定的地方标明不确定。不要给我泛泛的免责声明，我要的是具体的判断。

## 我已经标出的疑点

${concerns || '（暂无）'}

${gaps ? `## 文件里似乎缺少的\n\n${gaps}\n` : ''}
## 文件全文

${body}`;
  }

  return `You are a senior adviser reading a document on my behalf. Below is the full text of a ${read.type.en.toLowerCase()}, and the concerns I have already marked.

Do three things:
1. Assess each concern I marked: is this normal in documents of this kind, and how much real exposure does it create for me? Give magnitudes, not just "this is risky".
2. Find what I missed - particularly wording that looks ordinary but works against me.
3. Give me redlines: which sentences to change, and the exact wording I could send back.

Rules: cite the clause number when you quote. Say plainly where you are unsure. Skip the general disclaimers - I want specific judgement.

## Concerns I already marked

${concerns || '(none yet)'}

${gaps ? `## Apparently missing from the document\n\n${gaps}\n` : ''}
## Full text

${body}`;
}

function buildReading(brief, sources, town, lang) {
  const en = lang !== 'zh';
  const C = READ_COPY[en ? 'en' : 'zh'];
  const used = new Set();
  const text = sources.map((s) => s.text || s.highlights.join('\n')).join('\n\n').trim();

  if (text.length < 200) {
    return {
      title: C.nothing,
      subtitle: en ? 'The Reading Room' : '阅读室',
      sections: [{
        key: 'empty', heading: C.nothing,
        blocks: [{ type: 'p', text: C.nothingBody }],
        author: sign(town, 'hearth', used),
      }],
    };
  }

  const read = readDocument(text, en ? 'en' : 'zh');
  const diary = diaryDates(read);
  const high = read.found.filter((f) => f.check.severity === 'high').length;
  const sections = [];

  sections.push({
    key: 'overview',
    heading: C.overview,
    status: high ? 'look' : read.found.length ? 'mixed' : 'good',
    blocks: [{
      type: 'p',
      text: en
        ? `This reads as a ${read.type.en.toLowerCase()}. The town found ${read.found.length} clause${read.found.length === 1 ? '' : 's'} worth your attention${high ? `, ${high} of them serious` : ''}, pulled out ${read.figures.length} figures, and has ${read.missing.length} thing${read.missing.length === 1 ? '' : 's'} it expected to see and did not.`
        : `这看起来是一份${read.type.zh}。小镇找出 ${read.found.length} 处值得注意的条款${high ? `，其中 ${high} 处比较严重` : ''}，提取了 ${read.figures.length} 个数字，另有 ${read.missing.length} 项本该出现却没找到。`,
    }],
    author: sign(town, 'lumen', used),
  });

  if (read.figures.length) {
    sections.push({
      key: 'numbers',
      heading: C.numbers,
      blocks: [{
        type: 'table',
        head: C.cols,
        rows: read.figures.slice(0, 24).map((f) => [
          f.role ? C.role[f.role] || C.kinds[f.kind] : C.kinds[f.kind],
          f.value,
          f.context,
        ]),
      }],
      author: sign(town, 'ledger', used),
    });
  }

  if (diary.length) {
    sections.push({
      key: 'diary',
      heading: C.diary,
      status: diary.some((d) => d.critical) ? 'look' : undefined,
      blocks: [{
        type: 'table',
        head: C.diaryCols,
        rows: diary.map((d) => [d.when + (d.critical ? ' ❗' : ''), d.what, d.from]),
      }],
      author: sign(town, 'wayfinder', used),
    });
  }

  for (const { check, quote } of read.found) {
    const guild = GUILDS.find((g) => g.id === check.guild);
    sections.push({
      key: `clause-${check.id}`,
      heading: `${guild.name.replace(' Guild', '')} — ${en ? check.en : check.zh}`,
      status: 'look',
      blocks: [
        { type: 'quotes', items: [quote] },
        { type: 'p', text: en ? check.whyEn : check.whyZh },
      ],
      author: sign(town, check.guild, used),
    });
  }

  sections.push({
    key: 'missing',
    heading: C.missing,
    status: read.missing.length ? 'look' : 'good',
    blocks: read.missing.length
      ? [{ type: 'list', items: read.missing.map((c) => `${en ? c.en : c.zh} — ${en ? c.missingEn : c.missingZh}`) }]
      : [{ type: 'p', text: C.noneMissing }],
    author: sign(town, 'keystone', used),
  });

  const asks = [
    ...read.found.map((f) => (en ? f.check.askEn : f.check.askZh)),
    ...read.missing.map((c) => (en ? c.askEn : c.askZh)),
  ].filter(Boolean);
  if (asks.length) {
    sections.push({
      key: 'asks',
      heading: C.asks,
      blocks: [
        { type: 'p', text: C.askLead },
        { type: 'checklist', items: [...new Set(asks)] },
      ],
      author: sign(town, 'chorus', used),
    });
  }

  sections.push({
    key: 'further',
    heading: C.further,
    blocks: [
      { type: 'p', text: C.furtherLead },
      { type: 'prompt', text: readingPrompt(text, read, en ? 'en' : 'zh') },
    ],
    author: sign(town, 'lattice', used),
  });

  return {
    title: brief.title || (en ? `Reading: ${read.type.en}` : `阅读：${read.type.zh}`),
    subtitle: en
      ? `${sources.length} document${sources.length === 1 ? '' : 's'} read · ${read.found.length} to watch · ${read.figures.length} figures`
      : `读了 ${sources.length} 份 · ${read.found.length} 处要注意 · ${read.figures.length} 个数字`,
    sections,
  };
}

DELIVERABLES.unshift({
  id: 'reading', emoji: '\u{1F50E}', en: 'Read my document', zh: '读我的文件',
  ctaEn: 'Ask the town to read it', ctaZh: '让小镇读这份文件', build: buildReading,
});
DELIVERABLE_BY_ID.reading = DELIVERABLES[0];
