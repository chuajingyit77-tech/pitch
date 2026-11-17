import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-hub-test-'));
process.env.AGENT_HUB_DATA = path.join(tmp, 'data');
process.env.AGENT_HUB_MOCK = '1';
const repo = path.join(tmp, 'repo');
fs.mkdirSync(repo);

const { runAgent, validateInput } = await import('../src/loop.js');
const { setMockScript } = await import('../src/llm/mock.js');
const { saveConfig } = await import('../src/config.js');
const { hubWorkspace } = await import('../src/store.js');
const { confine } = await import('../src/tools/files.js');
const { isDestructive } = await import('../src/tools/bash.js');
const { salesTools, listLeads, suppress, updateLead } = await import('../src/tools/sales.js');
const { reviewDeck, renderDeck } = await import('../src/deck.js');
const { webTools } = await import('../src/tools/web.js');
const { applyEvent } = await import('../public/reduce.js');

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
    session: session || { id: 's_test', facts: [] },
    emit: (e) => events.push(e),
    approve: async (req) => {
      asked.push(req);
      return approve ? approve(req) : { allow: true };
    },
  }).then((result) => ({ result, events, messages, asked }));
}
const toolResults = (messages) => messages.filter((m) => m.role === 'tool').flatMap((m) => m.results);

test('loop runs a tool, feeds the result back, and returns the final text', async () => {
  const { result, messages, asked } = await run('assistant', [
    { text: 'writing', toolCalls: [{ name: 'write_file', input: { path: 'notes/a.txt', content: 'hello' } }] },
    { text: 'done' },
  ]);
  assert.equal(result.text, 'done');
  assert.equal(fs.readFileSync(path.join(hubWorkspace(), 'notes/a.txt'), 'utf8'), 'hello');
  assert.equal(asked.length, 0, 'writes inside the hub sandbox need no approval');
  assert.equal(toolResults(messages)[0].isError, false);
});

test('coding agent asks before editing and before running a command; a refusal reaches the model', async () => {
  const { messages, asked } = await run(
    'coding',
    [
      { toolCalls: [{ name: 'write_file', input: { path: 'x.txt', content: '1' } }] },
      { toolCalls: [{ name: 'bash', input: { command: 'echo hi' } }] },
      { text: 'ok' },
    ],
    { approve: (req) => ({ allow: req.tool !== 'bash', reason: 'not now' }) },
  );
  assert.deepEqual(asked.map((a) => a.tool), ['write_file', 'bash']);
  assert.ok(fs.existsSync(path.join(repo, 'x.txt')));
  const [, bash] = toolResults(messages);
  assert.equal(bash.isError, true);
  assert.match(bash.content, /declined.*not now/);
});

test('"always allow" covers later commands but never a destructive one', async () => {
  const { asked, messages } = await run(
    'coding',
    [
      { toolCalls: [{ name: 'bash', input: { command: 'echo one' } }] },
      { toolCalls: [{ name: 'bash', input: { command: 'echo two' } }] },
      { toolCalls: [{ name: 'bash', input: { command: 'rm -rf build' } }] },
      { text: 'ok' },
    ],
    { approve: (req) => ({ allow: !/rm -rf/.test(req.input.command), always: true }) },
  );
  assert.deepEqual(asked.map((a) => a.input.command), ['echo one', 'rm -rf build']);
  assert.match(toolResults(messages)[1].content, /two[\s\S]*exit code 0/);
  assert.equal(toolResults(messages)[2].isError, true);
  assert.ok(isDestructive('git push origin main --force') && isDestructive('git reset --hard HEAD~1') && !isDestructive('npm test'));
});

test('file paths cannot leave the workspace, directly or through a symlink', () => {
  assert.throws(() => confine(repo, '../outside.txt'), /outside/);
  assert.throws(() => confine(repo, '/etc/passwd'), /outside/);
  fs.symlinkSync(os.tmpdir(), path.join(repo, 'link'));
  assert.throws(() => confine(repo, 'link/escape.txt'), /outside/);
  assert.equal(confine(repo, 'src/new.js'), path.join(fs.realpathSync(repo), 'src/new.js'));
});

test('invalid or unknown tool calls come back as errors instead of running', async () => {
  const { messages } = await run('assistant', [
    { toolCalls: [{ name: 'write_file', input: { path: 'b.txt' } }, { name: 'nope', input: {} }, { name: 'bash', input: { command: 'echo x' } }] },
    { text: 'ok' },
  ]);
  const [missing, unknown, notMine] = toolResults(messages);
  assert.match(missing.content, /content is required/);
  assert.match(unknown.content, /Unknown tool/);
  assert.match(notMine.content, /Unknown tool/, 'the assistant has no shell');
  assert.equal(validateInput({ type: 'object', properties: { n: { type: 'integer' } } }, { n: 'x' }), 'input.n should be integer');
});

test('a tool call cut off at the token limit is not executed', async () => {
  const { messages } = await run('assistant', [
    { stopReason: 'max_tokens', toolCalls: [{ name: 'write_file', input: { path: 'cut.txt', content: 'par' } }] },
    { text: 'ok' },
  ]);
  assert.equal(fs.existsSync(path.join(hubWorkspace(), 'cut.txt')), false);
  assert.equal(toolResults(messages)[0].isError, true);
});

test('sales: leads need sourced reasons, are deduplicated, and the do-not-contact list is enforced', async () => {
  const [saveLead, draftEmail] = salesTools;
  const reason = { text: 'Hiring ops staff', source: 'https://acme.com/careers' };
  await assert.rejects(saveLead.run({ company: 'Acme', domain: 'acme.com', score: 80, reasons: [{ text: 'x', source: 'trust me' }] }), /source URL/);
  await saveLead.run({ company: 'Acme', domain: 'https://www.acme.com/about', score: 80, reasons: [reason] });
  await saveLead.run({ company: 'Acme Inc', domain: 'acme.com', score: 90, reasons: [reason] });
  assert.equal(listLeads().length, 1);
  const lead = listLeads()[0];
  assert.equal(lead.score, 90);
  await draftEmail.run({ lead_id: lead.id, subject: 'Hi', body: 'Hello' });
  assert.equal(listLeads()[0].status, 'pending', 'a draft waits for the user; nothing is sent');
  suppress('acme.com');
  assert.match(await draftEmail.run({ lead_id: lead.id, subject: 'Again', body: 'Hello again' }), /do-not-contact/);
  assert.equal(listLeads()[0].draft.subject, 'Hi');
  assert.match(await saveLead.run({ company: 'Acme', domain: 'acme.com', score: 99, reasons: [reason] }), /do-not-contact/);
  updateLead(lead.id, { status: 'rejected' });
});

test('deck: unsourced numbers are flagged and badged; sourced ones pass; text is escaped', () => {
  const deck = {
    title: 'T',
    slides: [
      { layout: 'cover', title: '<script>alert(1)</script>' },
      { layout: 'stats', title: 'Growth in 2025', stats: [{ value: '40%', label: 'monthly growth' }, { value: '1,200', label: 'customers' }] },
      { layout: 'bullets', title: '3 steps', bullets: ['one', 'two', 'three'] },
    ],
  };
  const none = reviewDeck(deck, []);
  assert.deepEqual(none.unverified[1].sort(), ['1200', '40']);
  assert.equal(none.unverified[2], undefined, 'years and small counts are not treated as claims');
  const facts = [{ claim: 'Grew 40% month over month', source: 'https://a.com' }, { claim: 'Has 1,200 customers', source: 'user' }];
  assert.equal(reviewDeck(deck, facts).warnings.length, 0);
  const html = renderDeck(deck, []);
  assert.ok(html.includes('待确认') && !html.includes('<script>alert(1)</script>') && html.includes('&lt;script&gt;'));
  assert.ok(!renderDeck(deck, facts).includes('class="flag"'));
  const long = reviewDeck({ title: 'T', slides: [{ layout: 'bullets', title: 'x', bullets: Array(8).fill('b') }] }, []);
  assert.match(long.warnings[0], /at most 6/);
});

test('pitch agent writes a deck file and reports what still needs a source', async () => {
  const session = { id: 's_pitch', facts: [] };
  const { messages, events } = await run(
    'pitch',
    [
      { toolCalls: [{ name: 'save_fact', input: { claim: 'Revenue grew 40% in a year', source: 'user' } }] },
      { toolCalls: [{ name: 'write_deck', input: { title: 'Acme', slides: [{ layout: 'cover', title: 'Acme' }, { layout: 'stats', title: 'Traction', stats: [{ value: '40%', label: 'growth' }, { value: '95%', label: 'retention' }] }] } }] },
      { text: 'built' },
    ],
    { session },
  );
  const deckEvent = events.find((e) => e.type === 'deck');
  assert.ok(deckEvent && fs.existsSync(path.join(hubWorkspace(), 'decks', session.deckFile)));
  const report = toolResults(messages)[1].content;
  assert.match(report, /numbers 95 are not in the fact sheet/);
  assert.doesNotMatch(report, /numbers 40/);
});

test('the assistant can delegate to another agent, which shares the approval channel', async () => {
  const { result, events, messages } = await run('assistant', [
    { toolCalls: [{ name: 'delegate', input: { agent: 'sales', task: 'list what we have' } }] },
    { toolCalls: [{ name: 'list_leads', input: {} }] },
    { text: 'one rejected lead' },
    { text: 'relayed' },
  ]);
  assert.equal(result.text, 'relayed');
  assert.equal(toolResults(messages)[0].content, 'one rejected lead');
  assert.ok(events.some((e) => e.type === 'start' && e.agent === 'sales' && e.depth === 1));
});

test('web_fetch refuses local and private addresses', async () => {
  const fetchTool = webTools[1];
  for (const url of ['http://localhost:4317/api/state', 'http://127.0.0.1/', 'http://192.168.1.1/', 'http://169.254.169.254/latest', 'file:///etc/passwd']) {
    await assert.rejects(fetchTool.run({ url }, {}), /cannot be fetched|Only http/);
  }
});

test('the transcript reducer groups streamed text and pairs tools with results', () => {
  const items = [];
  for (const ev of [
    { type: 'user', text: 'hi' },
    { type: 'text', agent: 'a', delta: 'he' },
    { type: 'text', agent: 'a', delta: 'llo' },
    { type: 'text_end', agent: 'a' },
    { type: 'tool', agent: 'a', id: 't1', name: 'x', input: {} },
    { type: 'tool_result', id: 't1', content: 'r', isError: false },
    { type: 'text', agent: 'a', delta: 'bye' },
    { type: 'done' },
  ]) applyEvent(items, ev);
  assert.deepEqual(items.map((i) => i.type), ['user', 'text', 'tool', 'text']);
  assert.equal(items[1].text, 'hello');
  assert.equal(items[2].result, 'r');
  assert.equal(items[3].open, false);
});
