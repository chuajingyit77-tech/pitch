#!/usr/bin/env node
// One command that checks a change before it is called done.
//
//   node verification/verify.mjs                 check what changed (uncommitted work; if none, the last commit)
//   node verification/verify.mjs --since <ref>   check everything changed since a commit or branch
//   node verification/verify.mjs --all           run every recipe
//   node verification/verify.mjs --list          show what would run, run nothing
//   node verification/verify.mjs --skip "<why>"  record that this change is not verified, and why
//
// It runs the cheap checks of every area the change touches (verification/recipes.json), lists the reliability
// checklist items the change triggers (verification/checklist.md), and writes a stamp tied to the exact state
// of the files. Recipes and checklist are read from the last commit, so a change cannot rewrite its own checks.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { changedBetween, git, matchesAny, parseChecklist, readRule, repoRoot, snapshotTree, uncommitted, writeStamp } from './lib.mjs';

// Paths that need no automatic check: prose. Rule files are prose too, but they have a recipe of their own.
const DOCS = ['**/*.md', '**/*.txt', 'LICENSE', '.gitignore', '**/.gitignore'];

export function parseArgs(argv) {
  const opts = { all: false, list: false, since: null, skip: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--all') opts.all = true;
    else if (a === '--list') opts.list = true;
    else if (a === '--since') opts.since = argv[++i] || '';
    else if (a === '--skip') opts.skip = argv[++i] || '';
    else if (a === '-h' || a === '--help') opts.help = true;
    else throw new Error(`不认识的参数：${a}`);
  }
  if (opts.since === '') throw new Error('--since 后面要跟一个提交或分支，例如 --since origin/main');
  if (opts.skip === '') throw new Error('--skip 后面要写明原因，例如 --skip "只改了注释"');
  return opts;
}

/** Which files does this run judge, and how is that scope described? */
export function changeScope(root, opts) {
  const dirty = uncommitted(root);
  if (opts.since) return { files: [...new Set([...changedBetween(root, opts.since), ...dirty])], label: `自 ${opts.since} 以来的改动` };
  if (dirty.length) return { files: dirty, label: '还没提交的改动' };
  const hasParent = git(['rev-parse', '--verify', '-q', 'HEAD~1'], { cwd: root, allowFail: true });
  if (hasParent) return { files: changedBetween(root, 'HEAD~1'), label: '最近一次提交（工作区没有未提交的改动）' };
  return { files: [], label: '没有改动' };
}

/** Split the changed files into the recipes that cover them, prose that needs no check, and files nothing covers. */
export function plan(files, recipes, { all = false } = {}) {
  const matched = recipes.filter((r) => all || files.some((f) => matchesAny(f, r.paths)));
  const covered = (f) => recipes.some((r) => matchesAny(f, r.paths));
  const uncovered = files.filter((f) => !covered(f) && !matchesAny(f, DOCS));
  return { matched, uncovered };
}

const tail = (text, n) => String(text || '').trimEnd().split('\n').slice(-n).join('\n');

function counts(output) {
  const pass = /^# pass (\d+)/m.exec(output);
  const fail = /^# fail (\d+)/m.exec(output);
  if (pass) return fail && fail[1] !== '0' ? `${pass[1]} 通过，${fail[1]} 失败` : `${pass[1]} 项通过`;
  const py = /(\d+) passed/.exec(output);
  return py ? `${py[1]} 项通过` : '';
}

function sh(command, cwd, timeoutS) {
  const started = Date.now();
  const r = spawnSync(command, { cwd, shell: true, encoding: 'utf8', timeout: (timeoutS || 600) * 1000, maxBuffer: 64 * 1024 * 1024, env: { ...process.env, CI: '1' } });
  const output = `${r.stdout || ''}${r.stderr || ''}`;
  return { pass: r.status === 0, code: r.status, timedOut: r.error?.code === 'ETIMEDOUT', output, ms: Date.now() - started };
}

export function runRecipe(root, recipe, log) {
  const cwd = path.join(root, recipe.cwd || '.');
  const results = [];
  if (!fs.existsSync(cwd)) return [{ recipe: recipe.id, label: '目录不存在', pass: false, detail: `${recipe.cwd} 不在这个分支上`, ms: 0 }];
  const prep = recipe.prepare;
  if (prep && !fs.existsSync(path.join(cwd, prep.when_missing))) {
    log(`  … ${recipe.id} · 准备环境：${prep.run}`);
    const r = sh(prep.run, cwd, prep.timeout_s);
    if (!r.pass) return [{ recipe: recipe.id, label: `准备环境：${prep.run}`, pass: false, detail: tail(r.output, 15), ms: r.ms }];
  }
  for (const check of recipe.checks || []) {
    const r = sh(check.run, cwd, check.timeout_s);
    results.push({
      recipe: recipe.id,
      label: check.label || check.run,
      pass: r.pass,
      summary: r.pass ? counts(r.output) : r.timedOut ? '超时' : `退出码 ${r.code}`,
      detail: r.pass ? '' : tail(r.output, 20),
      ms: r.ms,
    });
  }
  return results;
}

export function trailer(stamp) {
  if (stamp.status === 'none') return `Verified: none (${stamp.reason})`;
  const parts = stamp.checks.map((c) => `${c.recipe} ${c.label} ${c.pass ? '✓' : '✗'}${c.pass && c.summary ? ` (${c.summary})` : ''}`);
  if (stamp.uncovered.length) parts.push(`无自动检查：${stamp.uncovered.slice(0, 4).join(', ')}${stamp.uncovered.length > 4 ? ' 等' : ''}（写明你实际怎么验证的）`);
  if (!parts.length) return 'Verified: not needed (只改了文档)';
  return `Verified: ${parts.join(' · ')}`;
}

export function main(argv, { cwd = process.cwd(), log = console.log } = {}) {
  const opts = parseArgs(argv);
  if (opts.help) {
    log(fs.readFileSync(new URL(import.meta.url), 'utf8').split('\n').slice(1, 9).map((l) => l.replace(/^\/\/ ?/, '')).join('\n'));
    return 0;
  }
  const root = repoRoot(cwd);
  const scope = changeScope(root, opts);

  if (opts.skip !== null) {
    const stamp = { status: 'none', reason: opts.skip.trim(), tree: snapshotTree(root), at: new Date().toISOString(), checks: [], uncovered: [], checklist: [] };
    writeStamp(root, stamp);
    log(`已记录：这次改动没有验证。原因：${stamp.reason}`);
    log(`\n提交信息的最后加这一行：\n${trailer(stamp)}`);
    return 0;
  }

  const recipesRule = readRule(root, 'verification/recipes.json');
  const checklistRule = readRule(root, 'verification/checklist.md');
  if (!recipesRule.text) throw new Error('找不到 verification/recipes.json。');
  const recipes = JSON.parse(recipesRule.text).recipes || [];
  const { matched, uncovered } = plan(scope.files, recipes, opts);
  const triggered = parseChecklist(checklistRule.text).filter((item) => scope.files.some((f) => matchesAny(f, item.triggers)));

  log(`验收 · ${scope.label} · ${scope.files.length} 个文件`);
  log(`规则取自：${recipesRule.from === 'working copy' ? '工作区（规则还没有提交过，提交后才不会被改动影响）' : `${recipesRule.from}（已提交的版本；这次改动里对规则的修改不生效）`}`);
  if (!scope.files.length && !opts.all) {
    log('\n没有需要验收的改动。');
    return 0;
  }

  if (opts.list) {
    log(`\n会运行的检查：${matched.length ? '' : '无'}`);
    for (const r of matched) for (const c of r.checks || []) log(`  ${r.id} · ${c.label || c.run}`);
  } else {
    log('\n检查');
  }
  const checks = [];
  if (!opts.list) {
    for (const recipe of matched) {
      for (const r of runRecipe(root, recipe, log)) {
        checks.push(r);
        log(`  ${r.pass ? '✓' : '✗'} ${r.recipe} · ${r.label}${r.summary ? `   ${r.summary}` : ''} · ${(r.ms / 1000).toFixed(1)}s`);
        if (!r.pass && r.detail) log(r.detail.split('\n').map((l) => `      ${l}`).join('\n'));
      }
    }
    if (!matched.length) log('  （这次改动没有对应的自动检查）');
  }

  if (uncovered.length) {
    log(`\n没有自动检查的文件（${uncovered.length} 个）：要实际运行一遍，并在提交信息里写明你是怎么验证的`);
    for (const f of uncovered.slice(0, 12)) log(`  ${f}`);
    if (uncovered.length > 12) log(`  … 还有 ${uncovered.length - 12} 个`);
  }
  if (triggered.length) {
    log(`\n这次改动触发的可靠性清单（${triggered.length} 项）：逐项确认，并在交付说明里各写一句结论`);
    for (const item of triggered) log(`  ${item.id} ${item.title}\n     ${item.check}`);
  }
  if (opts.list) return 0;

  const failed = checks.filter((c) => !c.pass);
  // "manual": nothing automatic covers this change, so the evidence has to come from actually running it.
  const stamp = {
    status: failed.length ? 'fail' : !checks.length && uncovered.length ? 'manual' : 'pass',
    tree: snapshotTree(root),
    at: new Date().toISOString(),
    scope: scope.label,
    rulesFrom: recipesRule.from,
    checks: checks.map(({ recipe, label, pass, summary, ms }) => ({ recipe, label, pass, summary, ms })),
    uncovered,
    checklist: triggered.map((i) => i.id),
  };
  writeStamp(root, stamp);

  if (failed.length) {
    log(`\n结果：没有通过（${failed.length} 项检查失败）。修好原因再跑一遍；同一项连续 3 轮不过就停下来，把情况交给人决定。`);
    return 1;
  }
  if (stamp.status === 'manual') log('\n结果：这次改动没有自动检查可跑。按 verify 技能把它实际运行一遍，看到结果再说完成。');
  else log('\n结果：通过。这个结果只对文件现在的状态有效，再改动就要重跑。');
  log(`提交信息的最后加这一行：\n${trailer(stamp)}`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href) {
  try {
    process.exit(main(process.argv.slice(2)));
  } catch (e) {
    console.error(`verify: ${e.message}`);
    process.exit(2);
  }
}
