#!/usr/bin/env node
// The town, from the command line.
//
//   node town/bin/town.js doctor                 看配置、模型、文件夹对不对
//   node town/bin/town.js agents [公会]          列出 66 位检查员
//   node town/bin/town.js review <文件> [选项]   评审一份文件，报告印在屏幕上
//   node town/bin/town.js run [选项]             处理整个收件夹
//   node town/bin/town.js sops                   重新生成 SOP 文件

import { writeFile, mkdir } from 'node:fs/promises';
import { basename, extname, join, resolve } from 'node:path';
import { loadConfig, ROOT } from '../core/config.js';
import { createModel, PRESETS } from '../core/llm.js';
import { createLocalDrive } from '../core/drive.js';
import { extractText } from '../core/extract.js';
import { review, reportMarkdown } from '../core/review.js';
import { runInbox } from '../core/pipeline.js';
import { guessTypeFromText, normaliseType } from '../core/classify.js';
import { AGENTS, GUILD_ROLES, DOC_TYPES, agentsForGuild, agentsForDocType } from '../core/agents.data.js';
import { RULE_IDS } from '../core/rules.js';
import { checklistMarkdown, recurringFor, drillCandidates, makeDrill } from '../core/learning.js';

function parseArgs(argv) {
  const flags = {}, rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const [k, v] = a.slice(2).split('=');
      if (v !== undefined) flags[k] = v;
      else if (argv[i + 1] && !argv[i + 1].startsWith('--')) flags[k] = argv[++i];
      else flags[k] = true;
    } else rest.push(a);
  }
  return { flags, rest };
}

const list = v => (!v ? [] : Array.isArray(v) ? v : String(v).split(',').map(s => s.trim()).filter(Boolean));

async function build(flags) {
  const cfg = await loadConfig(flags.config ? resolve(flags.config) : undefined);
  if (flags.preset) cfg.model.preset = flags.preset;
  if (flags.model) cfg.model.model = flags.model;
  if (flags.inbox) cfg.drive.inbox = resolve(flags.inbox);
  if (flags.library) cfg.drive.library = resolve(flags.library);
  if (flags.reports) cfg.drive.reports = resolve(flags.reports);

  const model = (cfg.model.preset || process.env.TOWN_PRESET || process.env.TOWN_PROVIDER)
    ? createModel(cfg.model)
    : null;
  const drive = createLocalDrive(cfg.drive);
  return { cfg, model, drive };
}

const CMDS = {
  async doctor(flags) {
    const { cfg, model, drive } = await build(flags);
    const engines = AGENTS.reduce((a, x) => { a[x.engine] = (a[x.engine] || 0) + 1; return a; }, {});
    console.log('小镇体检');
    console.log('='.repeat(56));
    console.log(`公司      ${cfg.company || '（未设定）'}`);
    console.log(`配置文件  ${cfg.configPath}`);
    console.log('');
    console.log('模型');
    console.log(`  现在用  ${model ? model.describe() : '没有接模型 — 只跑规则层（免费，仍能查 ' + engines.rule + ' 项）'}`);
    console.log(`  可选    ${Object.keys(PRESETS).join(' / ')}`);
    console.log(`  怎么换  TOWN_PRESET=deepseek TOWN_API_KEY=sk-... node town/bin/town.js run`);
    console.log('');
    console.log('文件夹');
    console.log(drive.describe().split('\n').map(l => '  ' + l).join('\n'));
    await drive.ensure();
    const inbox = await drive.listInbox();
    const state = await drive.readState();
    const seen = Object.keys(state.seen || {}).length;
    const pending = inbox.filter(f => !state.seen?.[f.key]).length;
    console.log(`  收件夹里 ${inbox.length} 个文件，其中 ${pending} 个还没处理（已处理过 ${seen} 个）`);
    console.log('');
    console.log('检查员');
    console.log(`  共 ${AGENTS.length} 位 · 规则层 ${engines.rule} · 规则+模型 ${engines.hybrid} · 模型层 ${engines.llm}`);
    console.log(`  规则 ${RULE_IDS.length} 条：${RULE_IDS.join(', ')}`);
    for (const t of DOC_TYPES) {
      console.log(`  ${t.zh.padEnd(4)} 会叫到 ${String(agentsForDocType(t.id).length).padStart(2)} 位`);
    }
  },

  async agents(flags, rest) {
    const guild = rest[0];
    if (flags.json) {
      const picked = guild ? agentsForGuild(guild) : AGENTS;
      console.log(JSON.stringify(picked, null, 2));
      return;
    }
    const guilds = guild ? [guild] : Object.keys(GUILD_ROLES);
    for (const g of guilds) {
      const role = GUILD_ROLES[g];
      if (!role) { console.error(`没有 ${g} 这个公会。有：${Object.keys(GUILD_ROLES).join(', ')}`); process.exitCode = 1; return; }
      console.log(`\n${role.zh}（${g}）— ${role.duty}`);
      for (const a of agentsForGuild(g)) {
        const layer = a.engine === 'rule' ? '规则' : a.engine === 'hybrid' ? '规则+模型' : '模型';
        console.log(`  ${a.name.padEnd(10)} ${a.title.padEnd(12)} [${layer}] ${a.duty}`);
        console.log(`  ${''.padEnd(10)} SOP: town/agents/${g}/${a.id}.md`);
      }
    }
  },

  async review(flags, rest) {
    const target = rest[0];
    if (!target) { console.error('用法：node town/bin/town.js review <文件> [--type proposal] [--project 名字] [--author 名字] [--out 目录]'); process.exitCode = 1; return; }
    const { cfg, model } = await build(flags);

    const doc = await extractText(resolve(target));
    if (!doc.ok) console.error(`读不出内容：${doc.reason}\n（规则层和模型层都会跳过需要文字的检查）\n`);

    const type = normaliseType(flags.type) || guessTypeFromText(doc.text, doc.ext);
    const name = basename(target);
    console.error(`评审 ${name}｜类型 ${DOC_TYPES.find(t => t.id === type)?.zh || type}｜模型 ${model ? model.describe() : '未接（只跑规则层）'}`);

    let done = 0;
    const total = agentsForDocType(type).length;
    const result = await review(
      { name, type, text: doc.text, project: flags.project || null, author: flags.author || null, note: flags.note || null,
        visual: doc.visual || false, image: doc.image || null, readError: doc.ok ? null : doc.reason },
      model,
      { concurrency: Number(flags.concurrency) || cfg.review.concurrency,
        only: list(flags.only).length ? list(flags.only) : cfg.review.only,
        skip: list(flags.skip).length ? list(flags.skip) : cfg.review.skip,
        onProgress: () => { done++; if (process.stderr.isTTY) process.stderr.write(`\r  ${done}/${total} …   `); } });
    if (process.stderr.isTTY) process.stderr.write('\r' + ' '.repeat(24) + '\r');

    const md = reportMarkdown(result);
    if (flags.json) { console.log(JSON.stringify(result, null, 2)); return; }
    if (flags.out) {
      const dir = resolve(flags.out);
      await mkdir(dir, { recursive: true });
      const out = join(dir, `${basename(name, extname(name))}.评审.md`);
      await writeFile(out, md, 'utf8');
      console.error(`报告写到 ${out}`);
    } else {
      console.log(md);
    }
    if (result.status === 'needs-work') process.exitCode = 2;
  },

  async run(flags) {
    const { cfg, model, drive } = await build(flags);
    console.log(`模型 ${model ? model.describe() : '未接（只跑规则层，免费）'}`);
    console.log(drive.describe());
    console.log('');

    const summary = await runInbox({
      drive, model,
      manifestPath: flags.manifest ? resolve(flags.manifest) : cfg.drive.manifest,
      move: flags.move === true || flags.move === '1' || cfg.drive.move,
      force: !!flags.force,
      limit: Number(flags.limit) || 0,
      reviewOpts: { concurrency: Number(flags.concurrency) || cfg.review.concurrency, only: cfg.review.only, skip: cfg.review.skip },
      onItem: ev => {
        if (!ev.ok) { console.log(`  失败  ${ev.file.name} — ${ev.error}`); return; }
        const o = ev.outcome;
        const mark = { 'needs-work': '不过', review: '留意', ok: '通过' }[o.result.status];
        console.log(`  ${mark}  ${o.meta.project}/${o.meta.typeZh}/${o.meta.filename}`);
        console.log(`        不过 ${o.result.tally.fail || 0} · 留意 ${o.result.tally.flag || 0} · 报告 ${o.report.rel}`);
        if (!o.doc.ok) console.log(`        读不出文字：${o.doc.reason}`);
        if (o.meta.guessed.length) console.log(`        自动判断：${o.meta.guessed.join('、')}`);
      },
    });

    console.log('');
    console.log(`扫到 ${summary.scanned} 个，处理 ${summary.done.length} 个，跳过 ${summary.skipped} 个（处理过了），失败 ${summary.failed.length} 个`);
    console.log(`清单：${summary.indexPath}（${summary.rows} 行）`);
    if (summary.failed.length) process.exitCode = 1;
  },

  async checklist(flags) {
    const { drive, cfg } = await build(flags);
    const author = flags.author || null;
    const type = normaliseType(flags.type);

    // A personal checklist: one type, one person, their recurring misses first.
    if (author) {
      if (!type) { console.error('个人清单要指定类型：--type proposal'); process.exitCode = 1; return; }
      const state = await drive.readState();
      const { weak, submissions } = recurringFor(state, author);
      const md = checklistMarkdown(type, { author, weak });
      if (flags.out) {
        const dir = resolve(flags.out);
        await mkdir(dir, { recursive: true });
        const out = join(dir, `自检清单_${DOC_TYPES.find(t => t.id === type).zh}_${author}.md`);
        await writeFile(out, md + '\n', 'utf8');
        console.error(`写到 ${out}`);
      } else console.log(md);
      console.error(`（根据 ${author} 过去 ${submissions} 份作品，老毛病 ${weak.length} 项）`);
      return;
    }

    // The general set: one checklist per type, into the library.
    const dir = flags.out ? resolve(flags.out) : join(cfg.drive.library, '_自检清单');
    await mkdir(dir, { recursive: true });
    const types = type ? [type] : DOC_TYPES.map(t => t.id);
    for (const t of types) {
      const out = join(dir, `${DOC_TYPES.find(x => x.id === t).zh}.md`);
      await writeFile(out, checklistMarkdown(t) + '\n', 'utf8');
      console.log(`  ${out}`);
    }
    console.log(`写了 ${types.length} 份通用自检清单。给某个人的：--author 名字 --type 类型`);
  },

  async drill(flags, rest) {
    const { drive, cfg } = await build(flags);
    const state = await drive.readState();
    const pick = rest[0];

    if (!pick) {
      const list = drillCandidates(state);
      if (!list.length) { console.log('还没有适合做练习的作品（要已评审、读得出文字、至少两项问题）。'); return; }
      console.log('可以拿来做找茬练习的作品（问题越多越适合）：\n');
      for (const [i, s] of list.slice(0, 20).entries()) {
        console.log(`  ${String(i + 1).padStart(2)}. ${s.filed}`);
        console.log(`      不过 ${s.fail} · 留意 ${s.flag} · ${s.type}`);
      }
      console.log('\n选一份：node town/bin/town.js drill <编号或路径>');
      console.log('优先选外部伙伴的文件，或作者本人同意拿来练习的——文件内容本身可能看得出是谁写的。');
      return;
    }

    const list = drillCandidates(state);
    const entry = /^\d+$/.test(pick)
      ? list[Number(pick) - 1]
      : Object.values(state.seen || {}).find(s => s.filed === pick || s.filed.endsWith(pick));
    if (!entry) { console.error(`找不到 ${pick}。先跑 drill 不带参数看清单。`); process.exitCode = 1; return; }

    const made = await makeDrill({
      library: cfg.drive.library, reportsRoot: cfg.drive.reports, entry,
      outRoot: flags.out ? resolve(flags.out) : null,
    });
    console.log(`练习题做好了：${made.dir}`);
    console.log('  1_题目          给新人读的作品（改过名）');
    console.log('  2_怎么做.md     练习说明');
    console.log('  3_答案_做完再打开.md   系统的报告，已去掉提交人');
  },

  async sops() {
    await import('../tools/write-sops.js');
  },

  help() {
    console.log(`小镇 — 公司作品提交与评审系统

  node town/bin/town.js doctor                   看配置、模型、文件夹
  node town/bin/town.js agents [公会] [--json]   列出 66 位检查员
  node town/bin/town.js review <文件> [选项]     评审一份文件
  node town/bin/town.js run [选项]               处理整个收件夹
  node town/bin/town.js sops                     重新生成 SOP
  node town/bin/town.js checklist [选项]         交件前自检清单
  node town/bin/town.js drill [编号]             新人找茬练习

checklist 的选项
  不带参数                   每种类型一份通用清单，写进 档案库/_自检清单/
  --author 张三 --type proposal   给张三的个人清单，他的老毛病排最前面

review 的选项
  --type proposal|contract|design|report|copy|other   不给就看内容猜
  --project <名字>  --author <名字>  --note <一句话>
  --only lumen,ledger        只跑这些公会或检查员
  --skip chorus              跳过这些
  --out <目录>               写成文件而不是印出来
  --json                     输出 JSON

run 的选项
  --force      已处理过的也重跑
  --limit N    这次只处理 N 个
  --move       把文件从收件夹搬走（默认是复制，不动原件）
  --manifest <csv>   Google 表单回应导出的 CSV

换模型（环境变量永远优先）
  TOWN_PRESET=claude     TOWN_API_KEY=sk-ant-...
  TOWN_PRESET=deepseek   TOWN_API_KEY=sk-...
  TOWN_PRESET=ollama     TOWN_MODEL=qwen2.5:14b      # 自己机器上跑，不花钱
  不设 = 只跑规则层，免费，仍然查 11 项

文件夹（指向 Google Drive 桌面版同步下来的目录）
  TOWN_INBOX=...   TOWN_LIBRARY=...   TOWN_REPORTS=...`);
  },
};

const { flags, rest } = parseArgs(process.argv.slice(2));
const cmd = rest.shift() || 'help';
const fn = CMDS[cmd] || CMDS.help;
try {
  await fn(flags, rest);
} catch (err) {
  console.error(`出错了：${err.message}`);
  if (flags.debug) console.error(err.stack);
  process.exitCode = 1;
}
