#!/usr/bin/env node
// Write one readable SOP per agent, from the roster in core/agents.data.js.
// Run: node town/tools/write-sops.js
//
// The SOPs are generated so they can never disagree with the code that runs.
// Edit the roster, re-run this, commit both.

import { mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { AGENTS, GUILD_ROLES, DOC_TYPES, agentsForGuild } from '../core/agents.data.js';
import { systemPrompt, userPrompt } from '../core/review.js';
import { ROOT } from '../core/config.js';

const OUT = join(ROOT, 'town', 'agents');
const typeZh = id => DOC_TYPES.find(t => t.id === id)?.zh || id;

const ENGINE_NOTE = {
  rule:   '**规则层** — 不用模型，不花钱，每次结果一样。换模型不影响这一项。',
  llm:    '**模型层** — 需要一个模型。换便宜的模型会影响判断深度，但不影响它查什么。',
  hybrid: '**规则 + 模型** — 先用规则定位，规则定不了的才问模型。规则能定的时候完全不花钱。',
};

function sopFor(agent) {
  const role = GUILD_ROLES[agent.guild];
  const sample = {
    name: '2026-11-06_张三_门店设计提案.pdf',
    type: agent.applies[0],
    text: '（这里放文件的文字内容）',
    project: '门店扩张',
    author: '张三',
    note: '第一版，想先确认方向',
  };

  return [
    `# ${agent.name} · ${agent.title}`,
    '',
    `| | |`,
    `| --- | --- |`,
    `| 公会 | ${role.zh}（${agent.guild}） |`,
    `| 岗位 | ${agent.title} |`,
    `| 编号 | \`${agent.id}\` |`,
    `| 跑在哪一层 | ${agent.engine === 'rule' ? '规则层' : agent.engine === 'hybrid' ? '规则 + 模型' : '模型层'}${agent.ruleId ? `（规则 \`${agent.ruleId}\`）` : ''} |`,
    `| 看哪些文件 | ${agent.applies.map(typeZh).join('、')} |`,
    '',
    '## 一句话职责',
    '',
    `> ${agent.duty}`,
    '',
    '## 什么时候轮到我',
    '',
    `有人交上来一份**${agent.applies.map(typeZh).join('或')}**的时候。其他类型的文件不经过我。`,
    '',
    ENGINE_NOTE[agent.engine],
    '',
    '## 我要查的一件事',
    '',
    agent.ask,
    '',
    '## 怎么查（照这个顺序做）',
    '',
    ...agent.criteria.map((c, i) => `${i + 1}. ${c}`),
    '',
    '## 判定标准',
    '',
    '| 结果 | 什么情况给这个结果 |',
    '| --- | --- |',
    `| \`pass\` 通过 | ${agent.verdicts.pass} |`,
    `| \`flag\` 留意 | ${agent.verdicts.flag} |`,
    `| \`fail\` 不过 | ${agent.verdicts.fail} |`,
    `| \`skip\` 未跑 | 这份文件里没有我能判断的内容。老实说没有，不假装通过。 |`,
    '',
    '## 我不做的事',
    '',
    ...agent.out.map(o => `- ${o}`),
    '',
    '不越界的理由很简单：一个人管一件事，报告才看得出来是哪里出了问题。',
    '',
    '## 我交出什么',
    '',
    '```json',
    JSON.stringify({
      verdict: 'pass|flag|fail',
      finding: '一两句话说发现了什么',
      evidence: '原文照抄的那一句（找不到就留空）',
      severity: 'low|medium|high',
      ask: '要对方改什么或补什么，一句话',
    }, null, 2),
    '```',
    '',
    'evidence 必须是原文照抄。系统会拿它回原文比对，对不上就把这段引用删掉——这样报告里的引号永远可信。',
    '',
    '## 完整提示词',
    '',
    '换成任何模型都用这一套。先给系统提示，再给用户提示。',
    '',
    '**系统提示**',
    '',
    '```text',
    systemPrompt(agent),
    '```',
    '',
    '**用户提示**',
    '',
    '```text',
    userPrompt(agent, sample),
    '```',
    '',
    '---',
    '',
    `*这份 SOP 由 \`town/tools/write-sops.js\` 从 \`town/core/agents.data.js\` 生成。要改内容，改 roster 后重新生成，不要直接改这个文件。*`,
  ].join('\n');
}

function rosterIndex() {
  const L = [];
  L.push('# 镇上的 66 位检查员');
  L.push('');
  L.push('每一位只做一件事。一份文件交进来，按它的类型挑出该看的人，每人给一条结论。');
  L.push('');
  const byEngine = AGENTS.reduce((a, x) => { a[x.engine] = (a[x.engine] || 0) + 1; return a; }, {});
  L.push(`- 规则层 ${byEngine.rule || 0} 位：不用模型，不花钱`);
  L.push(`- 规则+模型 ${byEngine.hybrid || 0} 位：规则定不了才问模型`);
  L.push(`- 模型层 ${byEngine.llm || 0} 位：需要模型`);
  L.push('');
  L.push('换模型只影响模型层的判断深度，不影响谁查什么、查几项。这是这套系统能换便宜模型的原因。');
  L.push('');

  for (const [guild, role] of Object.entries(GUILD_ROLES)) {
    L.push(`## ${role.zh}（${guild}）`);
    L.push('');
    L.push(`${role.duty}`);
    L.push('');
    L.push('| 检查员 | 岗位 | 查什么 | 层 | 看哪些文件 |');
    L.push('| --- | --- | --- | --- | --- |');
    for (const a of agentsForGuild(guild)) {
      const layer = a.engine === 'rule' ? '规则' : a.engine === 'hybrid' ? '规则+模型' : '模型';
      L.push(`| [${a.name}](${guild}/${a.id}.md) | ${a.title} | ${a.duty} | ${layer} | ${a.applies.map(typeZh).join('、')} |`);
    }
    L.push('');
  }
  L.push('---');
  L.push('');
  L.push('*本页与各位的 SOP 由 `node town/tools/write-sops.js` 生成。*');
  return L.join('\n');
}

const guilds = [...new Set(AGENTS.map(a => a.guild))];
await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });
for (const g of guilds) await mkdir(join(OUT, g), { recursive: true });

let n = 0;
for (const agent of AGENTS) {
  await writeFile(join(OUT, agent.guild, `${agent.id}.md`), sopFor(agent) + '\n', 'utf8');
  n++;
}
await writeFile(join(OUT, 'README.md'), rosterIndex() + '\n', 'utf8');
console.log(`写了 ${n} 份 SOP + 1 份名册 -> town/agents/`);
