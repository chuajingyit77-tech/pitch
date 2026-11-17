// Property tests: rules that must hold whatever the input is. Instead of a few hand-picked cases, each test
// throws thousands of generated inputs at one rule. The generator is seeded, so a failure can be replayed:
// the assertion message carries the seed and the offending input.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-hub-prop-'));
process.env.AGENT_HUB_DATA = path.join(tmp, 'data');

const { confine } = await import('../src/tools/files.js');
const V = await import('../src/verify.js');

const SEED = Number(process.env.PROP_SEED) || 20261118;

/** Small deterministic random generator (mulberry32). */
function rng(seed) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (n) => Math.floor(next() * n);
  const pick = (list) => list[int(list.length)];
  const many = (list, min, max) => Array.from({ length: min + int(max - min + 1) }, () => pick(list));
  return { next, int, pick, many };
}

test('no path, however it is spelled, resolves outside the workspace', () => {
  const root = path.join(tmp, 'ws');
  fs.mkdirSync(path.join(root, 'sub', 'deep'), { recursive: true });
  fs.writeFileSync(path.join(root, 'sub', 'a.txt'), 'x');
  fs.symlinkSync(os.tmpdir(), path.join(root, 'out')); // a link that leads outside
  fs.symlinkSync(path.join(root, 'sub'), path.join(root, 'in')); // a link that stays inside
  fs.symlinkSync('/etc', path.join(root, 'sub', 'etc'));
  const real = fs.realpathSync(root);
  const r = rng(SEED);
  const parts = ['..', '.', 'sub', 'deep', 'out', 'in', 'etc', 'a.txt', 'new.txt', '', '...', '..\\..', '~', '%2e%2e', 'sub/../..', 'in/../../x', 'out/escape.txt', 'passwd', ' ', '..;'];
  let inside = 0;
  let refused = 0;
  for (let i = 0; i < 5000; i++) {
    const p = (r.int(6) === 0 ? r.pick(['/', '//', '/etc/', real + '/', path.dirname(real) + '/']) : '') + r.many(parts, 1, 6).join(r.pick(['/', '/', '//']));
    let out;
    try {
      out = confine(root, p);
    } catch (e) {
      assert.match(e.message, /outside the workspace/, `seed ${SEED}: unexpected error for ${JSON.stringify(p)}: ${e.message}`);
      refused++;
      continue;
    }
    inside++;
    assert.ok(out === real || out.startsWith(real + path.sep), `seed ${SEED}: ${JSON.stringify(p)} resolved to ${out}, outside ${real}`);
    // What exists on disk at that path must really be inside too, not merely look inside.
    let existing = out;
    while (!fs.existsSync(existing)) existing = path.dirname(existing);
    const actual = fs.realpathSync(existing);
    assert.ok(actual === real || actual.startsWith(real + path.sep), `seed ${SEED}: ${JSON.stringify(p)} reaches ${actual} through a link`);
  }
  assert.ok(inside > 500 && refused > 500, `the generator should exercise both outcomes (inside ${inside}, refused ${refused})`);
});

const CHECK_COMMANDS = ['npm test', 'npm run lint', 'npx tsc --noEmit', 'node --test', 'node --test test/a.test.js', 'pytest -q', 'python3 -m unittest', 'go test ./...', 'cargo test', 'make test', 'npm run build', 'node verification/verify.mjs', 'yarn test', 'pnpm run typecheck', 'npx vitest run', 'eslint .', './scripts/verify.sh'];
const HARMLESS = ['', 'cd agent-hub && ', 'CI=1 ', 'time ', 'echo start && ', 'timeout 300 ', '( ', 'git status; '];
const MASKS = [' | tail -5', ' | tee out.log', ' || true', '; echo done', ' &', ' | cat', ' || echo failed', ' 2>&1 | head -40', '; exit 0', ' | grep -v warn && echo ok'];
const SAFE_TAILS = ['', ' 2>&1', ' && echo ok', ' > /tmp/out.txt', ' && git status', ';'];

test('a check counts only when its own exit code is what the command returns', () => {
  const r = rng(SEED + 1);
  for (let i = 0; i < 3000; i++) {
    const base = r.pick(HARMLESS).replace('( ', '') + r.pick(CHECK_COMMANDS);
    const masked = base + r.pick(MASKS);
    const m = V.classifyCommand(masked);
    assert.ok(m, `seed ${SEED}: ${masked} should still be recognised as a check`);
    assert.equal(m.conclusive, false, `seed ${SEED}: the result of "${masked}" is hidden and must not count`);
    assert.equal(V.commandCheck(masked, 'all good\n[exit code 0]').pass, null, masked);
    const plain = base + r.pick(SAFE_TAILS);
    const p = V.classifyCommand(plain);
    assert.ok(p && p.conclusive, `seed ${SEED}: "${plain}" shows its own result and must count`);
    assert.equal(V.commandCheck(plain, 'x\n[exit code 0]').pass, true, plain);
    assert.equal(V.commandCheck(plain, 'x\n[exit code 1]').pass, false, plain);
  }
});

test('reading a command never throws, whatever the model sends', () => {
  const r = rng(SEED + 2);
  const bits = ['npm', 'test', 'rm', '-rf', 'sed', '-i', 'git', 'checkout', '>', '>>', '|', '||', '&', '&&', ';', '"', "'", '`', '\\', '(', ')', '$(', '2>&1', '&>', '\n', ' ', '  ', 'test/a.test.js', 'REVIEW.md', '/tmp/x', '=', '<', '<<EOF', '*', '{', '}', '测试', '\t', '\\"'];
  for (let i = 0; i < 5000; i++) {
    const command = r.many(bits, 0, 14).join(r.pick(['', ' ', ' ']));
    const where = `seed ${SEED}: ${JSON.stringify(command)}`;
    assert.doesNotThrow(() => {
      const c = V.classifyCommand(command);
      assert.ok(c === null || (typeof c.conclusive === 'boolean' && typeof c.kind === 'string' && c.label.length <= 70), where);
      assert.equal(typeof V.mutatesProtected(command), 'boolean', where);
      assert.equal(typeof V.looksLikeEdit(command), 'boolean', where);
      for (const part of V.splitCommand(command)) assert.ok(part.text.length > 0, where);
      for (const t of V.redirectTargets(command)) assert.ok(t.length > 0, where);
    }, where);
  }
  for (const odd of [undefined, null, 0, {}, []]) assert.equal(V.classifyCommand(odd), null);
});

test('a protected path stays protected however it is written', () => {
  const r = rng(SEED + 3);
  const segs = ['src', 'test', 'tests', '__tests__', 'verification', '.claude', '.github', 'workflows', 'lib', 'e2e', 'eval', 'docs', 'a.js', 'a.test.js', 'b.spec.ts', 'REVIEW.md', 'AGENTS.md', 'CLAUDE.md', 'README.md', 'test_x.py', 'x_test.go', 'conftest.py', 'latest', 'contest.js', 'review.txt'];
  for (let i = 0; i < 4000; i++) {
    const p = r.many(segs, 1, 5).join('/');
    const expected = V.isProtectedPath(p);
    assert.equal(V.isProtectedPath(`./${p}`), expected, `seed ${SEED}: ./${p}`);
    assert.equal(V.isProtectedPath(p.replaceAll('/', '\\')), expected, `seed ${SEED}: backslashes in ${p}`);
    assert.equal(V.isProtectedPath(p.toUpperCase()), expected, `seed ${SEED}: upper case ${p} (file systems on Mac and Windows ignore case)`);
    if (V.isRulePath(p)) assert.equal(expected, true, `seed ${SEED}: rule path ${p} must be protected`);
    // Whatever sits under a rule directory is a rule file.
    assert.equal(V.isRulePath(`verification/${p}`) && V.isRulePath(`.claude/${p}`), true, `seed ${SEED}: under a rule directory: ${p}`);
  }
});

// ---------- the ledger ----------

const KINDS = ['test', 'lint', 'build'];

function randomRun(r, length) {
  return Array.from({ length }, () => {
    const roll = r.int(10);
    if (roll < 3) return { t: 'edit', file: r.pick(['a.js', 'b.js', '(shell)']) };
    const kind = r.pick(KINDS);
    return { t: 'check', kind, label: kind, pass: roll < 6 ? true : roll < 9 ? false : null };
  });
}

function play(events) {
  const ledger = V.createLedger();
  for (const e of events) {
    if (e.t === 'edit') V.noteEdit(ledger, e.file);
    else V.noteCheck(ledger, e);
  }
  return ledger;
}

/** The stamp worked out the slow, obvious way, independently of the ledger's bookkeeping. */
function expected(events) {
  const real = events.filter((e) => e.t === 'check' && e.pass !== null);
  const edits = events.filter((e) => e.t === 'edit');
  if (!edits.length && !real.length) return null;
  const streak = {};
  let stopped = false;
  for (const e of real) {
    streak[e.kind] = e.pass ? 0 : (streak[e.kind] || 0) + 1;
    if (streak[e.kind] >= V.MAX_ROUNDS) stopped = true;
  }
  if (stopped) return 'escalated';
  const lastOf = (kind) => real.findLast((e) => e.kind === kind);
  const latest = KINDS.map(lastOf).filter(Boolean);
  if (latest.some((e) => !e.pass)) return 'failed';
  if (!latest.length) return 'none';
  const lastPass = Math.max(...latest.map((e) => events.lastIndexOf(e)));
  const lastEdit = events.findLastIndex((e) => e.t === 'edit');
  return lastEdit > lastPass ? 'stale' : 'verified';
}

test('the stamp always matches the evidence, for any order of edits and checks', () => {
  const r = rng(SEED + 4);
  const seen = new Set();
  for (let i = 0; i < 6000; i++) {
    const events = randomRun(r, r.int(12));
    const stamp = V.stampOf(play(events));
    const where = `seed ${SEED}: ${JSON.stringify(events)}`;
    assert.equal(stamp ? stamp.status : null, expected(events), where);
    seen.add(stamp ? stamp.status : 'null');
    if (!stamp) continue;
    if (stamp.status === 'verified') {
      assert.notEqual(events.at(-1).t, 'edit', `a run that ends on an edit is never verified. ${where}`);
      assert.ok(stamp.checks.length > 0 && stamp.checks.every((c) => c.pass), where);
    }
    assert.equal(V.wouldBlock(stamp), stamp.edits > 0 && ['none', 'stale'].includes(stamp.status), where);
    // Whatever happened before, one more edit or one more failed check can never leave the run verified.
    assert.notEqual(V.stampOf(play([...events, { t: 'edit', file: 'z.js' }])).status, 'verified', where);
    assert.notEqual(V.stampOf(play([...events, { t: 'check', kind: 'test', label: 'test', pass: false }])).status, 'verified', where);
    // A result that proves nothing changes nothing.
    assert.equal(V.stampOf(play([...events, { t: 'check', kind: 'test', label: 'test', pass: null }])).status, stamp.status, where);
  }
  assert.deepEqual([...seen].sort(), ['escalated', 'failed', 'none', 'null', 'stale', 'verified'], 'the generator reaches every outcome');
});

test('the run is stopped on exactly the third failed round in a row, and only once', () => {
  const r = rng(SEED + 5);
  for (let i = 0; i < 3000; i++) {
    const events = randomRun(r, 4 + r.int(14)).filter((e) => e.t === 'check');
    const ledger = V.createLedger();
    const streak = {};
    let stops = 0;
    for (const e of events) {
      const { escalate, round } = V.noteCheck(ledger, e);
      if (e.pass === null) {
        assert.equal(escalate, false);
        continue;
      }
      streak[e.kind] = e.pass ? 0 : (streak[e.kind] || 0) + 1;
      assert.equal(round, streak[e.kind], `seed ${SEED}: ${JSON.stringify(events)}`);
      if (escalate) {
        stops++;
        assert.equal(streak[e.kind], V.MAX_ROUNDS, `seed ${SEED}: stopped at round ${streak[e.kind]}: ${JSON.stringify(events)}`);
      }
    }
    const reached = Boolean(ledger.escalated);
    assert.equal(stops, reached ? 1 : 0, `seed ${SEED}: ${JSON.stringify(events)}`);
  }
});
