// End-to-end tests: the real server in its own process, driven over HTTP the way the web page drives it.
// Demo mode supplies a scripted model, so every flow runs without a key. These are the tests that are hard
// to fool: either the whole path works (request, agent loop, tools, approval, files on disk) or it does not.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const hub = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const data = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-hub-e2e-'));
const repo = path.join(data, 'repo');
fs.mkdirSync(repo);
fs.writeFileSync(path.join(repo, 'hello.txt'), 'hi\n');

let server;
let base;
let port;

const freePort = () =>
  new Promise((resolve) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => {
      const p = s.address().port;
      s.close(() => resolve(p));
    });
  });

before(async () => {
  port = await freePort();
  base = `http://127.0.0.1:${port}`;
  server = spawn(process.execPath, ['server.js', '--demo'], { cwd: hub, env: { ...process.env, PORT: String(port), AGENT_HUB_DATA: data }, stdio: ['ignore', 'pipe', 'pipe'] });
  await new Promise((resolve, reject) => {
    let out = '';
    const timer = setTimeout(() => reject(new Error(`server did not start: ${out}`)), 15000);
    const seen = (d) => {
      out += d;
      if (out.includes('已启动')) {
        clearTimeout(timer);
        resolve();
      }
    };
    server.stdout.on('data', seen);
    server.stderr.on('data', seen);
    server.on('exit', (code) => reject(new Error(`server exited early (${code}): ${out}`)));
  });
});

after(() => server?.kill());

const json = (p, body, headers = {}) =>
  fetch(base + p, { method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json', ...headers }, body: body ? JSON.stringify(body) : undefined }).then(async (r) => ({ status: r.status, headers: r.headers, body: await r.json().catch(() => null) }));

/** Send one chat message and read the event stream to its end, answering approval requests on the way. */
async function chat(agent, text, { approve = () => ({ allow: true }), sessionId } = {}) {
  const res = await fetch(`${base}/api/chat`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ agent, text, sessionId }) });
  assert.equal(res.status, 200);
  const events = [];
  const decoder = new TextDecoder();
  let buf = '';
  for await (const chunk of res.body) {
    buf += decoder.decode(chunk, { stream: true });
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl);
      buf = buf.slice(nl + 1);
      if (!line) continue;
      const ev = JSON.parse(line);
      events.push(ev);
      if (ev.type === 'approval') await json('/api/approve', { id: ev.id, ...approve(ev) });
    }
  }
  return events;
}
const of = (events, type) => events.filter((e) => e.type === type);

/** A request sent exactly as written: no client-side cleanup of the path, and any Host header. */
const raw = (p, headers = {}) =>
  new Promise((resolve, reject) => {
    http
      .get({ host: '127.0.0.1', port, path: p, headers }, (res) => {
        let body = '';
        res.on('data', (d) => (body += d));
        res.on('end', () => resolve({ status: res.statusCode, body }));
      })
      .on('error', reject);
  });

test('the app starts with its four agents, on the scripted model, with the gate in observe mode', async () => {
  const { status, body } = await json('/api/state');
  assert.equal(status, 200);
  assert.deepEqual(body.agents.map((a) => a.id), ['assistant', 'pitch', 'sales', 'coding']);
  assert.equal(body.mock, true);
  assert.equal(body.config.verification.mode, 'observe');
  const page = await fetch(base + '/');
  assert.equal(page.status, 200);
  assert.match(await page.text(), /<title>Agent Hub<\/title>/);
});

test('pitch: a brief becomes a deck that opens, the unsourced number is flagged, and the run is stamped', async () => {
  const events = await chat('pitch', '演示');
  const [deck] = of(events, 'deck');
  assert.ok(deck, 'a deck was produced');
  const file = await fetch(base + deck.url);
  assert.equal(file.status, 200);
  assert.match(file.headers.get('content-security-policy'), /sandbox/, 'agent-written pages cannot reach the API');
  const html = await file.text();
  assert.match(html, /演示 Pitch/);
  assert.match(html, /待确认/, 'the 95% figure has no source and is marked on the slide');
  const [stamp] = of(events, 'verification');
  assert.equal(stamp.status, 'failed');
  assert.deepEqual(stamp.checks, [{ label: 'Pitch 自检', pass: false, rounds: 1 }]);
  assert.equal(of(events, 'tool_result').find((e) => e.name === 'write_deck').check, 'fail');
  assert.equal(events.at(-1).type, 'done');
  const record = (await json('/api/verification')).body;
  assert.equal(record.recent[0].agent, 'pitch');
  assert.equal(record.summary.failed, 1);
  // The conversation is saved with its stamp and reopens with it.
  const session = of(events, 'session')[0];
  const saved = (await json(`/api/sessions/${session.id}`)).body;
  assert.equal(saved.transcript.at(-1).type, 'verification');
  assert.equal(saved.deckUrl, deck.url);
});

test('coding: a command waits for approval, runs once approved, and a refusal reaches the agent instead', async () => {
  assert.equal((await json('/api/config', { codingWorkspace: repo })).body.config.codingWorkspace, repo);
  const allowed = await chat('coding', '演示');
  assert.deepEqual(of(allowed, 'approval').map((e) => [e.tool, e.input.command]), [['bash', 'ls']]);
  const ran = of(allowed, 'tool_result')[0];
  assert.match(ran.content, /hello\.txt[\s\S]*\[exit code 0\]/, 'the command really ran in the workspace');
  assert.equal(of(allowed, 'verification').length, 0, 'looking around is not a change, so there is nothing to stamp');

  const refused = await chat('coding', '演示', { approve: () => ({ allow: false, reason: 'not now' }) });
  const declined = of(refused, 'tool_result')[0];
  assert.equal(declined.isError, true);
  assert.match(declined.content, /declined.*not now/);
});

test('sales: a lead and its draft wait for the user; approving changes its status and nothing is sent', async () => {
  await chat('sales', '演示');
  const { leads } = (await json('/api/leads')).body;
  assert.equal(leads.length, 1);
  const lead = leads[0];
  assert.equal(lead.status, 'pending');
  assert.ok(lead.draft.subject && lead.reasons.every((r) => /^https?:\/\//.test(r.source)), 'the draft exists and every reason cites a page');
  const approved = (await json(`/api/leads/${lead.id}`, { action: 'approve' })).body.lead;
  assert.equal(approved.status, 'approved');
  assert.equal('sentAt' in approved, false, 'approval hands the email to the user; the system has no way to send it');
  await json(`/api/leads/${lead.id}`, { action: 'suppress' });
  assert.ok((await json('/api/leads')).body.suppressed.includes(lead.domain));
  const csv = await fetch(`${base}/api/leads.csv`);
  assert.match(await csv.text(), /示例电商/);
});

test('assistant: a file it writes lands in the sandbox and is served from there', async () => {
  const events = await chat('assistant', '演示');
  assert.equal(of(events, 'approval').length, 0);
  assert.equal(fs.readFileSync(path.join(data, 'workspace', 'demo.txt'), 'utf8'), 'hello from demo mode\n');
  const file = await fetch(`${base}/files/demo.txt`);
  assert.equal(await file.text(), 'hello from demo mode\n');
  // The files route serves the sandbox and nothing above it, however the path is spelled.
  for (const p of ['/files/..%2fconfig.json', '/files/..%2F..%2Fpackage.json', '/files/%2e%2e%2fconfig.json']) {
    const res = await raw(p);
    assert.equal(res.status, 403, p);
    assert.doesNotMatch(res.body, /providers|agent-hub/);
  }
});

test("only this machine's own pages may call the server", async () => {
  assert.equal((await json('/api/state', null, { origin: 'https://evil.example' })).status, 403);
  assert.equal((await json('/api/config', { braveKey: 'x' }, { 'sec-fetch-site': 'cross-site' })).status, 403);
  assert.equal((await json('/api/state', null, { origin: `http://127.0.0.1:${port}` })).status, 200);
  // A request that reaches the port under another host name (DNS rebinding) is refused as well.
  assert.equal((await raw('/api/state', { host: 'evil.example' })).status, 403);
  assert.equal((await raw('/api/state', { host: `localhost:${port}` })).status, 200);
});

test('the browser never receives an API key', async () => {
  const secret = 'sk-test-DO-NOT-LEAK-9876';
  const saved = await json('/api/config', { providers: { openai: { apiKey: secret, model: 'some-model' } } });
  assert.equal(saved.status, 200);
  assert.equal(saved.body.config.providers.openai.keyHint, '…9876');
  for (const p of ['/api/state', '/api/verification', '/api/leads', '/api/memory']) {
    const text = await (await fetch(base + p)).text();
    assert.equal(text.includes(secret), false, `${p} must not contain the key`);
  }
  assert.ok(fs.readFileSync(path.join(data, 'config.json'), 'utf8').includes(secret), 'the key is kept on this machine only');
  await json('/api/config', { providers: { openai: { apiKey: '', model: '' } } });
});

test('the gate setting is saved through the settings API and ignores a value it does not know', async () => {
  assert.equal((await json('/api/config', { verification: { mode: 'enforce' } })).body.config.verification.mode, 'enforce');
  assert.equal((await json('/api/config', { verification: { mode: 'whatever' } })).body.config.verification.mode, 'enforce');
  assert.equal((await json('/api/verification')).body.mode, 'enforce');
  assert.equal((await json('/api/config', { verification: { mode: 'observe' } })).body.config.verification.mode, 'observe');
});
