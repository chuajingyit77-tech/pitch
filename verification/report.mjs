#!/usr/bin/env node
// How was each commit verified? Reads the "Verified:" line of every commit message.
//
//   node verification/report.mjs             the last 50 commits of the current branch
//   node verification/report.mjs -n 200      more history
//   node verification/report.mjs <ref>       another branch, for example origin/main
//   node verification/report.mjs --json      the same data for a program
//
// "Verified: none (<why>)" is a stamp too: it is what makes unverified work easy to find.
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { git, gitPath, repoRoot } from './lib.mjs';

export function classify(body) {
  const lines = [...String(body || '').matchAll(/^verified\s*[:：]\s*(.+)$/gim)];
  if (!lines.length) return { kind: 'unstamped', text: '' };
  const text = lines.at(-1)[1].trim();
  return { kind: /^none\b/i.test(text) ? 'none' : 'verified', text };
}

export function collect(root, ref, n) {
  const out = git(['log', '--no-merges', '-n', String(n), '--format=%h%x1f%cs%x1f%s%x1f%B%x1e', ref], { cwd: root });
  const commits = out.split('\x1e').map((r) => r.trim()).filter(Boolean).map((r) => {
    const [hash, date, subject, body] = r.split('\x1f');
    return { hash, date, subject, ...classify(body) };
  });
  // Commits made before the first stamped one predate the rule and are not counted against anyone.
  const first = commits.findLastIndex((c) => c.kind !== 'unstamped');
  commits.forEach((c, i) => {
    if (c.kind === 'unstamped' && i > first) c.kind = 'before';
  });
  return commits;
}

export function gateLog(root) {
  try {
    return fs.readFileSync(gitPath(root, 'verify-gate.log'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  } catch {
    return [];
  }
}

export function main(argv, { cwd = process.cwd(), log = console.log } = {}) {
  let n = 50;
  let ref = 'HEAD';
  let json = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '-n') n = Math.max(1, Number(argv[++i]) || 50);
    else if (argv[i] === '--json') json = true;
    else ref = argv[i];
  }
  const root = repoRoot(cwd);
  const commits = collect(root, ref, n);
  const count = (k) => commits.filter((c) => c.kind === k).length;
  const gate = gateLog(root);
  const summary = { verified: count('verified'), none: count('none'), unstamped: count('unstamped'), before: count('before'), gateWouldBlock: gate.filter((g) => g.verdict === 'would_block').length, gateBlocked: gate.filter((g) => g.verdict === 'blocked').length };
  if (json) {
    log(JSON.stringify({ ref, summary, commits }, null, 2));
    return 0;
  }
  log(`验收盖章 · ${ref} · 最近 ${commits.length} 次提交`);
  log(`已验证 ${summary.verified} · 写明未验证 ${summary.none} · 没盖章 ${summary.unstamped}${summary.before ? `（规则开始之前的 ${summary.before} 次不计）` : ''}`);
  const open = commits.filter((c) => c.kind === 'none' || c.kind === 'unstamped');
  if (open.length) {
    log('\n要看一眼的：');
    for (const c of open) log(`  ${c.hash} ${c.date} ${c.kind === 'none' ? `未验证  ${c.subject}\n           原因：${c.text.replace(/^none\s*/i, '').replace(/^\((.*)\)$/, '$1') || '没写'}` : `没盖章  ${c.subject}`}`);
  } else if (summary.verified) log('\n没有需要追问的提交。');
  if (gate.length) log(`\n提交关卡（这台机器上的记录）：${gate.length} 次提交经过关卡，其中 ${summary.gateWouldBlock} 次在严格模式下会被拦下，${summary.gateBlocked} 次已被拦下。`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href) {
  try {
    process.exit(main(process.argv.slice(2)));
  } catch (e) {
    console.error(`report: ${e.message}`);
    process.exit(2);
  }
}
