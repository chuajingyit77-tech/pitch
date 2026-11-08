// Learning, phase one: turn reviews that already happen into a loop that
// teaches.
//
//   checklist  what to tick before submitting -- the checks a person can
//              settle themselves, with that person's recurring misses first
//   recurring  "老毛病": the checks this person has failed repeatedly and
//              not yet put behind them (spaced repetition: a miss keeps
//              coming back until it has been passed three times running)
//   drill      a reviewed document with its report hidden, for a newcomer to
//              find the problems first and compare after
//
// Two decisions the company made shape all of it:
//   1. none of these numbers is used for performance appraisal
//   2. a person's history is shown only to that person and the reviewer --
//      nothing here ever puts one person's record into another's report

import { mkdir, writeFile, copyFile, readFile, stat } from 'node:fs/promises';
import { join, extname, basename, resolve, relative } from 'node:path';
import { AGENT_BY_ID, GUILD_ROLES, DOC_TYPES, agentsForDocType } from './agents.data.js';
import { slug } from './classify.js';

export const RECURRING = { window: 5, minFails: 2, clearAfter: 3 };

// Authors the system could not identify are many people, not one: never
// build a history for them.
const ANONYMOUS = new Set(['未署名', '', null, undefined]);

const JUDGED = new Set(['pass', 'flag', 'fail']);
const typeZh = id => DOC_TYPES.find(t => t.id === id)?.zh || id;

// One person's past submissions, oldest first.
export function historyOf(state, author) {
  if (ANONYMOUS.has(author)) return [];
  return Object.values(state?.seen || {})
    .filter(s => s.author === author && s.verdicts)
    .sort((a, b) => String(a.at).localeCompare(String(b.at)));
}

/**
 * The checks this person keeps missing.
 * A check is recurring when it failed at least `minFails` times in the
 * person's last `window` judged attempts at it, and the person has not since
 * passed it `clearAfter` times in a row. A check that used to be recurring
 * and is now cleared is reported separately, because seeing progress is
 * what keeps people going.
 */
export function recurringFor(state, author, opts = {}) {
  const { window, minFails, clearAfter } = { ...RECURRING, ...opts };
  const past = historyOf(state, author);
  const seq = new Map();
  for (const s of past) {
    for (const [agent, verdict] of Object.entries(s.verdicts)) {
      if (!JUDGED.has(verdict) || !AGENT_BY_ID.has(agent)) continue;
      if (!seq.has(agent)) seq.set(agent, []);
      seq.get(agent).push(verdict);
    }
  }

  const weak = [], cleared = [];
  for (const [agent, verdicts] of seq) {
    let streak = 0;
    for (let i = verdicts.length - 1; i >= 0 && verdicts[i] === 'pass'; i--) streak++;
    const recent = verdicts.slice(-window);
    const recentFails = recent.filter(v => v === 'fail').length;
    const everFails = verdicts.filter(v => v === 'fail').length;
    const a = AGENT_BY_ID.get(agent);
    const row = { agent, name: a.name, title: a.title, guild: a.guild, duty: a.duty, ask: a.ask,
      fails: recentFails, of: recent.length, streak };
    if (streak >= clearAfter) {
      if (everFails >= minFails) cleared.push({ ...row, fails: everFails, of: verdicts.length });
    } else if (recentFails >= minFails) {
      weak.push(row);
    }
  }
  weak.sort((x, y) => y.fails - x.fails || x.streak - y.streak || x.agent.localeCompare(y.agent));
  cleared.sort((x, y) => y.fails - x.fails || x.agent.localeCompare(y.agent));
  return { weak, cleared, submissions: past.length };
}

/**
 * The pre-submission checklist for a document type.
 * Only checks a person can settle by looking -- the rule and rule+model
 * ones -- plus any of this person's recurring misses, whatever their layer.
 */
export function checklistFor(type, weak = []) {
  const weakIds = new Set(weak.map(w => w.agent));
  const base = agentsForDocType(type).filter(a => a.engine !== 'llm' || weakIds.has(a.id));
  const items = base.map(a => {
    const w = weak.find(x => x.agent === a.id);
    return {
      agent: a.id, name: a.name, title: a.title, guild: a.guild,
      question: a.ask, why: a.duty,
      weak: !!w, note: w ? `你最近 ${w.of} 次里有 ${w.fails} 次漏了这一项` : '',
    };
  });
  // Recurring misses first; everything else keeps the roster's order.
  return [...items.filter(i => i.weak), ...items.filter(i => !i.weak)];
}

export function checklistMarkdown(type, { author = null, weak = [] } = {}) {
  const items = checklistFor(type, weak);
  const L = [];
  L.push(`# 交件前自检 · ${typeZh(type)}`);
  L.push('');
  L.push(author && weak.length
    ? `${author}，交之前花两分钟，自己先勾一遍。最上面${weak.length > 1 ? '几项' : '一项'}是你最近常漏的。`
    : '交之前花两分钟，自己先勾一遍。这些都是系统一定会查、而且你自己就看得出来的事。');
  L.push('');
  for (const i of items) {
    L.push(`- [ ] **${i.question}**${i.weak ? `  ⚠ ${i.note}` : ''}`);
    L.push(`  ${i.why}（${i.name} · ${GUILD_ROLES[i.guild].zh}）`);
  }
  L.push('');
  L.push('---');
  L.push('');
  L.push('**最后一题：** 你估计这份交上去，会有几项「不过」？写在表单的说明里，例如「自估 2 项」。');
  L.push('');
  L.push('报告出来后对一下。估得越来越准，说明你心里已经有那把尺了。');
  L.push('');
  L.push('*这份清单不打分，也不会用在考绩上。*');
  return L.join('\n');
}

/**
 * The block at the top of a report that speaks to this person's own
 * recurring misses: did they get it right this time?
 */
export function recurringSection(weak, entries) {
  if (!weak?.length) return '';
  const byAgent = new Map(entries.map(e => [e.agent, e]));
  const L = ['## 你的老毛病，这次怎样', ''];
  let fixed = 0;
  for (const w of weak) {
    const e = byAgent.get(w.agent);
    const v = e?.verdict;
    const mark = v === 'pass' ? '✓ 这次过了' : v === 'fail' ? '✗ 又出现了' : v === 'flag' ? '△ 还要留意' : '— 这次没查到这一项';
    if (v === 'pass') fixed++;
    L.push(`- **${w.title}**（${w.name}）：${mark}`);
    L.push(`  最近 ${w.of} 次里漏了 ${w.fails} 次。${w.duty}`);
  }
  L.push('');
  if (fixed === weak.length) L.push('全部过了。再连续过两三次，这几项就会从你的清单最上面退下来。', '');
  else if (fixed) L.push(`${fixed}/${weak.length} 项这次过了。`, '');
  L.push('*这一段只有你和复核人看得到，不用在考绩上。*');
  L.push('');
  return L.join('\n');
}

// ----------------------------------------------------------------- drills

// Remove what would tell a trainee whose work this is.
export function scrubAnswer(markdown, { author, filename }) {
  let md = markdown
    .split('\n')
    .filter(l => !/^- 提交人：/.test(l))
    .filter(l => !/^> \*\*自动判断的部分/.test(l))
    .filter(l => !/^## 你的老毛病/.test(l))
    .join('\n');
  // The personal block runs until the next heading; drop it whole.
  md = md.replace(/## 你的老毛病，这次怎样[\s\S]*?(?=\n## |\n# |$)/, '');
  if (filename) md = md.split(filename).join('练习题' + extname(filename));
  if (author && !ANONYMOUS.has(author)) md = md.split(author).join('（作者）');
  return md.replace(/^# 评审报告：.*$/m, '# 答案：系统的评审报告');
}

export function drillCandidates(state) {
  return Object.values(state?.seen || {})
    .filter(s => s.readOk && (s.fail || 0) + (s.flag || 0) >= 2 && s.report)
    .sort((a, b) => (b.fail - a.fail) || (b.flag - a.flag));
}

/**
 * Make a drill from a reviewed submission.
 * The question folder holds the document under a neutral name, how to do
 * the drill, and the answer -- named so nobody opens it by accident.
 */
export async function makeDrill({ library, reportsRoot = null, entry, outRoot = null }) {
  const src = join(library, entry.filed);
  const reportPath = join(reportsRoot || library, entry.report);
  const answer = scrubAnswer(await readFile(reportPath, 'utf8'), {
    author: entry.author, filename: basename(entry.filed),
  });

  const stamp = new Date().toISOString().slice(0, 10);
  const root = resolve(outRoot || join(library, '_练习'));
  const base = `${stamp}_${slug(entry.type || '练习', 12)}`;
  const exists = p => stat(p).then(() => true, () => false);
  let dir = join(root, base);
  for (let n = 2; await exists(dir); n++) dir = join(root, `${base}-${n}`);
  if (!resolve(dir).startsWith(root)) throw new Error('练习目录超出范围');
  await mkdir(dir, { recursive: true });

  const ext = extname(entry.filed);
  const question = join(dir, `1_题目${ext}`);
  await copyFile(src, question);
  await writeFile(join(dir, '2_怎么做.md'), [
    '# 找茬练习',
    '',
    `这是一份真实交过的${entry.type || '作品'}。系统已经评审过它，答案在同一个文件夹里，**先别打开**。`,
    '',
    '1. 读 `1_题目`，像你是复核人一样读',
    '2. 写下你找到的每一个问题：哪里有问题、为什么是问题、应该怎么改',
    '3. 写完再打开 `3_答案_做完再打开.md`，对照：',
    '   - 你找到了几项？漏了哪几项？',
    '   - 有没有你找到、但系统没找到的？**这一种最有价值**，告诉复核人——它可能是下一条该加的检查',
    '',
    '这个练习不打分，做得好不好只有你和复核人知道。',
  ].join('\n') + '\n', 'utf8');
  await writeFile(join(dir, '3_答案_做完再打开.md'), answer, 'utf8');
  return { dir, question, rel: relative(library, dir) };
}
