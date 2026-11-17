#!/usr/bin/env node
// The commit gate, as a Claude Code PreToolUse hook on `git commit`.
// Question it asks: is there a verification result for exactly the files being committed?
//   off      does nothing
//   observe  never blocks; writes what it would have blocked to <git dir>/verify-gate.log   (the starting mode)
//   enforce  blocks the commit (exit code 2), at most twice per session so a session cannot get stuck
// The mode comes from verification/gate.json as last committed, so a change cannot switch its own gate off.
// A recorded skip (`verify.mjs --skip "<why>"`) passes: unverified work is allowed, unexplained work is not.
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { gateMode, gitPath, readStamp, repoRoot, snapshotTree } from '../lib.mjs';

export const MAX_BLOCKS = 2;

const WHY = {
  missing: '这次改动还没有运行过验证',
  stale: '验证之后文件又改过了，结果已经过期',
  failed: '上一次验证没有通过',
};

export function decide({ mode, stamp, tree, blocks }) {
  if (mode === 'off') return { verdict: 'off', block: false };
  const fresh = Boolean(stamp) && stamp.tree === tree;
  if (fresh && ['pass', 'manual', 'none'].includes(stamp.status)) return { verdict: 'ok', block: false };
  const why = !stamp ? 'missing' : !fresh ? 'stale' : 'failed';
  if (mode === 'observe') return { verdict: 'would_block', block: false, why };
  if (blocks >= MAX_BLOCKS) return { verdict: 'let_through', block: false, why };
  return { verdict: 'blocked', block: true, why };
}

export const isCommit = (command) => /(^|[\s;&|(])git\s+(?:-\S+\s+(?:\S+\s+)?)*commit(\s|$)/.test(String(command || ''));

export function run(input) {
  if (input?.tool_name && input.tool_name !== 'Bash') return { exit: 0 };
  if (!isCommit(input?.tool_input?.command)) return { exit: 0 };
  const root = repoRoot(input.cwd || process.cwd());
  const mode = gateMode(root);
  if (mode === 'off') return { exit: 0 };
  const session = String(input.session_id || 'unknown');
  const blocksFile = gitPath(root, 'verify-gate-blocks.json');
  let counts = {};
  try {
    counts = JSON.parse(fs.readFileSync(blocksFile, 'utf8'));
  } catch {
    // first block of this clone
  }
  const stamp = readStamp(root);
  const tree = snapshotTree(root);
  const d = decide({ mode, stamp, tree, blocks: counts[session] || 0 });
  fs.appendFileSync(gitPath(root, 'verify-gate.log'), `${JSON.stringify({ at: new Date().toISOString(), session, mode, verdict: d.verdict, why: d.why, stamp: stamp?.status || null, tree })}\n`);
  if (!d.block) return { exit: 0 };
  counts[session] = (counts[session] || 0) + 1;
  fs.writeFileSync(blocksFile, JSON.stringify(counts));
  return {
    exit: 2,
    message: `验收关卡拦下了这次提交：${WHY[d.why]}。先运行 node verification/verify.mjs ；如果这次改动确实没法验证，运行 node verification/verify.mjs --skip "原因" 把原因记下来再提交。（本会话第 ${counts[session]} 次拦截，最多拦 ${MAX_BLOCKS} 次。）`,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href) {
  let result = { exit: 0 };
  try {
    result = run(JSON.parse(fs.readFileSync(0, 'utf8') || '{}'));
  } catch {
    // A broken gate must never stop work: on any internal error the commit goes ahead.
  }
  if (result.message) console.error(result.message);
  process.exit(result.exit);
}
