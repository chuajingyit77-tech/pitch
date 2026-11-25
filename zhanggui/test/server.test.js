// The running server, end to end, in demo mode: scheduled runs and the lead follow-up actions over HTTP.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'zhanggui-server-'));
const repo = path.join(tmp, 'repo');
fs.mkdirSync(repo);
const port = 4500 + Math.floor(Math.random() * 400);
const base = `http://127.0.0.1:${port}`;
const child = spawn(process.execPath, ['server.js', '--demo'], { cwd: root, env: { ...process.env, PORT: String(port), ZHANGGUI_DATA: path.join(tmp, 'data') }, stdio: 'ignore' });
after(() => child.kill());

const api = async (p, body) => {
  const res = await fetch(base + p, body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : undefined);
  return { status: res.status, data: await res.json().catch(() => null) };
};
const until = async (fn, ms = 8000) => {
  for (const end = Date.now() + ms; Date.now() < end; ) {
    const v = await fn().catch(() => null);
    if (v) return v;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('timed out');
};
await until(async () => (await api('/api/state')).status === 200);

test('requests from another site or host are refused', async () => {
  const cross = await fetch(`${base}/api/config`, { method: 'POST', headers: { origin: 'https://evil.example', 'content-type': 'application/json' }, body: '{}' });
  assert.equal(cross.status, 403);
});

test('a scheduled task runs unattended, saves its result, and is marked unread', async () => {
  const made = await api('/api/schedules', { name: '每日线索', agent: 'sales', time: '09:00', days: 'daily', prompt: '找线索' });
  assert.equal(made.status, 200);
  const id = made.data.schedule.id;
  await api(`/api/schedules/${id}`, { action: 'run' });
  const done = await until(async () => {
    const s = (await api('/api/schedules')).data.schedules.find((x) => x.id === id);
    return s.lastStatus === 'ok' && !s.running ? s : null;
  });
  const listed = (await api('/api/state')).data.sessions.find((s) => s.id === done.lastSessionId);
  assert.equal(listed.title, '⏰ 每日线索');
  assert.equal(listed.unread, true);
  const session = (await api(`/api/sessions/${done.lastSessionId}`)).data;
  assert.ok(session.transcript.some((i) => i.type === 'tool' && i.name === 'draft_email'));
  assert.equal((await api('/api/state')).data.sessions.find((s) => s.id === done.lastSessionId).unread, false, 'opening it marks it read');
});

test('an unattended run declines anything that needs approval', async () => {
  await api('/api/config', { codingWorkspace: repo });
  const id = (await api('/api/schedules', { name: 'code', agent: 'coding', time: '09:00', days: 'daily', prompt: '看目录' })).data.schedule.id;
  await api(`/api/schedules/${id}`, { action: 'run' });
  const done = await until(async () => {
    const s = (await api('/api/schedules')).data.schedules.find((x) => x.id === id);
    return s.lastStatus && s.lastStatus !== 'running' && !s.running ? s : null;
  });
  const { transcript } = (await api(`/api/sessions/${done.lastSessionId}`)).data;
  const bash = transcript.find((i) => i.type === 'tool' && i.name === 'bash');
  assert.equal(bash.isError, true);
  assert.match(bash.result, /declined.*unattended/);
  assert.ok(transcript.some((i) => i.type === 'notice' && /无人值守/.test(i.text)));
});

test('lead lifecycle over the API: approve, mark sent, follow-up schedule, reply', async () => {
  let { leads } = (await api('/api/leads')).data;
  const lead = leads[0];
  assert.equal(lead.status, 'pending');
  assert.equal((await api('/api/state')).data.salesTodo, 1);
  assert.equal((await api(`/api/leads/${lead.id}`, { action: 'sent' })).data.lead.status, 'pending', 'cannot be marked sent before it is approved');
  await api(`/api/leads/${lead.id}`, { action: 'approve', subject: 'Edited subject' });
  const sent = (await api(`/api/leads/${lead.id}`, { action: 'sent' })).data.lead;
  assert.equal(sent.status, 'sent');
  assert.equal(sent.draft.subject, 'Edited subject');
  ({ leads } = (await api('/api/leads')).data);
  const days = (leads[0].followupDueAt - Date.parse(leads[0].sentAt)) / 86_400_000;
  assert.equal(days, 3);
  assert.equal(leads[0].followupDue, false);
  assert.equal((await api('/api/state')).data.salesTodo, 0);
  assert.equal((await api(`/api/leads/${lead.id}`, { action: 'replied' })).data.lead.status, 'replied');
  assert.equal((await api('/api/leads')).data.leads[0].followupDueAt, null);
});

test('saving to the library over the API: a deck snapshot is filed, served, moved and deleted', async () => {
  // Build a deck first, reading the whole stream so the run has finished.
  const res = await fetch(`${base}/api/chat`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ agent: 'pitch', text: '做一份 pitch' }) });
  const events = (await res.text()).trim().split('\n').map((l) => JSON.parse(l));
  const sessionId = events.find((e) => e.type === 'session').id;
  assert.ok(events.some((e) => e.type === 'deck'));

  assert.equal((await api('/api/library', { kind: 'deck', sessionId: 's_missing' })).status, 400);
  const saved = await api('/api/library', { kind: 'deck', sessionId });
  assert.equal(saved.status, 200);
  const { item } = saved.data;
  assert.deepEqual([item.kind, item.folder, item.title, item.filedBy], ['deck', 'Pitch', '演示 Pitch', 'rule']);
  const page = await fetch(base + item.url);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /class="slide slide-cover"/);
  assert.equal((await api('/api/library', { kind: 'deck', sessionId })).data.duplicate, true);

  const note = (await api('/api/library', { kind: 'note', sessionId, text: '## 给投资人的三句话\n\n我们让小团队也有一支 AI 客服。' })).data.item;
  assert.deepEqual([note.folder, note.title], ['笔记', '给投资人的三句话']);
  assert.match((await api(`/api/library/${note.id}`)).data.text, /AI 客服/);

  const moved = (await api(`/api/library/${item.id}`, { action: 'move', folder: 'Pitch/投资人' })).data.item;
  assert.equal(moved.folder, 'Pitch/投资人');
  assert.equal((await fetch(base + moved.url)).status, 200);
  assert.equal((await fetch(base + item.url)).status, 404);
  assert.equal((await api('/api/library')).data.items.length, 2);
  assert.equal((await api(`/api/library/${note.id}`, { action: 'delete' })).status, 200);
  assert.equal((await api('/api/library')).data.items.length, 1);
});
