// The agent loop: ask the model, run the tools it calls (with approval where needed), repeat until it is done.
import fs from 'node:fs';
import { AGENTS } from './agents.js';
import { loadConfig, resolveProvider } from './config.js';
import { createProvider } from './llm/index.js';
import { hubWorkspace } from './store.js';
import { memoryPrompt } from './tools/memory.js';
import { createLedger, noteEdit, noteCheck, stampOf, wouldBlock, verificationMode, logRun, TEXT, MAX_BLOCKS } from './verify.js';

const MAX_STEPS = 40;
const MAX_RESULT = 30_000;
// Model turns allowed after a run has been stopped for the user: enough to write the report, not to keep trying.
const TURNS_AFTER_STOP = 2;

const TYPE_OK = {
  string: (v) => typeof v === 'string',
  integer: (v) => Number.isInteger(v),
  number: (v) => typeof v === 'number' && Number.isFinite(v),
  boolean: (v) => typeof v === 'boolean',
  array: Array.isArray,
  object: (v) => v !== null && typeof v === 'object' && !Array.isArray(v),
};

/** Minimal JSON Schema check. Streamed tool input is not validated by the API, so it is validated here. */
export function validateInput(schema, input, where = 'input') {
  if (!schema || !schema.type) return null;
  if (!TYPE_OK[schema.type]?.(input)) return `${where} should be ${schema.type}`;
  if (schema.enum && !schema.enum.includes(input)) return `${where} must be one of: ${schema.enum.join(', ')}`;
  if (schema.type === 'object') {
    for (const key of schema.required || []) if (input[key] === undefined) return `${where}.${key} is required`;
    for (const [key, sub] of Object.entries(schema.properties || {})) {
      if (input[key] === undefined || input[key] === null) continue;
      const err = validateInput(sub, input[key], `${where}.${key}`);
      if (err) return err;
    }
  }
  if (schema.type === 'array' && schema.items) {
    for (let i = 0; i < input.length; i++) {
      const err = validateInput(schema.items, input[i], `${where}[${i}]`);
      if (err) return err;
    }
  }
  return null;
}

export function workspaceFor(agent, cfg) {
  if (agent.workspace === 'coding') {
    const dir = cfg.codingWorkspace;
    if (!dir) throw new Error('编程 agent 还没有工作目录。请在设置里填入你的代码仓库路径。');
    if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) throw new Error(`工作目录不存在：${dir}`);
    return dir;
  }
  return hubWorkspace();
}

function needsApproval(tool, input, ctx) {
  if (tool.tier === 'auto') return false;
  if (tool.alwaysAsk?.(input, ctx)) return true;
  if (tool.tier === 'edit') return ctx.workspace !== hubWorkspace() && !ctx.session.allowEdits;
  return !ctx.session.allowExec;
}

/**
 * Feed a finished tool call into the run's verification ledger: which files it changed and, when the tool
 * is a check, whether it passed. Returns the check's outcome and any note the model should read with the result.
 */
function track(tool, input, output, ctx) {
  const ledger = ctx.ledger;
  if (!ledger) return { note: '' };
  // Only the user's repository holds work that needs checking; the hub's own sandbox is scratch space.
  if (ctx.workspace !== hubWorkspace()) {
    const files = tool.touches ? tool.touches(input) : tool.tier === 'edit' ? [input.path] : [];
    for (const f of files) noteEdit(ledger, f);
  }
  const check = tool.check?.(input, output);
  if (!check) return { note: '' };
  const { round, escalate } = noteCheck(ledger, check);
  if (check.pass === null) return { note: TEXT.inconclusive, check: 'unclear' };
  if (!escalate) return { note: '', check: check.pass ? 'pass' : 'fail' };
  ctx.emit({ type: 'notice', text: `「${check.label}」连续 ${round} 轮没有通过。已经停下来，等你决定下一步。` });
  return { note: TEXT.escalate(check.label, round), check: 'fail' };
}

async function runTool(call, tools, ctx) {
  const tool = tools.find((t) => t.name === call.name);
  if (!tool) return { content: `Unknown tool: ${call.name}`, isError: true };
  if (call.parseError) return { content: call.parseError, isError: true };
  const invalid = validateInput(tool.schema, call.input);
  if (invalid) return { content: `Invalid tool input: ${invalid}`, isError: true };
  // Three failed rounds stop the run: nothing more is changed, executed or handed to another agent until the user has decided.
  if (ctx.ledger?.escalated && (tool.tier !== 'auto' || tool.name === 'delegate')) return { content: TEXT.stopped(ctx.ledger.escalated.label), isError: true };
  if (needsApproval(tool, call.input, ctx)) {
    const why = tool.askReason?.(call.input, ctx) || undefined;
    const decision = await ctx.approve({ agent: ctx.agentId, tool: tool.name, tier: tool.tier, input: call.input, ...(why ? { why } : {}) });
    if (!decision?.allow) {
      return { content: `The user declined this action.${decision?.reason ? ` Their reason: ${decision.reason}` : ''}`, isError: true };
    }
    if (decision.always && !tool.alwaysAsk?.(call.input, ctx)) {
      if (tool.tier === 'edit') ctx.session.allowEdits = true;
      if (tool.tier === 'exec') ctx.session.allowExec = true;
    }
  }
  try {
    const out = String(await tool.run(call.input, ctx));
    const content = out.length > MAX_RESULT ? `${out.slice(0, MAX_RESULT)}\n… [truncated]` : out || '(no output)';
    const { note, check } = track(tool, call.input, out, ctx);
    return { content: content + note, isError: false, check };
  } catch (e) {
    return { content: `Error: ${e.message}`, isError: true };
  }
}

/**
 * Run one agent on one user message.
 * `messages` is the conversation so far and is appended to in place.
 * `emit` receives progress events; `approve` is asked before edits and commands.
 */
export async function runAgent({ agentId, userText, messages, session, emit, approve, signal, depth = 0 }) {
  const agent = AGENTS[agentId];
  if (!agent) throw new Error(`Unknown agent: ${agentId}`);
  const cfg = loadConfig();
  const providerId = resolveProvider(cfg, agentId);
  if (!providerId) throw new Error('还没有可用的模型。请先在设置里填入至少一家的 API key 并选择模型。');
  const provider = createProvider(cfg, providerId);
  const workspace = workspaceFor(agent, cfg);
  const say = (event) => emit({ agent: agentId, depth, ...event });
  // The acceptance line (src/verify.js): the ledger collects this run's edits and checks.
  const mode = verificationMode(cfg);
  const ledger = mode === 'off' ? null : createLedger();
  const ctx = { agentId, session, workspace, emit: say, approve, signal, depth, runAgent, ledger };
  const system = `${agent.system}\n\nToday's date: ${new Date().toISOString().slice(0, 10)}. Workspace: ${workspace}${memoryPrompt()}`;

  say({ type: 'start', provider: providerId, model: provider.model });
  messages.push({ role: 'user', content: userText });
  let finalText = '';
  const usage = { input: 0, output: 0 };
  let turnsAfterStop = 0;

  for (let step = 0; ; step++) {
    if (signal?.aborted) throw new Error('已停止');
    if (step >= MAX_STEPS) {
      say({ type: 'notice', text: `已达到单次任务的步数上限（${MAX_STEPS} 步），先停在这里。` });
      break;
    }
    if (ledger?.escalated && turnsAfterStop++ >= TURNS_AFTER_STOP) break;
    const res = await provider.complete({
      system,
      messages,
      tools: agent.tools,
      signal,
      onText: (delta) => say({ type: 'text', delta }),
      onServerTool: (name) => say({ type: 'tool', id: `srv_${step}_${Math.random().toString(36).slice(2, 6)}`, name, input: {}, server: true }),
    });
    usage.input += res.usage.input;
    usage.output += res.usage.output;
    messages.push({ role: 'assistant', text: res.text, toolCalls: res.toolCalls, provider: providerId, raw: res.raw });
    if (res.text) finalText = res.text;
    say({ type: 'text_end' });

    if (res.stopReason === 'refusal') {
      say({ type: 'notice', text: '模型拒绝了这个请求。' });
      break;
    }
    if (!res.toolCalls.length) {
      if (res.stopReason === 'max_tokens') say({ type: 'notice', text: '回答达到长度上限，被截断了。' });
      // The gate, enforce mode only: a finish with changed files and no passing check since is sent back,
      // at most MAX_BLOCKS times so the run cannot get stuck. In observe mode the same case is only recorded.
      else if (mode === 'enforce' && !ledger.escalated && ledger.blocks < MAX_BLOCKS && wouldBlock(stampOf(ledger))) {
        ledger.blocks++;
        say({ type: 'notice', text: `验收关卡：改动还没有通过检查，已要求先验证再收工（第 ${ledger.blocks} 次）。` });
        messages.push({ role: 'user', content: TEXT.gate });
        continue;
      }
      break;
    }

    let results;
    if (res.stopReason === 'max_tokens') {
      // A tool call cut off at the token limit may carry truncated input; do not run it.
      results = res.toolCalls.map((c) => ({ id: c.id, name: c.name, content: 'This tool call was cut off before its input was complete. Send it again, with smaller input if needed.', isError: true }));
    } else {
      for (const c of res.toolCalls) say({ type: 'tool', id: c.id, name: c.name, input: c.input });
      const one = async (c) => {
        const r = await runTool(c, agent.tools, ctx);
        // `check` tells the screen whether this call was a check and how it went; the model reads the content.
        say({ type: 'tool_result', id: c.id, name: c.name, content: r.content.slice(0, 4000), isError: r.isError, ...(r.check ? { check: r.check } : {}) });
        return { id: c.id, name: c.name, content: r.content, isError: r.isError };
      };
      const parallel = res.toolCalls.every((c) => agent.tools.find((t) => t.name === c.name)?.tier === 'auto' && c.name !== 'delegate');
      if (parallel) results = await Promise.all(res.toolCalls.map(one));
      else {
        results = [];
        for (const c of res.toolCalls) results.push(await one(c));
      }
    }
    messages.push({ role: 'tool', results });
  }
  // Stamp the run with how it was verified. "none" is a stamp too: it is what makes unverified work findable.
  const stamp = ledger ? stampOf(ledger) : null;
  if (stamp) {
    const unverified = wouldBlock(stamp);
    if (unverified && ledger.blocks >= MAX_BLOCKS) say({ type: 'notice', text: `验收关卡已经拦过 ${ledger.blocks} 次，这次放行，结果标为未验证。` });
    say({ type: 'verification', ...stamp });
    logRun({ session: session.id, agent: agentId, depth, mode, ...stamp, wouldBlock: unverified, blocks: ledger.blocks });
  }
  say({ type: 'done', usage });
  return { text: finalText, usage, verification: stamp };
}
