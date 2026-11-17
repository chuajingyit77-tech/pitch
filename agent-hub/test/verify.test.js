// Tests for the acceptance line (src/verify.js and its hooks in the loop and the tools).
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-hub-verify-'));
process.env.AGENT_HUB_DATA = path.join(tmp, 'data');
process.env.AGENT_HUB_MOCK = '1';
const repo = path.join(tmp, 'repo');
fs.mkdirSync(path.join(repo, 'test'), { recursive: true });
// Two stand-in checks whose result the test controls: `node verify.mjs` and `node test.js` exit with the code in a file.
fs.writeFileSync(path.join(repo, 'verify.mjs'), "import fs from 'node:fs';\nprocess.exit(Number(fs.readFileSync('verify.code', 'utf8')));\n");
fs.writeFileSync(path.join(repo, 'test.js'), "process.exit(Number(require('node:fs').readFileSync('test.code', 'utf8')));\n");
fs.writeFileSync(path.join(repo, 'test', 'existing.test.js'), '// an existing test\n');
fs.writeFileSync(path.join(repo, 'REVIEW.md'), '# review rules\n');
const setCode = (name, code) => fs.writeFileSync(path.join(repo, `${name}.code`), String(code));

const { runAgent } = await import('../src/loop.js');
const { setMockScript } = await import('../src/llm/mock.js');
const { saveConfig, loadConfig, publicConfig } = await import('../src/config.js');
const { hubWorkspace, writeJson } = await import('../src/store.js');
const { applyEvent } = await import('../public/reduce.js');
const V = await import('../src/verify.js');

before(() => saveConfig({ codingWorkspace: repo }));

function run(agentId, script, { approve, session } = {}) {
  setMockScript(script);
  const events = [];
  const messages = [];
  const asked = [];
  return runAgent({
    agentId,
    userText: 'go',
    messages,
    session: session || { id: 's_verify', facts: [], allowEdits: true, allowExec: true },
    emit: (e) => events.push(e),
    approve: async (req) => {
      asked.push(req);
      return approve ? approve(req) : { allow: true };
    },
  }).then((result) => ({ result, events, messages, asked, stamp: events.find((e) => e.type === 'verification' && !e.depth) }));
}
const toolResults = (messages) => messages.filter((m) => m.role === 'tool').flatMap((m) => m.results);
const write = (p, content = 'x') => ({ toolCalls: [{ name: 'write_file', input: { path: p, content } }] });
const bash = (command) => ({ toolCalls: [{ name: 'bash', input: { command } }] });
const mode = (m) => saveConfig({ verification: { mode: m } });

// ---------- reading commands ----------

test('test, lint, type-check, build and verify commands are recognised as checks, by kind', () => {
  const kinds = {
    'npm test': 'test',
    'cd agent-hub && npm test': 'test',
    'CI=1 npx vitest run': 'test',
    'node --test test/hub.test.js': 'test',
    'node test.js': 'test',
    'pytest -q': 'test',
    'python3 -m unittest discover -s engine/tests': 'test',
    'go test ./...': 'test',
    'make test': 'test',
    'npm run test:unit -- --watch=false': 'test',
    'npm run lint': 'lint',
    'cargo clippy': 'lint',
    'npx tsc --noEmit': 'types',
    'npm run build': 'build',
    'node verification/verify.mjs': 'verify',
    './scripts/verify.sh': 'verify',
    'timeout 120 npm test 2>&1': 'test',
    '(cd agent-hub && npm test)': 'test',
  };
  for (const [command, kind] of Object.entries(kinds)) {
    const c = V.classifyCommand(command);
    assert.ok(c, `"${command}" should be a check`);
    assert.equal(c.kind, kind, command);
    assert.equal(c.conclusive, true, command);
  }
  assert.equal(V.classifyCommand('cd agent-hub && npm test 2>&1').label, 'npm test');
  for (const command of ['ls', 'git status', 'npm install', 'npm ci', 'node server.js --demo', 'node verification/report.mjs', 'echo "npm test"', 'cat package.json | grep test', 'grep -r "a && npm test" .', 'npm token list']) {
    assert.equal(V.classifyCommand(command), null, `"${command}" is not a check`);
  }
});

test('a check whose exit code is hidden proves nothing, so it does not count either way', () => {
  for (const command of ['npm test | tail -20', 'npm test 2>&1 | tee out.log', 'npm test || true', 'npm test; echo done', 'npm test &']) {
    assert.equal(V.classifyCommand(command).conclusive, false, command);
    assert.equal(V.commandCheck(command, 'ok\n[exit code 0]').pass, null, command);
  }
  for (const command of ['npm test && echo ok', 'npm test;', 'lint-staged; npm test']) assert.equal(V.classifyCommand(command).conclusive, true, command);
  assert.equal(V.commandCheck('npm test', 'fine\n[exit code 0]').pass, true);
  assert.equal(V.commandCheck('npm test', 'boom\n[exit code 1]').pass, false);
  assert.equal(V.commandCheck('npm test', 'slow\n[killed after 120s timeout]\n[exit code null]').pass, false);
  assert.equal(V.commandCheck('ls', 'a\n[exit code 0]'), null);
});

test('tests and rule files are protected paths; ordinary source files are not', () => {
  for (const p of ['test/hub.test.js', 'src/__tests__/a.js', 'REVIEW.md', 'AGENTS.md', 'docs/CLAUDE.md', '.claude/skills/verify/SKILL.md', './verification/checklist.md', 'pkg/foo_test.go', 'tests/test_x.py', 'src/a.spec.ts', '.github/workflows/ci.yml', 'eval/coding/t1/hidden.py']) {
    assert.equal(V.isProtectedPath(p), true, p);
  }
  for (const p of ['src/app.js', 'README.md', 'src/contest.js', 'latest/index.js', 'src/testimonials.js', 'attest/a.js', '']) assert.equal(V.isProtectedPath(p), false, p);
});

test('shell commands that change a protected file are spotted; reading or running one is not', () => {
  for (const c of ['rm test/a.test.js', 'sed -i "s/x/y/" REVIEW.md', 'echo x > verification/gate.json', 'git checkout HEAD~1 -- test/hub.test.js', 'cp /tmp/t.js test/hub.test.js', 'cat a >> "tests/test_x.py"']) {
    assert.equal(V.mutatesProtected(c), true, c);
  }
  for (const c of ['node --test test/hub.test.js', 'cat test/a.test.js', 'node --test > /tmp/out.txt', 'rm -rf dist', 'grep -n review REVIEW.md', 'npm test 2>&1']) {
    assert.equal(V.mutatesProtected(c), false, c);
  }
  for (const c of ['sed -i s/a/b/ src/x.js', 'echo hi > notes.txt', 'git stash', 'mv a.js b.js']) assert.equal(V.looksLikeEdit(c), true, c);
  for (const c of ['npm test 2>&1', 'npm test > /dev/null', 'git status', 'node -e "const f = (a) => a > 1"', 'ls', 'git commit -m "msg"', 'sed -n 1,5p a.js', 'rm -f /tmp/out.txt', 'npm test > /tmp/log.txt']) assert.equal(V.looksLikeEdit(c), false, c);
  assert.equal(V.isRulePath('.claude/settings.json') && V.isRulePath('verification/gate.json') && V.isRulePath('REVIEW.md'), true);
  assert.equal(V.isRulePath('test/a.test.js') || V.isRulePath('src/review.js'), false);
});

// ---------- the stamp ----------

test('changed files with no check are stamped "none" and recorded as what the gate would block', async () => {
  const { result, stamp } = await run('coding', [write('src/a.js'), { text: 'done' }]);
  assert.equal(result.text, 'done', 'observe mode records, it does not interfere');
  assert.equal(stamp.status, 'none');
  assert.equal(stamp.edits, 1);
  const entry = V.readLog()[0];
  assert.deepEqual([entry.agent, entry.status, entry.mode, entry.wouldBlock, entry.blocks], ['coding', 'none', 'observe', true, 0]);
});

test('a passing check after the last edit is "verified"; editing again makes it "stale"', async () => {
  setCode('verify', 0);
  const ok = await run('coding', [write('src/a.js'), bash('node verify.mjs'), { text: 'done' }]);
  assert.equal(ok.stamp.status, 'verified');
  assert.deepEqual(ok.stamp.checks, [{ label: 'node verify.mjs', pass: true, rounds: 0 }]);
  assert.equal(ok.result.verification.status, 'verified');
  assert.deepEqual(ok.events.filter((e) => e.type === 'tool_result').map((e) => e.check), [undefined, 'pass'], 'the screen is told which call was a check');
  assert.equal('check' in toolResults(ok.messages)[1], false, 'what goes back to the model stays id, name, content, isError');
  const stale = await run('coding', [write('src/a.js'), bash('node verify.mjs'), write('src/a.js', 'y'), { text: 'done' }]);
  assert.equal(stale.stamp.status, 'stale');
  assert.equal(V.readLog()[0].wouldBlock, true);
});

test('a failing check is "failed"; a later pass of the same kind of check clears it', async () => {
  setCode('test', 1);
  const failed = await run('coding', [write('src/a.js'), bash('node test.js'), { text: 'it fails' }]);
  assert.equal(failed.stamp.status, 'failed');
  assert.deepEqual(failed.stamp.checks, [{ label: 'node test.js', pass: false, rounds: 1 }]);
  assert.equal(V.readLog()[0].wouldBlock, false, 'an honest failure is reported, not gated');
  // The fix goes through write_file here because the mock model can only act through tools.
  const fixed = await run('coding', [bash('node test.js'), write('test.code', '0'), bash('cd . && node test.js'), { text: 'fixed' }]);
  assert.equal(fixed.stamp.status, 'verified');
  assert.equal(fixed.stamp.checks.length, 1);
});

test('a piped check does not count, and the model is told why', async () => {
  setCode('verify', 0);
  const { stamp, messages } = await run('coding', [write('src/a.js'), bash('node verify.mjs | cat'), { text: 'done' }]);
  assert.equal(stamp.status, 'none');
  assert.equal(stamp.inconclusive, 1);
  assert.match(toolResults(messages)[1].content, /does not count as a check/);
});

test('each check is marked pass, fail or unclear for the screen, so a failed test run cannot look like a success', async () => {
  setCode('verify', 1);
  const { events } = await run('coding', [bash('node verify.mjs'), bash('node verify.mjs | cat'), bash('ls'), { text: 'x' }]);
  assert.deepEqual(events.filter((e) => e.type === 'tool_result').map((e) => [e.isError, e.check]), [[false, 'fail'], [false, 'unclear'], [false, undefined]]);
  const items = [];
  applyEvent(items, { type: 'tool', id: 't1', name: 'bash', input: { command: 'npm test' } });
  applyEvent(items, { type: 'tool_result', id: 't1', content: 'boom', isError: false, check: 'fail' });
  assert.equal(items[0].check, 'fail');
});

test('with no edits and no checks there is no stamp at all', async () => {
  const { stamp } = await run('coding', [bash('ls'), { text: 'looked' }]);
  assert.equal(stamp, undefined);
  const hub = await run('assistant', [write('notes/plan.txt'), { text: 'saved' }]);
  assert.equal(hub.stamp, undefined, "the hub's own sandbox is scratch space, not work to verify");
});

// ---------- three rounds, then a human ----------

test('three failed rounds of a check stop the run and bring in the user', async () => {
  setCode('verify', 1);
  const { messages, events, stamp, result } = await run('coding', [
    bash('node verify.mjs'),
    bash('node verify.mjs'),
    bash('node verify.mjs'),
    write('src/forced.js'),
    { text: 'I tried three times; here is the failing output and what I need.' },
  ]);
  const results = toolResults(messages);
  assert.doesNotMatch(results[1].content, /rounds in a row/);
  assert.match(results[2].content, /failed 3 rounds in a row[\s\S]*Stop here/);
  assert.equal(results[3].isError, true, 'nothing more is changed once the run has stopped');
  assert.match(results[3].content, /This run stopped after 3 failed rounds/);
  assert.equal(fs.existsSync(path.join(repo, 'src/forced.js')), false);
  assert.ok(events.some((e) => e.type === 'notice' && /连续 3 轮没有通过/.test(e.text)));
  assert.equal(stamp.status, 'escalated');
  assert.equal(stamp.checks[0].rounds, 3);
  assert.match(result.text, /what I need/);
});

test('after the stop the model gets two turns to report, not an open-ended retry loop', async () => {
  setCode('verify', 1);
  const read = { toolCalls: [{ name: 'read_file', input: { path: 'verify.mjs' } }] };
  const { result, messages } = await run('coding', [bash('node verify.mjs'), bash('node verify.mjs'), bash('node verify.mjs'), read, read, read, { text: 'never reached' }]);
  assert.notEqual(result.text, 'never reached');
  assert.equal(messages.filter((m) => m.role === 'assistant').length, 5);
  setMockScript(null);
});

test('a stopped run cannot hand the work to another agent to keep going', async () => {
  setCode('verify', 1);
  const { messages, events } = await run('coding', [bash('node verify.mjs'), bash('node verify.mjs'), bash('node verify.mjs'), { toolCalls: [{ name: 'delegate', input: { agent: 'assistant', task: 'keep trying' } }] }, { text: 'report' }]);
  assert.match(toolResults(messages)[3].content, /This run stopped after 3 failed rounds/);
  assert.equal(events.some((e) => e.type === 'start' && e.depth === 1), false);
});

test('a pass in between resets the count', async () => {
  setCode('verify', 1);
  const { stamp } = await run('coding', [bash('node verify.mjs'), bash('node verify.mjs'), write('verify.code', '0'), bash('node verify.mjs'), write('verify.code', '1'), bash('node verify.mjs'), bash('node verify.mjs'), { text: 'still failing' }]);
  assert.equal(stamp.status, 'failed');
  assert.equal(stamp.checks[0].rounds, 2);
});

// ---------- the gate: off, observe, enforce ----------

test('enforce mode sends an unverified finish back, and accepts it once a check has passed', async () => {
  mode('enforce');
  setCode('verify', 0);
  const { result, messages, events, stamp } = await run('coding', [write('src/a.js'), { text: 'done' }, bash('node verify.mjs'), { text: 'verified now' }]);
  assert.equal(result.text, 'verified now');
  assert.ok(messages.some((m) => m.role === 'user' && /\[verification gate\]/.test(m.content)));
  assert.ok(events.some((e) => e.type === 'notice' && /验收关卡.*第 1 次/.test(e.text)));
  assert.equal(stamp.status, 'verified');
  assert.equal(V.readLog()[0].blocks, 1);
  mode('observe');
});

test('enforce mode blocks at most twice, then lets the run through marked unverified', async () => {
  mode('enforce');
  const { result, events, stamp, messages } = await run('coding', [write('src/a.js'), { text: 'done 1' }, { text: 'done 2' }, { text: 'cannot be checked because there is no test runner here' }]);
  assert.match(result.text, /cannot be checked/);
  assert.equal(messages.filter((m) => m.role === 'user' && /\[verification gate\]/.test(m.content)).length, 2);
  assert.ok(events.some((e) => e.type === 'notice' && /拦过 2 次.*放行/.test(e.text)));
  assert.equal(stamp.status, 'none');
  const entry = V.readLog()[0];
  assert.deepEqual([entry.mode, entry.wouldBlock, entry.blocks], ['enforce', true, 2]);
  mode('observe');
});

test('enforce mode leaves verified work, honest failures and runs without edits alone', async () => {
  mode('enforce');
  setCode('verify', 0);
  setCode('test', 1);
  const verified = await run('coding', [write('src/a.js'), bash('node verify.mjs'), { text: 'ok' }]);
  const failed = await run('coding', [write('src/a.js'), bash('node test.js'), { text: 'tests fail, here is the output' }]);
  const chat = await run('coding', [{ text: 'just an answer' }]);
  for (const r of [verified, failed, chat]) assert.equal(r.messages.some((m) => m.role === 'user' && /\[verification gate\]/.test(m.content)), false);
  mode('observe');
});

test('mode "off" keeps no ledger: no stamp, no record, no three-round stop', async () => {
  mode('off');
  setCode('verify', 1);
  const before = V.readLog().length;
  const { events, messages } = await run('coding', [write('src/a.js'), bash('node verify.mjs'), bash('node verify.mjs'), bash('node verify.mjs'), bash('node verify.mjs'), { text: 'done' }]);
  assert.equal(events.some((e) => e.type === 'verification'), false);
  assert.equal(V.readLog().length, before);
  assert.doesNotMatch(toolResults(messages).map((r) => r.content).join('\n'), /\[verification\]/);
  mode('observe');
});

test('the mode is saved, validated, and defaults to observe for a config written before it existed', () => {
  assert.equal(loadConfig().verification.mode, 'observe');
  saveConfig({ verification: { mode: 'bogus' } });
  assert.equal(loadConfig().verification.mode, 'observe');
  mode('enforce');
  assert.equal(publicConfig(loadConfig()).verification.mode, 'enforce');
  const old = loadConfig();
  delete old.verification;
  writeJson('config.json', old);
  assert.equal(loadConfig().verification.mode, 'observe');
  assert.equal(loadConfig().codingWorkspace, repo, 'the rest of an old config still loads');
});

// ---------- the checks are out of the change's reach ----------

test('editing an existing test or rule file always asks, even after a blanket approval; new tests and source do not', async () => {
  const session = { id: 's_guard', facts: [], allowEdits: true, allowExec: true };
  const { asked } = await run('coding', [write('test/existing.test.js', '// weakened'), write('test/brand-new.test.js'), write('src/b.js'), { toolCalls: [{ name: 'edit_file', input: { path: 'REVIEW.md', old_string: 'review', new_string: 'no' } }] }, { text: 'ok' }], { session });
  assert.deepEqual(asked.map((a) => [a.tool, a.input.path, a.why]), [['write_file', 'test/existing.test.js', 'protected'], ['edit_file', 'REVIEW.md', 'protected']]);
});

test('a new rule file always asks too, because a new hook or rule changes how work is judged', async () => {
  const session = { id: 's_guard_new', facts: [], allowEdits: true, allowExec: true };
  const { asked } = await run('coding', [write('.claude/settings.json', '{}'), write('verification/extra.md'), write('test/another-new.test.js'), { text: 'ok' }], { session });
  assert.deepEqual(asked.map((a) => [a.input.path, a.why]), [['.claude/settings.json', 'protected'], ['verification/extra.md', 'protected']]);
});

test('"allow for this conversation" given on a protected file does not become a blanket approval', async () => {
  const session = { id: 's_guard2', facts: [] };
  const { asked } = await run('coding', [write('REVIEW.md', '# rules v2'), write('src/c.js'), { text: 'ok' }], { session, approve: () => ({ allow: true, always: true }) });
  assert.deepEqual(asked.map((a) => a.input.path), ['REVIEW.md', 'src/c.js']);
  assert.equal(asked[1].why, undefined);
  assert.equal(session.allowEdits, true, 'the ordinary file did grant it');
});

test('a shell command that changes a test always asks; running the test does not', async () => {
  setCode('verify', 0);
  const session = { id: 's_guard3', facts: [], allowEdits: true, allowExec: true };
  const { asked, messages } = await run('coding', [bash('rm test/existing.test.js'), bash('node verify.mjs'), bash('cat test/existing.test.js'), { text: 'ok' }], { session, approve: () => ({ allow: false, reason: 'keep the test' }) });
  assert.deepEqual(asked.map((a) => [a.input.command, a.why]), [['rm test/existing.test.js', 'protected']]);
  assert.match(toolResults(messages)[0].content, /declined.*keep the test/);
  assert.ok(fs.existsSync(path.join(repo, 'test/existing.test.js')));
});

test("the hub's own sandbox has no checks to guard, so the assistant is not asked there", async () => {
  const { asked } = await run('assistant', [write('tests/notes.txt', 'a'), write('tests/notes.txt', 'b'), { text: 'ok' }]);
  assert.equal(asked.length, 0);
  assert.equal(fs.readFileSync(path.join(hubWorkspace(), 'tests/notes.txt'), 'utf8'), 'b');
});

// ---------- the other agents ----------

test("pitch: the deck's own review is its check, and three rounds of problems stop the run", async () => {
  const bad = { toolCalls: [{ name: 'write_deck', input: { title: 'Acme', slides: [{ layout: 'stats', title: 'Traction', stats: [{ value: '95%', label: 'retention' }] }] } }] };
  const stuck = await run('pitch', [bad, bad, bad, bad, { text: 'I need a source for the 95% figure.' }], { session: { id: 's_pitch_stuck', facts: [] } });
  assert.match(toolResults(stuck.messages)[2].content, /"Pitch 自检" has now failed 3 rounds in a row/);
  assert.equal(stuck.stamp.status, 'escalated');
  assert.equal(toolResults(stuck.messages)[3].isError, false, 'write_deck needs no approval, so it is not what the stop refuses');
  const good = { toolCalls: [{ name: 'write_deck', input: { title: 'Acme', slides: [{ layout: 'cover', title: 'Acme' }] } }] };
  const clean = await run('pitch', [bad, good, { text: 'built' }], { session: { id: 's_pitch_ok', facts: [] } });
  assert.equal(clean.stamp.status, 'verified');
  assert.deepEqual(clean.stamp.checks, [{ label: 'Pitch 自检', pass: true, rounds: 0 }]);
});

test('delegated work comes back with its stamp, so "done" travels with its evidence', async () => {
  setCode('verify', 0);
  const verified = await run('assistant', [
    { toolCalls: [{ name: 'delegate', input: { agent: 'coding', task: 'change a.js and verify it' } }] },
    write('src/a.js'),
    bash('node verify.mjs'),
    { text: 'changed a.js' },
    { text: 'relayed' },
  ]);
  assert.match(toolResults(verified.messages)[0].content, /^changed a\.js\n\n\[verification stamp: verified, checked after the last change \(node verify\.mjs: passed\)\]$/);
  assert.ok(verified.events.some((e) => e.type === 'verification' && e.depth === 1 && e.status === 'verified'));
  assert.equal(verified.stamp, undefined, 'the assistant itself changed nothing');
  const unverified = await run('assistant', [{ toolCalls: [{ name: 'delegate', input: { agent: 'coding', task: 'change a.js' } }] }, write('src/a.js'), { text: 'changed a.js' }, { text: 'relayed' }]);
  assert.match(toolResults(unverified.messages)[0].content, /\[verification stamp: NOT verified, 1 file\(s\) changed and no check passed\]$/);
});

// ---------- the record and the screen ----------

test('every stamped run is on record, newest first, and the summary counts what the gate would block', () => {
  const log = V.readLog();
  assert.ok(log.length >= 10);
  assert.ok(log[0].at >= log.at(-1).at);
  const sum = V.summarize(log);
  assert.equal(sum.total, log.length);
  assert.equal(sum.verified + sum.failed + sum.escalated + sum.none + sum.stale, log.length);
  assert.ok(sum.wouldBlock >= 3 && sum.blocked >= 2 && sum.escalated >= 2);
  fs.appendFileSync(path.join(process.env.AGENT_HUB_DATA, 'verification.jsonl'), '{"cut off\n');
  assert.equal(V.readLog().length, log.length, 'a line cut off by a crash is skipped');
  // The record does not grow without bound: past the size limit only the newest lines are kept.
  for (let i = 0; i < 5; i++) V.logRun({ agent: 'coding', status: 'verified', n: i }, { maxBytes: 200, keep: 3 });
  assert.deepEqual(V.readLog().map((e) => e.n), [4, 3, 2]);
});

test('the transcript keeps the stamp and the reason an approval could not be blanket-approved', () => {
  const items = [];
  applyEvent(items, { type: 'approval', id: 'ap1', tool: 'write_file', tier: 'edit', input: { path: 'REVIEW.md' }, agent: 'coding', why: 'protected' });
  applyEvent(items, { type: 'verification', agent: 'coding', depth: 0, status: 'stale', edits: 2, checks: [{ label: 'npm test', pass: true, rounds: 0 }], inconclusive: 0 });
  assert.equal(items[0].why, 'protected');
  assert.deepEqual(items[1], { type: 'verification', status: 'stale', checks: [{ label: 'npm test', pass: true, rounds: 0 }], edits: 2, inconclusive: 0, agent: 'coding', depth: 0 });
  // A transcript saved before stamps existed has none of these items and still folds as before.
  assert.deepEqual(applyEvent([], { type: 'notice', text: 'x' }), [{ type: 'notice', text: 'x', depth: 0 }]);
});
