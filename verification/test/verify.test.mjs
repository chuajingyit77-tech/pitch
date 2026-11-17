// Tests for the repository's verification layer: verify.mjs, the commit gate and the stamp report.
// Each test builds a throwaway git repository with a copy of these scripts and drives them as a user would.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { globToRegex, matchesAny, parseChecklist, readStamp, snapshotTree, uncommitted } from '../lib.mjs';
import { decide, isCommit, MAX_BLOCKS } from '../hooks/commit-gate.mjs';
import { classify } from '../report.mjs';
import { plan, trailer } from '../verify.mjs';

const source = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const ENV = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.com', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.com', GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' };
delete ENV.VERIFY_RULES_REF;

const RECIPES = {
  recipes: [
    { id: 'app', paths: ['app/**'], cwd: 'app', checks: [{ label: 'node check.mjs', run: 'node check.mjs' }] },
    { id: 'rules', paths: ['verification/**', 'REVIEW.md'], cwd: '.', checks: [{ label: 'rules ok', run: 'node -e 0' }] },
  ],
};
const CHECKLIST = `# list
## R1 · 服务只对本机开放
- 触发：\`app/server.js\`
- 检查：还只监听本机吗？
- 来由：承诺
## R2 · 别的区域
- 触发：\`other/**\`、\`*.cfg\`
- 检查：别的检查
- 来由：事故
`;

/** A repository with the scripts, one covered area whose check exits with the code in app/code.txt, and a first commit. */
function makeRepo({ gate = 'observe' } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-layer-'));
  const git = (...args) => execFileSync('git', args, { cwd: dir, env: ENV, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const file = (rel, content) => {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), content);
  };
  git('init', '-q', '-b', 'main', '.');
  fs.cpSync(source, path.join(dir, 'verification'), { recursive: true, filter: (src) => path.relative(source, src).split(path.sep)[0] !== 'test' });
  file('verification/recipes.json', JSON.stringify(RECIPES, null, 2));
  file('verification/checklist.md', CHECKLIST);
  file('verification/gate.json', JSON.stringify({ mode: gate }));
  file('app/check.mjs', "import fs from 'node:fs';\nconsole.log('# pass 7');\nconsole.log('checking');\nprocess.exit(Number(fs.readFileSync('code.txt', 'utf8')));\n");
  file('app/code.txt', '0');
  file('app/a.js', 'export const a = 1;\n');
  file('.gitignore', 'ignored/\n');
  git('add', '-A');
  git('commit', '-q', '-m', 'first');
  const node = (script, args = [], input) => {
    const r = spawnSync(process.execPath, [path.join(dir, 'verification', script), ...args], { cwd: dir, env: ENV, encoding: 'utf8', input });
    return { code: r.status, out: `${r.stdout}${r.stderr}` };
  };
  const commit = (message) => {
    git('add', '-A');
    git('commit', '-q', '--allow-empty', '-m', message);
  };
  const hook = (command = 'git commit -m "x"', session = 's1') => node('hooks/commit-gate.mjs', [], JSON.stringify({ session_id: session, cwd: dir, hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command } }));
  const gateLog = () => {
    try {
      return fs.readFileSync(path.join(dir, '.git', 'verify-gate.log'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
    } catch {
      return [];
    }
  };
  return { dir, git, file, node, commit, hook, gateLog, verify: (...args) => node('verify.mjs', args), stamp: () => readStamp(dir) };
}

// ---------- verify.mjs ----------

test('a change in a covered area runs that area\'s check and is stamped to the exact files', () => {
  const r = makeRepo();
  r.file('app/a.js', 'export const a = 2;\n');
  const { code, out } = r.verify();
  assert.equal(code, 0, out);
  assert.match(out, /还没提交的改动 · 1 个文件/);
  assert.match(out, /✓ app · node check\.mjs {3}7 项通过/);
  assert.match(out, /Verified: app node check\.mjs ✓ \(7 项通过\)/);
  const stamp = r.stamp();
  assert.equal(stamp.status, 'pass');
  assert.equal(stamp.tree, snapshotTree(r.dir), 'fresh for the files as they are');
  r.file('app/a.js', 'export const a = 3;\n');
  assert.notEqual(stamp.tree, snapshotTree(r.dir), 'one more edit and the result no longer describes the files');
  assert.equal(r.git('diff', '--cached', '--name-only'), '', 'taking the snapshot stages nothing');
});

test('a failing check fails the run, shows the end of its output, and says when to stop', () => {
  const r = makeRepo();
  r.file('app/code.txt', '3');
  const { code, out } = r.verify();
  assert.equal(code, 1);
  assert.match(out, /✗ app · node check\.mjs {3}退出码 3/);
  assert.match(out, /checking/, 'the output of the failed check is shown');
  assert.match(out, /连续 3 轮不过就停下来/);
  assert.doesNotMatch(out, /Verified:/);
  assert.equal(r.stamp().status, 'fail');
});

test('recipes come from the last commit, so a change cannot rewrite the check that judges it', () => {
  const r = makeRepo();
  r.file('app/code.txt', '1');
  const loosened = structuredClone(RECIPES);
  loosened.recipes[0].checks[0].run = 'node -e 0';
  r.file('verification/recipes.json', JSON.stringify(loosened));
  const first = r.verify();
  assert.equal(first.code, 1, 'the loosened recipe in the working copy is ignored');
  assert.match(first.out, /规则取自：HEAD/);
  // Once the rule change has been committed on its own, it is the rule.
  r.git('add', 'verification/recipes.json');
  r.git('commit', '-q', '-m', 'loosen the check');
  assert.equal(r.verify().code, 0);
});

test('only the checklist items the change triggers are listed', () => {
  const r = makeRepo();
  r.file('app/server.js', 'export {};\n');
  const hit = r.verify();
  assert.match(hit.out, /触发的可靠性清单（1 项）/);
  assert.match(hit.out, /R1 服务只对本机开放\n\s+还只监听本机吗？/);
  assert.doesNotMatch(hit.out, /R2/);
  assert.deepEqual(r.stamp().checklist, ['R1']);
  r.commit('server');
  r.file('app/a.js', '// nothing risky\n');
  assert.doesNotMatch(r.verify().out, /可靠性清单/);
});

test('files nothing covers are named for a hands-on run; prose needs no check', () => {
  const r = makeRepo();
  r.file('misc/tool.py', 'print(1)\n');
  r.file('notes.md', '# notes\n');
  const manual = r.verify();
  assert.equal(manual.code, 0);
  assert.match(manual.out, /没有自动检查的文件（1 个）[\s\S]*misc\/tool\.py/);
  assert.match(manual.out, /Verified: 无自动检查：misc\/tool\.py/);
  assert.equal(r.stamp().status, 'manual');
  assert.deepEqual(r.stamp().uncovered, ['misc/tool.py']);
  r.commit('tool');
  r.file('notes.md', '# notes v2\n');
  const docs = r.verify();
  assert.match(docs.out, /Verified: not needed \(只改了文档\)/);
  assert.equal(r.stamp().status, 'pass');
});

test('--skip records that a change is unverified, with the reason; a reason is required', () => {
  const r = makeRepo();
  r.file('app/a.js', '// tweak\n');
  const skip = r.verify('--skip', '没有测试环境');
  assert.equal(skip.code, 0);
  assert.match(skip.out, /Verified: none \(没有测试环境\)/);
  assert.deepEqual([r.stamp().status, r.stamp().reason], ['none', '没有测试环境']);
  const missing = r.verify('--skip');
  assert.equal(missing.code, 2);
  assert.match(missing.out, /要写明原因/);
  assert.equal(r.verify('--bogus').code, 2);
});

test('--list runs nothing, --all runs every recipe, --since reaches back, and a clean tree checks the last commit', () => {
  const r = makeRepo();
  r.file('app/code.txt', '1');
  const list = r.verify('--list');
  assert.equal(list.code, 0, 'listing does not run the failing check');
  assert.match(list.out, /会运行的检查：\n\s+app · node check\.mjs/);
  r.file('app/code.txt', '0');
  r.file('app/a.js', '// v2\n');
  r.commit('second');
  const clean = r.verify();
  assert.match(clean.out, /最近一次提交（工作区没有未提交的改动）/);
  assert.match(clean.out, /✓ app · node check\.mjs/);
  r.file('unrelated.md', 'x\n');
  r.commit('docs only');
  assert.match(r.verify().out, /这次改动没有对应的自动检查/);
  assert.match(r.verify('--since', 'HEAD~2').out, /自 HEAD~2 以来的改动[\s\S]*✓ app · node check\.mjs/);
  const all = r.verify('--all');
  assert.match(all.out, /✓ app · node check\.mjs[\s\S]*✓ rules · rules ok/);
});

test('planning: covered, prose and uncovered files are told apart', () => {
  const recipes = RECIPES.recipes;
  assert.deepEqual(plan(['app/x.js', 'docs/a.md', 'tool/run.sh', 'REVIEW.md'], recipes), { matched: recipes, uncovered: ['tool/run.sh'] });
  assert.deepEqual(plan(['docs/a.md'], recipes), { matched: [], uncovered: [] });
  assert.equal(plan([], recipes, { all: true }).matched.length, 2);
  assert.equal(trailer({ status: 'pass', checks: [], uncovered: [] }), 'Verified: not needed (只改了文档)');
  assert.equal(trailer({ status: 'none', reason: 'why', checks: [], uncovered: [] }), 'Verified: none (why)');
});

// ---------- shared pieces ----------

test('globs, checklist parsing and the list of uncommitted files', () => {
  assert.ok(matchesAny('agent-hub/src/a.js', ['agent-hub/**']) && matchesAny('a/b/c.md', ['**/*.md']) && matchesAny('x.md', ['**/*.md']));
  assert.ok(matchesAny('agent-hub/src/tools/bash.js', ['agent-hub/src/tools/*.js']) && !matchesAny('agent-hub/src/tools/x/y.js', ['agent-hub/src/tools/*.js']));
  assert.ok(!matchesAny('agent-hubx/a.js', ['agent-hub/**']) && !matchesAny('a.mdx', ['*.md']) && !matchesAny('anything', []));
  assert.ok(globToRegex('a+b(1).js').test('a+b(1).js'), 'special characters in a path are taken literally');
  const items = parseChecklist(CHECKLIST);
  assert.deepEqual(items.map((i) => [i.id, i.title, i.triggers]), [['R1', '服务只对本机开放', ['app/server.js']], ['R2', '别的区域', ['other/**', '*.cfg']]]);
  assert.equal(items[1].check, '别的检查');
  assert.deepEqual(parseChecklist('no items here'), []);

  const r = makeRepo();
  r.file('app/new file.js', 'x');
  r.file('app/a.js', 'changed');
  r.file('ignored/secret.txt', 'x');
  r.git('mv', 'app/code.txt', 'app/code2.txt');
  assert.deepEqual(uncommitted(r.dir).sort(), ['app/a.js', 'app/code.txt', 'app/code2.txt', 'app/new file.js']);
  const withIgnored = snapshotTree(r.dir);
  r.file('ignored/more.txt', 'y');
  assert.equal(snapshotTree(r.dir), withIgnored, 'ignored files are not part of the snapshot');
});

// ---------- the commit gate ----------

test('gate decisions: fresh passing, manual and skipped results go through; missing, stale and failed ones do not', () => {
  const ok = { status: 'pass', tree: 'T1' };
  assert.deepEqual(decide({ mode: 'off', stamp: null, tree: 'T1', blocks: 0 }), { verdict: 'off', block: false });
  for (const status of ['pass', 'manual', 'none']) assert.equal(decide({ mode: 'enforce', stamp: { status, tree: 'T1' }, tree: 'T1', blocks: 0 }).verdict, 'ok');
  assert.deepEqual(decide({ mode: 'observe', stamp: null, tree: 'T1', blocks: 0 }), { verdict: 'would_block', block: false, why: 'missing' });
  assert.deepEqual(decide({ mode: 'observe', stamp: ok, tree: 'T2', blocks: 0 }), { verdict: 'would_block', block: false, why: 'stale' });
  assert.deepEqual(decide({ mode: 'enforce', stamp: { status: 'fail', tree: 'T1' }, tree: 'T1', blocks: 0 }), { verdict: 'blocked', block: true, why: 'failed' });
  assert.equal(decide({ mode: 'enforce', stamp: null, tree: 'T1', blocks: MAX_BLOCKS - 1 }).block, true);
  assert.deepEqual(decide({ mode: 'enforce', stamp: null, tree: 'T1', blocks: MAX_BLOCKS }), { verdict: 'let_through', block: false, why: 'missing' });
  for (const c of ['git commit -m "x"', 'git add -A && git commit -m x', 'git -C sub commit -am x', 'cd a; git commit']) assert.equal(isCommit(c), true, c);
  for (const c of ['git status', 'git log --grep commit', 'git commit-graph write', 'npm run commit', 'gitx commit']) assert.equal(isCommit(c), false, c);
});

test('observe mode never blocks a commit; it writes down what it would have blocked', () => {
  const r = makeRepo();
  r.file('app/a.js', '// change\n');
  assert.deepEqual(r.hook(), { code: 0, out: '' });
  assert.deepEqual(r.gateLog().map((l) => [l.mode, l.verdict, l.why]), [['observe', 'would_block', 'missing']]);
  assert.equal(r.verify().code, 0);
  assert.equal(r.hook().code, 0);
  assert.equal(r.gateLog().at(-1).verdict, 'ok');
  r.file('app/a.js', '// changed again after verifying\n');
  r.hook();
  assert.deepEqual([r.gateLog().at(-1).verdict, r.gateLog().at(-1).why], ['would_block', 'stale']);
  assert.equal(r.hook('npm test').code, 0);
  assert.equal(r.gateLog().length, 3, 'commands that are not commits are ignored');
});

test('enforce mode blocks an unverified commit, at most twice per session, and accepts a recorded skip', () => {
  const r = makeRepo({ gate: 'enforce' });
  r.file('app/a.js', '// change\n');
  const first = r.hook();
  assert.equal(first.code, 2);
  assert.match(first.out, /验收关卡拦下了这次提交：这次改动还没有运行过验证[\s\S]*第 1 次拦截/);
  assert.equal(r.hook().code, 2);
  assert.equal(r.hook().code, 0, 'the third attempt goes through so the session cannot get stuck');
  assert.deepEqual(r.gateLog().map((l) => l.verdict), ['blocked', 'blocked', 'let_through']);
  assert.equal(r.hook('git commit -m x', 'another-session').code, 2, 'the limit is per session');
  r.verify('--skip', '只改了注释');
  assert.equal(r.hook('git commit -m x', 'another-session').code, 0, 'unverified but explained is allowed');
  r.file('app/code.txt', '1');
  r.verify();
  const failed = r.hook('git commit -m x', 'third-session');
  assert.equal(failed.code, 2);
  assert.match(failed.out, /上一次验证没有通过/);
});

test('the gate mode is a rule too: switching it off in the working copy does not switch it off', () => {
  const r = makeRepo({ gate: 'enforce' });
  r.file('verification/gate.json', JSON.stringify({ mode: 'off' }));
  assert.equal(r.hook().code, 2, 'the committed mode still applies');
  r.git('add', 'verification/gate.json');
  r.git('commit', '-q', '-m', 'turn the gate off');
  r.file('app/a.js', '// change\n');
  assert.equal(r.hook().code, 0);
  assert.equal(r.gateLog().length, 1, 'off does nothing, not even logging');
});

test('a broken gate never stops work', () => {
  const r = makeRepo({ gate: 'enforce' });
  assert.equal(r.node('hooks/commit-gate.mjs', [], 'this is not json').code, 0);
  assert.equal(r.node('hooks/commit-gate.mjs', [], '').code, 0);
  const outside = spawnSync(process.execPath, [path.join(r.dir, 'verification/hooks/commit-gate.mjs')], { cwd: os.tmpdir(), env: ENV, encoding: 'utf8', input: JSON.stringify({ cwd: os.tmpdir(), tool_name: 'Bash', tool_input: { command: 'git commit -m x' } }) });
  assert.equal(outside.status, 0, 'outside a repository the gate has nothing to say');
});

// ---------- the report ----------

test('the report tells verified, explained-unverified and unstamped commits apart, and ignores history before the rule', () => {
  assert.deepEqual(classify('subject\n\nbody\n\nVerified: app npm test ✓\nCo-Authored-By: x'), { kind: 'verified', text: 'app npm test ✓' });
  assert.deepEqual(classify('subject\n\nVerified: none (没有环境)'), { kind: 'none', text: 'none (没有环境)' });
  assert.deepEqual(classify('subject only'), { kind: 'unstamped', text: '' });
  assert.equal(classify('x\n\nverified：全角冒号也认').kind, 'verified');

  const r = makeRepo();
  r.commit('old work, before the rule');
  r.commit('feature A\n\nVerified: app node check.mjs ✓ (7 项通过)');
  r.commit('quick tweak\n\nVerified: none (只改了注释)');
  r.commit('forgot the stamp');
  const text = r.node('report.mjs').out;
  assert.match(text, /已验证 1 · 写明未验证 1 · 没盖章 1（规则开始之前的 2 次不计）/);
  assert.match(text, /未验证 {2}quick tweak\n\s+原因：只改了注释/);
  assert.match(text, /没盖章 {2}forgot the stamp/);
  assert.doesNotMatch(text, /old work/);
  const data = JSON.parse(r.node('report.mjs', ['--json', '-n', '3']).out);
  assert.deepEqual(data.commits.map((c) => c.kind), ['unstamped', 'none', 'verified']);
  r.file('app/a.js', '// x\n');
  r.hook();
  assert.match(r.node('report.mjs').out, /提交关卡（这台机器上的记录）：1 次提交经过关卡，其中 1 次在严格模式下会被拦下/);
});
