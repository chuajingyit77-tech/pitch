// Differential tests: the old behaviour is the oracle. The same scripted conversation is run twice, once with
// verification off (the loop exactly as it was before the acceptance line) and once in observe mode, each in a
// fresh data directory and repository, and the two transcripts are compared.
//   - A conversation that changes no repository file and runs no check must come out identical.
//   - One that does may differ in two ways only: the stamp event at the end, and the pass/fail marker on a check.
// Whatever the model is sent, whatever the user is asked to approve, and the final answer must not change.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-hub-diff-'));
process.env.AGENT_HUB_MOCK = '1';
process.env.AGENT_HUB_DATA = path.join(tmp, 'boot');

const { runAgent } = await import('../src/loop.js');
const { setMockScript } = await import('../src/llm/mock.js');
const { saveConfig } = await import('../src/config.js');

let n = 0;
/** A fresh world for one run: its own data directory and its own copy of a small repository. */
function world(mode) {
  const dir = path.join(tmp, `w${++n}`);
  const repo = path.join(dir, 'repo');
  fs.mkdirSync(path.join(repo, 'test'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'verify.mjs'), "import fs from 'node:fs';\nprocess.exit(Number(fs.readFileSync('verify.code', 'utf8')));\n");
  fs.writeFileSync(path.join(repo, 'verify.code'), '0');
  fs.writeFileSync(path.join(repo, 'app.js'), 'export const answer = 41;\n');
  fs.writeFileSync(path.join(repo, 'test', 'app.test.js'), '// existing test\n');
  process.env.AGENT_HUB_DATA = path.join(dir, 'data');
  saveConfig({ codingWorkspace: repo, verification: { mode } });
  return dir;
}

async function play(mode, { agent, script, approve }) {
  const dir = world(mode);
  setMockScript(script());
  const events = [];
  const messages = [];
  const asked = [];
  const result = await runAgent({
    agentId: agent,
    userText: 'go',
    messages,
    session: { id: 's_same_for_both', facts: [] },
    emit: (e) => events.push(e),
    approve: async (req) => {
      asked.push(req);
      return approve ? approve(req) : { allow: true };
    },
  });
  setMockScript(null);
  // Generated ids and the run's own directory are the only things allowed to differ by construction.
  const clean = (value) => JSON.parse(JSON.stringify(value).replaceAll(dir, '<dir>').replace(/\b(mock|lead|mem|fact)_[a-z0-9]+/g, '$1_<id>'));
  return { events: clean(events), messages: clean(messages), asked: clean(asked), text: result.text, verification: result.verification };
}

const call = (name, input) => ({ toolCalls: [{ name, input }] });
const write = (p, content = 'x') => call('write_file', { path: p, content });
const bash = (command) => call('bash', { command });

// Conversations that change nothing in the repository and run no check.
const UNTOUCHED = {
  'assistant writes and reads its own notes': { agent: 'assistant', script: () => [write('notes/a.txt', 'hello'), call('read_file', { path: 'notes/a.txt' }), { text: 'saved' }] },
  'bad tool calls come back as errors': { agent: 'assistant', script: () => [{ toolCalls: [{ name: 'write_file', input: { path: 'b.txt' } }, { name: 'nope', input: {} }] }, { text: 'ok' }] },
  'coding looks around': { agent: 'coding', script: () => [call('glob', { pattern: '**/*.js' }), call('grep', { pattern: 'answer' }), call('read_file', { path: 'app.js' }), bash('ls'), { text: 'looked' }] },
  'a refused command reaches the model': { agent: 'coding', script: () => [bash('echo hi'), { text: 'ok' }], approve: () => ({ allow: false, reason: 'not now' }) },
  'a destructive command is asked about even after a blanket approval': { agent: 'coding', script: () => [bash('echo one'), bash('rm -rf build'), bash('echo two'), { text: 'ok' }], approve: (req) => ({ allow: !/rm -rf/.test(req.input.command), always: true }) },
  'the assistant delegates and relays': { agent: 'assistant', script: () => [call('delegate', { agent: 'sales', task: 'list what we have' }), call('list_leads', {}), { text: 'none yet' }, { text: 'relayed' }] },
  'a tool call cut off at the token limit is not run': { agent: 'assistant', script: () => [{ stopReason: 'max_tokens', toolCalls: [{ name: 'write_file', input: { path: 'cut.txt', content: 'par' } }] }, { text: 'ok' }] },
  'pitch collects facts': { agent: 'pitch', script: () => [call('save_fact', { claim: 'Revenue grew 40%', source: 'user' }), { text: 'noted' }] },
  'sales saves a lead and drafts an email': {
    agent: 'sales',
    script: () => [
      call('save_lead', { company: 'Acme', domain: 'acme.com', score: 80, reasons: [{ text: 'Hiring', source: 'https://acme.com/careers' }] }),
      (messages) => call('draft_email', { lead_id: /lead_\w+/.exec(messages.at(-1).results[0].content)?.[0] || 'lead_x', subject: 'Hi', body: 'Hello' }),
      { text: 'drafted' },
    ],
  },
  'a plain answer': { agent: 'coding', script: () => [{ text: 'just an answer' }] },
};

for (const [name, scenario] of Object.entries(UNTOUCHED)) {
  test(`unchanged by the acceptance line: ${name}`, async () => {
    const before = await play('off', scenario);
    const after = await play('observe', scenario);
    assert.deepEqual(after, before);
    assert.equal(after.verification, null);
    assert.equal(after.events.some((e) => e.type === 'verification' || 'check' in e), false);
  });
}

// Conversations that do change files or run checks. Observe mode watches; it must not steer.
const WATCHED = {
  'an edit followed by a passing check': { agent: 'coding', script: () => [write('app.js', 'export const answer = 42;\n'), bash('node verify.mjs'), { text: 'done' }], stamp: 'verified' },
  'an edit with no check at all': { agent: 'coding', script: () => [write('app.js', 'export const answer = 42;\n'), { text: 'done' }], stamp: 'none' },
  'two failed rounds, then a fix and a pass': { agent: 'coding', script: () => [write('verify.code', '1'), bash('node verify.mjs'), bash('node verify.mjs'), write('verify.code', '0'), bash('node verify.mjs'), { text: 'fixed' }], stamp: 'verified' },
  'a failing check reported honestly': { agent: 'coding', script: () => [write('verify.code', '1'), bash('node verify.mjs'), { text: 'it fails' }], stamp: 'failed' },
  'editing an existing test asks in both modes': { agent: 'coding', script: () => [write('test/app.test.js', '// changed'), write('test/new.test.js'), write('app.js'), { text: 'ok' }], approve: () => ({ allow: true, always: true }), stamp: 'none' },
  'a deck with a problem, then a clean one': {
    agent: 'pitch',
    script: () => [
      call('write_deck', { title: 'Acme', slides: [{ layout: 'stats', title: 'Traction', stats: [{ value: '95%', label: 'retention' }] }] }),
      call('write_deck', { title: 'Acme', slides: [{ layout: 'cover', title: 'Acme' }] }),
      { text: 'built' },
    ],
    stamp: 'verified',
  },
};

const withoutWatching = (run) => ({ ...run, verification: undefined, events: run.events.filter((e) => e.type !== 'verification').map(({ check, ...e }) => e) });

for (const [name, scenario] of Object.entries(WATCHED)) {
  test(`observe mode only watches: ${name}`, async () => {
    const before = await play('off', scenario);
    const after = await play('observe', scenario);
    assert.equal(after.verification.status, scenario.stamp);
    assert.equal(after.events.filter((e) => e.type === 'verification').length, 1);
    assert.deepEqual(after.messages, before.messages, 'the model is sent exactly what it was sent before');
    assert.deepEqual(after.asked, before.asked, 'the user is asked exactly what they were asked before');
    assert.equal(after.text, before.text);
    assert.deepEqual(withoutWatching(after), withoutWatching(before));
  });
}
