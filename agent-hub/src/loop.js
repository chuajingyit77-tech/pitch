// The agent loop: ask the model, run the tools it calls (with approval where needed), repeat until it is done.
import fs from 'node:fs';
import { AGENTS } from './agents.js';
import { loadConfig, resolveProvider } from './config.js';
import { createProvider } from './llm/index.js';
import { hubWorkspace } from './store.js';
import { memoryPrompt } from './tools/memory.js';

const MAX_STEPS = 40;
const MAX_RESULT = 30_000;

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
  if (tool.alwaysAsk?.(input)) return true;
  if (tool.tier === 'edit') return ctx.workspace !== hubWorkspace() && !ctx.session.allowEdits;
  return !ctx.session.allowExec;
}

async function runTool(call, tools, ctx) {
  const tool = tools.find((t) => t.name === call.name);
  if (!tool) return { content: `Unknown tool: ${call.name}`, isError: true };
  if (call.parseError) return { content: call.parseError, isError: true };
  const invalid = validateInput(tool.schema, call.input);
  if (invalid) return { content: `Invalid tool input: ${invalid}`, isError: true };
  if (needsApproval(tool, call.input, ctx)) {
    const decision = await ctx.approve({ agent: ctx.agentId, tool: tool.name, tier: tool.tier, input: call.input });
    if (!decision?.allow) {
      return { content: `The user declined this action.${decision?.reason ? ` Their reason: ${decision.reason}` : ''}`, isError: true };
    }
    if (decision.always && !tool.alwaysAsk?.(call.input)) {
      if (tool.tier === 'edit') ctx.session.allowEdits = true;
      if (tool.tier === 'exec') ctx.session.allowExec = true;
    }
  }
  try {
    const out = String(await tool.run(call.input, ctx));
    return { content: out.length > MAX_RESULT ? `${out.slice(0, MAX_RESULT)}\n… [truncated]` : out || '(no output)', isError: false };
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
  const ctx = { agentId, session, workspace, emit: say, approve, signal, depth, runAgent };
  const system = `${agent.system}\n\nToday's date: ${new Date().toISOString().slice(0, 10)}. Workspace: ${workspace}${memoryPrompt()}`;

  say({ type: 'start', provider: providerId, model: provider.model });
  messages.push({ role: 'user', content: userText });
  let finalText = '';
  const usage = { input: 0, output: 0 };

  for (let step = 0; ; step++) {
    if (signal?.aborted) throw new Error('已停止');
    if (step >= MAX_STEPS) {
      say({ type: 'notice', text: `已达到单次任务的步数上限（${MAX_STEPS} 步），先停在这里。` });
      break;
    }
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
        say({ type: 'tool_result', id: c.id, name: c.name, content: r.content.slice(0, 4000), isError: r.isError });
        return { id: c.id, name: c.name, ...r };
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
  say({ type: 'done', usage });
  return { text: finalText, usage };
}
