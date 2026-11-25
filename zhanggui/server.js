// Zhanggui (掌柜) server: serves the web interface and runs the agents. Listens on this machine only.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AGENTS, publicAgents } from './src/agents.js';
import { loadConfig, saveConfig, publicConfig, resolveProvider, PROVIDERS, apiKeyFor } from './src/config.js';
import { createProvider } from './src/llm/index.js';
import { runAgent } from './src/loop.js';
import { dataPath, hubWorkspace, newId, readJson, writeJson } from './src/store.js';
import { confine } from './src/tools/files.js';
import { listLeads, updateLead, suppress, listSuppressed, salesTodo, followupDueAt } from './src/tools/sales.js';
import { listSchedules, createSchedule, updateSchedule, deleteSchedule, isDue } from './src/schedules.js';
import { listMemories, deleteMemory } from './src/tools/memory.js';
import { saveToLibrary, libraryItems, readItem, moveItem, deleteItem } from './src/library.js';
import { applyEvent } from './public/reduce.js';

// `node server.js --demo` runs with a scripted stand-in model, so the interface can be tried without any key.
if (process.argv.includes('--demo')) process.env.ZHANGGUI_MOCK = '1';

const here = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 4317;
// `--preview` is for a hosted preview pane that reaches the server through a proxy: it listens on every
// interface and skips the same-machine check. Never use it on a computer that holds real keys on an open network.
const PREVIEW = process.argv.includes('--preview');
const HOST = PREVIEW ? '0.0.0.0' : '127.0.0.1';

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.txt': 'text/plain; charset=utf-8', '.md': 'text/plain; charset=utf-8', '.csv': 'text/csv; charset=utf-8' };

const running = new Map(); // sessionId -> { abort }
const approvals = new Map(); // approvalId -> resolve

const sessionFile = (id) => `sessions/${id.replace(/[^a-z0-9_]/gi, '')}.json`;
const loadSession = (id) => readJson(sessionFile(id), null);
const saveSession = (s) => writeJson(sessionFile(s.id), { ...s, updatedAt: new Date().toISOString() });

function listSessions() {
  const dir = path.dirname(dataPath('sessions', 'x'));
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => readJson(`sessions/${f}`, null))
    .filter(Boolean)
    .map(({ id, agent, title, updatedAt, unread }) => ({ id, agent, title, updatedAt, unread: Boolean(unread) }))
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
}

function send(res, status, body, headers = {}) {
  const isJson = typeof body !== 'string' && !Buffer.isBuffer(body);
  res.writeHead(status, { 'content-type': isJson ? 'application/json' : 'text/plain; charset=utf-8', 'cache-control': 'no-store', ...headers });
  res.end(isJson ? JSON.stringify(body) : body);
}

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > 2_000_000) throw new Error('Request too large');
    chunks.push(c);
  }
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};
}

/** Only this machine's own browser may talk to the server: it can run commands and holds API keys. */
function allowed(req) {
  if (PREVIEW) return true;
  const host = String(req.headers.host || '').replace(/:\d+$/, '');
  if (!['localhost', '127.0.0.1', '[::1]'].includes(host)) return false;
  const origin = req.headers.origin;
  if (origin) {
    try {
      if (new URL(origin).host !== req.headers.host) return false;
    } catch {
      return false;
    }
  } else if (req.method !== 'GET' && req.headers['sec-fetch-site'] && req.headers['sec-fetch-site'] !== 'same-origin') {
    return false;
  }
  return true;
}

function state() {
  const cfg = loadConfig();
  const resolved = {};
  for (const id of Object.keys(AGENTS)) resolved[id] = resolveProvider(cfg, id);
  return { agents: publicAgents(), config: publicConfig(cfg), resolved, sessions: listSessions(), salesTodo: salesTodo(), mock: process.env.ZHANGGUI_MOCK === '1' };
}

async function chat(req, res) {
  const { sessionId, agent: agentId, text } = await readBody(req);
  if (!AGENTS[agentId]) return send(res, 400, { error: 'Unknown agent' });
  if (!String(text || '').trim()) return send(res, 400, { error: 'Empty message' });
  let session = sessionId ? loadSession(sessionId) : null;
  if (!session) {
    session = { id: newId('s'), agent: agentId, title: String(text).trim().slice(0, 40), createdAt: new Date().toISOString(), messages: [], transcript: [], facts: [] };
  }
  if (running.has(session.id)) return send(res, 409, { error: '这个对话正在运行中' });

  res.writeHead(200, { 'content-type': 'application/x-ndjson; charset=utf-8', 'cache-control': 'no-store', 'x-accel-buffering': 'no' });
  const abort = new AbortController();
  running.set(session.id, { abort });
  const pending = new Set();
  const emit = (ev) => {
    applyEvent(session.transcript, ev);
    if (ev.type === 'deck') session.deckUrl = ev.url;
    if (!res.writableEnded) res.write(`${JSON.stringify(ev)}\n`);
    if (ev.type === 'tool_result') saveSession(session);
  };
  const approve = (request) =>
    new Promise((resolve) => {
      const id = newId('ap');
      pending.add(id);
      approvals.set(id, (decision) => {
        pending.delete(id);
        approvals.delete(id);
        emit({ type: 'approval_done', id, allow: Boolean(decision.allow) });
        resolve(decision);
      });
      emit({ type: 'approval', id, ...request });
    });
  // Closing the page stops the run: nothing keeps acting with nobody watching.
  res.on('close', () => {
    if (!res.writableEnded) abort.abort();
    for (const id of pending) approvals.get(id)?.({ allow: false, reason: 'the user left the page' });
  });

  emit({ type: 'session', id: session.id, title: session.title });
  emit({ type: 'user', text });
  try {
    await runAgent({ agentId: session.agent, userText: text, messages: session.messages, session, emit, approve, signal: abort.signal });
  } catch (e) {
    emit({ type: 'error', text: abort.signal.aborted ? '已停止。' : e.message || String(e) });
    emit({ type: 'done' });
  } finally {
    running.delete(session.id);
    saveSession(session);
    res.end();
  }
}

/**
 * Run a scheduled task with nobody watching. Anything that would need the user's approval is declined,
 * so an unattended run can research, draft and build, but cannot edit a repository or run a command.
 */
async function runScheduled(task) {
  const session = { id: newId('s'), agent: task.agent, title: `⏰ ${task.name}`, createdAt: new Date().toISOString(), messages: [], transcript: [], facts: [], unread: true, scheduleId: task.id };
  const abort = new AbortController();
  running.set(session.id, { abort });
  updateSchedule(task.id, { lastRunAt: new Date().toISOString(), lastSessionId: session.id, lastStatus: 'running' });
  const emit = (ev) => {
    applyEvent(session.transcript, ev);
    if (ev.type === 'deck') session.deckUrl = ev.url;
  };
  const approve = async (request) => {
    emit({ type: 'notice', text: `定时任务无人值守，已跳过需要你确认的操作：${request.tool}` });
    return { allow: false, reason: 'this is an unattended scheduled run, so nobody can approve. Skip this action and say in your report that it needs the user.' };
  };
  let status = 'ok';
  emit({ type: 'user', text: task.prompt });
  try {
    await runAgent({ agentId: task.agent, userText: task.prompt, messages: session.messages, session, emit, approve, signal: abort.signal });
  } catch (e) {
    status = 'failed';
    emit({ type: 'error', text: e.message || String(e) });
    emit({ type: 'done' });
  } finally {
    running.delete(session.id);
    saveSession(session);
    updateSchedule(task.id, { lastStatus: status });
  }
  return session.id;
}

const scheduleBusy = new Set();
function tick() {
  for (const task of listSchedules()) {
    if (scheduleBusy.has(task.id) || !isDue(task)) continue;
    scheduleBusy.add(task.id);
    runScheduled(task).catch(() => {}).finally(() => scheduleBusy.delete(task.id));
  }
}

/** Save what the user is happy with: the current deck of a conversation, or a piece of text. */
async function saveWork(body) {
  const session = body.sessionId ? loadSession(String(body.sessionId)) : null;
  if (body.kind === 'deck') {
    if (!session?.deckFile) return [400, { error: '这个对话里还没有生成 pitch' }];
    const file = path.join(hubWorkspace(), 'decks', session.deckFile);
    if (!fs.existsSync(file)) return [400, { error: '找不到这份 pitch 的文件' }];
    const title = session.transcript.findLast((i) => i.type === 'deck')?.title || session.title;
    return [200, await saveToLibrary({ kind: 'deck', title, content: fs.readFileSync(file, 'utf8'), agent: session.agent, sessionId: session.id })];
  }
  if (body.kind === 'note') {
    const text = String(body.text || '');
    if (!text.trim()) return [400, { error: '没有可以保存的内容' }];
    if (text.length > 200_000) return [400, { error: '内容太长，无法保存' }];
    // A heading names the text itself; otherwise what the user asked for is the best short name for it.
    const first = text.split('\n').find((l) => l.trim()) || '';
    const plain = first.replace(/^[#>*\-\s]+/, '').replace(/[*`]/g, '');
    const title = first.trim().startsWith('#') ? plain : session?.title || plain.split(/[。！？.!?：:]/)[0].slice(0, 24);
    return [200, await saveToLibrary({ kind: 'note', title, content: text, agent: session?.agent || '', sessionId: session?.id || '' })];
  }
  return [400, { error: 'Unknown kind' }];
}

function leadsCsv() {
  const cell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const rows = [['company', 'domain', 'contact', 'role', 'email', 'score', 'status', 'subject', 'body', 'reasons']];
  for (const l of listLeads()) {
    rows.push([l.company, l.domain, l.contactName, l.contactRole, l.email, l.score, l.status, l.draft?.subject, l.draft?.body, l.reasons.map((r) => `${r.text} (${r.source})`).join(' | ')]);
  }
  return '﻿' + rows.map((r) => r.map(cell).join(',')).join('\n');
}

async function leadAction(id, body) {
  const lead = listLeads().find((l) => l.id === id);
  if (!lead) return null;
  if (body.action === 'approve') return updateLead(id, { status: 'approved', draft: { ...lead.draft, subject: body.subject ?? lead.draft?.subject, body: body.body ?? lead.draft?.body }, approvedAt: new Date().toISOString() });
  const now = new Date().toISOString();
  // The user tells the system what happened outside it: the email went out, a follow-up went out, a reply came.
  if (body.action === 'sent' && lead.status === 'approved') return updateLead(id, { status: 'sent', sentAt: now, lastTouchAt: now, followupsSent: 0 });
  if (body.action === 'followup_sent' && lead.status === 'sent') return updateLead(id, { followupsSent: (lead.followupsSent || 0) + 1, lastTouchAt: now });
  if (body.action === 'replied' && lead.status === 'sent') return updateLead(id, { status: 'replied', repliedAt: now });
  if (body.action === 'reject') return updateLead(id, { status: 'rejected', rejectReason: String(body.reason || '').slice(0, 300) });
  if (body.action === 'suppress') {
    suppress(lead.domain);
    if (lead.email) suppress(lead.email);
    return updateLead(id, { status: 'rejected', rejectReason: 'do not contact' });
  }
  return lead;
}

function serveFile(res, file, extraHeaders = {}) {
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return send(res, 404, 'Not found');
  res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', ...extraHeaders });
  fs.createReadStream(file).pipe(res);
}

const server = http.createServer(async (req, res) => {
  try {
    if (!allowed(req)) return send(res, 403, { error: 'Forbidden' });
    const url = new URL(req.url, `http://${req.headers.host}`);
    const p = decodeURIComponent(url.pathname);
    const m = req.method;

    if (m === 'GET' && p === '/api/state') return send(res, 200, state());
    if (m === 'POST' && p === '/api/config') {
      saveConfig(await readBody(req));
      return send(res, 200, state());
    }
    if (m === 'GET' && p === '/api/models') {
      const id = url.searchParams.get('provider');
      const cfg = loadConfig();
      if (!PROVIDERS[id]) return send(res, 400, { error: 'Unknown provider' });
      if (!apiKeyFor(cfg, id)) return send(res, 400, { error: '请先保存这家的 API key' });
      try {
        return send(res, 200, { models: await createProvider(cfg, id).listModels() });
      } catch (e) {
        return send(res, 502, { error: `无法获取模型列表：${e.message}` });
      }
    }
    if (m === 'POST' && p === '/api/chat') return await chat(req, res);
    if (m === 'POST' && p === '/api/approve') {
      const body = await readBody(req);
      const resolve = approvals.get(body.id);
      if (!resolve) return send(res, 404, { error: 'No such pending approval' });
      resolve({ allow: Boolean(body.allow), always: Boolean(body.always), reason: body.reason });
      return send(res, 200, { ok: true });
    }
    if (m === 'POST' && p === '/api/stop') {
      const { sessionId } = await readBody(req);
      running.get(sessionId)?.abort.abort();
      return send(res, 200, { ok: true });
    }
    const sess = /^\/api\/sessions\/([\w]+)$/.exec(p);
    if (sess && m === 'GET') {
      const s = loadSession(sess[1]);
      if (s?.unread && !running.has(s.id)) saveSession({ ...s, unread: false });
      return s ? send(res, 200, { id: s.id, agent: s.agent, title: s.title, transcript: s.transcript, deckUrl: s.deckUrl || null, running: running.has(s.id) }) : send(res, 404, { error: 'Not found' });
    }
    if (sess && m === 'DELETE') {
      fs.rmSync(dataPath(sessionFile(sess[1])), { force: true });
      return send(res, 200, { ok: true });
    }
    if (m === 'GET' && p === '/api/leads') {
      const now = Date.now();
      const leads = listLeads().map((l) => ({ ...l, followupDueAt: followupDueAt(l), followupDue: followupDueAt(l) !== null && now >= followupDueAt(l) }));
      return send(res, 200, { leads, suppressed: listSuppressed() });
    }
    if (m === 'GET' && p === '/api/schedules') return send(res, 200, { schedules: listSchedules().map((s) => ({ ...s, running: scheduleBusy.has(s.id) })) });
    if (m === 'POST' && p === '/api/schedules') {
      const body = await readBody(req);
      if (!AGENTS[body.agent]) return send(res, 400, { error: 'Unknown agent' });
      try {
        return send(res, 200, { schedule: createSchedule(body) });
      } catch (e) {
        return send(res, 400, { error: e.message });
      }
    }
    const sch = /^\/api\/schedules\/([\w]+)$/.exec(p);
    if (sch && m === 'POST') {
      const task = listSchedules().find((s) => s.id === sch[1]);
      if (!task) return send(res, 404, { error: 'Not found' });
      const { action } = await readBody(req);
      if (action === 'delete') deleteSchedule(task.id);
      if (action === 'toggle') updateSchedule(task.id, { enabled: !task.enabled, enabledAt: new Date().toISOString() });
      if (action === 'run') {
        if (scheduleBusy.has(task.id)) return send(res, 409, { error: '这个任务正在运行' });
        scheduleBusy.add(task.id);
        runScheduled(task).catch(() => {}).finally(() => scheduleBusy.delete(task.id));
      }
      return send(res, 200, { ok: true });
    }
    if (m === 'GET' && p === '/api/leads.csv') return send(res, 200, leadsCsv(), { 'content-type': MIME['.csv'], 'content-disposition': 'attachment; filename="leads.csv"' });
    const lead = /^\/api\/leads\/([\w]+)$/.exec(p);
    if (lead && m === 'POST') {
      const updated = await leadAction(lead[1], await readBody(req));
      return updated ? send(res, 200, { lead: updated }) : send(res, 404, { error: 'Not found' });
    }
    if (m === 'GET' && p === '/api/library') return send(res, 200, { items: libraryItems() });
    if (m === 'POST' && p === '/api/library') return send(res, ...(await saveWork(await readBody(req))));
    const lib = /^\/api\/library\/([\w]+)$/.exec(p);
    if (lib && m === 'GET') {
      const found = readItem(lib[1]);
      return found ? send(res, 200, found) : send(res, 404, { error: 'Not found' });
    }
    if (lib && m === 'POST') {
      const body = await readBody(req);
      if (body.action === 'delete') return deleteItem(lib[1]) ? send(res, 200, { ok: true }) : send(res, 404, { error: 'Not found' });
      if (body.action === 'move') {
        const moved = moveItem(lib[1], body.folder);
        return moved ? send(res, 200, { item: moved }) : send(res, 404, { error: 'Not found' });
      }
      return send(res, 400, { error: 'Unknown action' });
    }
    if (m === 'GET' && p === '/api/memory') return send(res, 200, { memories: listMemories() });
    const mem = /^\/api\/memory\/([\w]+)$/.exec(p);
    if (mem && m === 'DELETE') {
      deleteMemory(mem[1]);
      return send(res, 200, { ok: true });
    }

    if (m === 'GET' && p.startsWith('/files/')) {
      // Agent-written files are shown in a sandbox: they can render and print, but cannot reach this server's API.
      let file;
      try {
        file = confine(hubWorkspace(), p.slice('/files/'.length));
      } catch {
        return send(res, 403, 'Forbidden');
      }
      return serveFile(res, file, { 'content-security-policy': 'sandbox allow-scripts allow-modals allow-popups' });
    }
    if (m === 'GET') {
      const rel = p === '/' ? 'index.html' : p.slice(1);
      const file = path.join(here, 'public', path.normalize(rel));
      if (!file.startsWith(path.join(here, 'public'))) return send(res, 403, 'Forbidden');
      return serveFile(res, file);
    }
    send(res, 404, { error: 'Not found' });
  } catch (e) {
    if (!res.headersSent) send(res, 500, { error: e.message || String(e) });
    else res.end();
  }
});

server.listen(PORT, HOST, () => {
  tick();
  setInterval(tick, 30_000).unref?.();
  console.log(`\n  掌柜系统已启动： http://localhost:${PORT}${process.env.ZHANGGUI_MOCK === '1' ? '   （演示模式：使用模拟模型）' : ''}\n  数据目录： ${path.dirname(dataPath('x'))}\n`);
});
