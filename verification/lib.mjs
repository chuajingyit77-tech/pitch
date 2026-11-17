// Shared pieces of the repository's verification layer: git access, path matching, where rules are read from,
// and the snapshot that ties a verification result to an exact state of the files.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export function git(args, { cwd, env, allowFail = false } = {}) {
  try {
    return execFileSync('git', args, { cwd, env: env || process.env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 });
  } catch (e) {
    if (allowFail) return null;
    throw new Error(`git ${args.join(' ')} failed: ${String(e.stderr || e.message).trim().split('\n')[0]}`);
  }
}

export function repoRoot(cwd = process.cwd()) {
  const out = git(['rev-parse', '--show-toplevel'], { cwd, allowFail: true });
  if (!out) throw new Error('这里不是一个 git 仓库。');
  return out.trim();
}

export const gitPath = (root, name) => path.resolve(root, git(['rev-parse', '--git-path', name], { cwd: root }).trim());

/** Turn a glob such as "agent-hub/**" or "*.md" into a regular expression over repo-relative paths. */
export function globToRegex(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        re += '.*';
        i++;
        if (glob[i + 1] === '/') i++;
      } else re += '[^/]*';
    } else if (c === '?') re += '[^/]';
    else re += c.replace(/[.+^$(){}|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${re}$`);
}

export const matchesAny = (file, globs) => (globs || []).some((g) => globToRegex(g).test(file));

/**
 * Read a rule file (recipes, checklist, gate mode) from the last commit, never from uncommitted edits:
 * a change must not be able to rewrite the checks it is judged by. VERIFY_RULES_REF pins the rules to
 * another ref, for example a protected default branch. The working copy is used only when no commit has the file yet.
 */
export function readRule(root, rel) {
  for (const ref of [process.env.VERIFY_RULES_REF, 'HEAD'].filter(Boolean)) {
    const text = git(['show', `${ref}:${rel}`], { cwd: root, allowFail: true });
    if (text !== null) return { text, from: ref };
  }
  const file = path.join(root, rel);
  return fs.existsSync(file) ? { text: fs.readFileSync(file, 'utf8'), from: 'working copy' } : { text: null, from: null };
}

/** Paths with uncommitted changes: staged, unstaged and untracked (ignored files are left out). */
export function uncommitted(root) {
  const out = git(['status', '--porcelain=v1', '-z', '--untracked-files=all'], { cwd: root });
  const files = [];
  const parts = out.split('\0');
  for (let i = 0; i < parts.length; i++) {
    const entry = parts[i];
    if (!entry) continue;
    const code = entry.slice(0, 2);
    files.push(entry.slice(3));
    if (code[0] === 'R' || code[0] === 'C') files.push(parts[++i]); // a rename or copy lists the old path next
  }
  return [...new Set(files.filter(Boolean))];
}

export function changedBetween(root, from, to = 'HEAD') {
  const out = git(['diff', '--name-only', '-z', from, to], { cwd: root, allowFail: true });
  return out ? out.split('\0').filter(Boolean) : [];
}

/**
 * A hash of the files exactly as they are now (tracked changes and new files, minus ignored ones), computed
 * through a throwaway index so nothing is staged. A verification result is only fresh for the snapshot it ran on.
 */
export function snapshotTree(root) {
  const real = gitPath(root, 'index');
  const tmp = `${real}.verify-${process.pid}`;
  try {
    if (fs.existsSync(real)) fs.copyFileSync(real, tmp);
    const env = { ...process.env, GIT_INDEX_FILE: tmp };
    git(['add', '-A'], { cwd: root, env });
    return git(['write-tree'], { cwd: root, env }).trim();
  } finally {
    fs.rmSync(tmp, { force: true });
    fs.rmSync(`${tmp}.lock`, { force: true });
  }
}

const STAMP = 'verify-stamp.json';

export function readStamp(root) {
  try {
    return JSON.parse(fs.readFileSync(gitPath(root, STAMP), 'utf8'));
  } catch {
    return null;
  }
}

export function writeStamp(root, stamp) {
  fs.writeFileSync(gitPath(root, STAMP), JSON.stringify(stamp, null, 2));
}

export const GATE_MODES = ['off', 'observe', 'enforce'];

/** The commit gate's mode, read like every other rule: from the last commit, not from the change being judged. */
export function gateMode(root) {
  try {
    const mode = JSON.parse(readRule(root, 'verification/gate.json').text).mode;
    return GATE_MODES.includes(mode) ? mode : 'observe';
  } catch {
    return 'observe';
  }
}

/**
 * Parse verification/checklist.md. An item is a "## R<n> · title" heading followed by lines
 * "- 触发：`glob`、`glob`", "- 检查：text" and "- 来由：text".
 */
export function parseChecklist(text) {
  const items = [];
  let cur = null;
  for (const line of String(text || '').split('\n')) {
    const head = /^##\s+(R\d+)\s*[·.:：-]\s*(.+?)\s*$/.exec(line);
    if (head) {
      cur = { id: head[1], title: head[2], triggers: [], check: '', origin: '' };
      items.push(cur);
      continue;
    }
    if (!cur) continue;
    const field = /^-\s*(触发|检查|来由)\s*[：:]\s*(.*)$/.exec(line);
    if (!field) continue;
    if (field[1] === '触发') cur.triggers = [...field[2].matchAll(/`([^`]+)`/g)].map((m) => m[1]);
    else if (field[1] === '检查') cur.check = field[2].trim();
    else cur.origin = field[2].trim();
  }
  return items;
}
