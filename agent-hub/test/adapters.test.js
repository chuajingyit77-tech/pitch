// The two vendor adapters, exercised over HTTP against local stand-in servers that speak each wire format.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

const requests = [];
const sse = (res, lines) => {
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  res.end(lines.join(''));
};
const anthropicEvent = (type, data) => `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`;

const server = http.createServer(async (req, res) => {
  let body = '';
  for await (const c of req) body += c;
  const json = body ? JSON.parse(body) : {};
  requests.push({ url: req.url, headers: req.headers, json });

  if (req.url.startsWith('/v1/messages')) {
    if (json.fallbacks) {
      res.writeHead(400, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message: 'fallbacks: Extra inputs are not permitted' } }));
    }
    const answered = json.messages.some((m) => Array.isArray(m.content) && m.content.some((b) => b.type === 'tool_result'));
    const start = anthropicEvent('message_start', { message: { id: 'msg_1', type: 'message', role: 'assistant', model: json.model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 7, output_tokens: 0 } } });
    if (answered) {
      return sse(res, [
        start,
        anthropicEvent('content_block_start', { index: 0, content_block: { type: 'text', text: '' } }),
        anthropicEvent('content_block_delta', { index: 0, delta: { type: 'text_delta', text: 'All done.' } }),
        anthropicEvent('content_block_stop', { index: 0 }),
        anthropicEvent('message_delta', { delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 3 } }),
        anthropicEvent('message_stop', {}),
      ]);
    }
    return sse(res, [
      start,
      anthropicEvent('content_block_start', { index: 0, content_block: { type: 'text', text: '' } }),
      anthropicEvent('content_block_delta', { index: 0, delta: { type: 'text_delta', text: 'Let me ' } }),
      anthropicEvent('content_block_delta', { index: 0, delta: { type: 'text_delta', text: 'check.' } }),
      anthropicEvent('content_block_stop', { index: 0 }),
      anthropicEvent('content_block_start', { index: 1, content_block: { type: 'tool_use', id: 'toolu_1', name: 'read_file', input: {} } }),
      anthropicEvent('content_block_delta', { index: 1, delta: { type: 'input_json_delta', partial_json: '{"path":' } }),
      anthropicEvent('content_block_delta', { index: 1, delta: { type: 'input_json_delta', partial_json: '"a.txt"}' } }),
      anthropicEvent('content_block_stop', { index: 1 }),
      anthropicEvent('message_delta', { delta: { stop_reason: 'tool_use', stop_sequence: null }, usage: { output_tokens: 9 } }),
      anthropicEvent('message_stop', {}),
    ]);
  }

  if (req.url.endsWith('/chat/completions')) {
    const chunk = (delta, finish = null, extra = {}) => `data: ${JSON.stringify({ id: 'c1', object: 'chat.completion.chunk', model: json.model, choices: [{ index: 0, delta, finish_reason: finish }], ...extra })}\n\n`;
    const answered = json.messages.some((m) => m.role === 'tool');
    if (answered) return sse(res, [chunk({ role: 'assistant', content: 'All ' }), chunk({ content: 'done.' }), chunk({}, 'stop'), `data: ${JSON.stringify({ id: 'c1', choices: [], usage: { prompt_tokens: 11, completion_tokens: 2 } })}\n\n`, 'data: [DONE]\n\n']);
    return sse(res, [
      chunk({ role: 'assistant', content: 'Checking.' }),
      chunk({ tool_calls: [{ index: 0, id: 'call_1', type: 'function', function: { name: 'read_file', arguments: '{"pa' } }] }),
      chunk({ tool_calls: [{ index: 0, function: { arguments: 'th":"a.txt"}' } }] }),
      chunk({ tool_calls: [{ index: 1, id: 'call_2', type: 'function', function: { name: 'glob', arguments: '{bad json' } }] }),
      chunk({}, 'tool_calls'),
      'data: [DONE]\n\n',
    ]);
  }
  res.writeHead(404).end();
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;
after(() => server.close());

const tools = [
  { name: 'read_file', description: 'Read', schema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } },
  { name: 'web_search', description: 'Search', schema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } },
];

test('Claude adapter: streams text, returns the tool call, and replays its own turn with the tool result', async () => {
  process.env.ANTHROPIC_BASE_URL = base;
  const { createAnthropicProvider } = await import('../src/llm/anthropic.js');
  const provider = createAnthropicProvider({ apiKey: 'test-key', model: 'claude-opus-5-5' });
  const messages = [{ role: 'user', content: 'read a.txt' }];
  let streamed = '';
  const first = await provider.complete({ system: 'sys', messages, tools, onText: (d) => (streamed += d) });
  assert.equal(streamed, 'Let me check.');
  assert.equal(first.stopReason, 'tool_use');
  assert.deepEqual(first.toolCalls, [{ id: 'toolu_1', name: 'read_file', input: { path: 'a.txt' } }]);

  // The first request carried the fallbacks beta and was refused; the adapter retried without it.
  const sent = requests.filter((r) => r.url.startsWith('/v1/messages'));
  assert.equal(sent.length, 2);
  assert.equal(sent[0].json.fallbacks, 'default');
  const ok = sent[1].json;
  assert.equal(ok.fallbacks, undefined);
  assert.equal(ok.model, 'claude-opus-5-5');
  assert.deepEqual(ok.thinking, { type: 'adaptive' });
  assert.equal(ok.temperature, undefined);
  assert.equal(sent[1].headers.authorization, 'Bearer test-key');
  assert.deepEqual(ok.tools[0], { name: 'read_file', description: 'Read', input_schema: tools[0].schema, eager_input_streaming: true });
  assert.equal(ok.tools[1].type, 'web_search_20260209', 'web search runs server-side on Claude');

  messages.push({ role: 'assistant', text: first.text, toolCalls: first.toolCalls, provider: 'anthropic', raw: first.raw });
  messages.push({ role: 'tool', results: [{ id: 'toolu_1', name: 'read_file', content: 'file body', isError: false }] });
  const second = await provider.complete({ system: 'sys', messages, tools });
  assert.equal(second.text, 'All done.');
  assert.equal(second.stopReason, 'end_turn');
  const replay = requests.at(-1).json.messages;
  assert.equal(replay[1].content[1].type, 'tool_use');
  assert.deepEqual(replay[2].content, [{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'file body' }]);
});

test('Claude adapter rebuilds a turn that another vendor wrote', async () => {
  const { createAnthropicProvider } = await import('../src/llm/anthropic.js');
  const provider = createAnthropicProvider({ apiKey: 'test-key', model: 'claude-opus-5-5' });
  await provider.complete({
    system: 'sys',
    tools,
    messages: [
      { role: 'user', content: 'hi' },
      { role: 'assistant', text: 'looking', toolCalls: [{ id: 'call_9', name: 'read_file', input: { path: 'b' } }], provider: 'xai', raw: null },
      { role: 'tool', results: [{ id: 'call_9', name: 'read_file', content: 'nope', isError: true }] },
    ],
  });
  const sent = requests.at(-1).json.messages;
  assert.deepEqual(sent[1].content, [{ type: 'text', text: 'looking' }, { type: 'tool_use', id: 'call_9', name: 'read_file', input: { path: 'b' } }]);
  assert.equal(sent[2].content[0].is_error, true);
});

test('OpenAI-style adapter (OpenAI, Grok, Kimi): assembles streamed tool calls and reports bad JSON', async () => {
  const { createOpenAICompatProvider } = await import('../src/llm/openai-compat.js');
  const provider = createOpenAICompatProvider({ id: 'xai', apiKey: 'k', model: 'some-model', baseURL: `${base}/v1` });
  const messages = [{ role: 'user', content: 'read a.txt' }];
  let streamed = '';
  const first = await provider.complete({ system: 'sys', messages, tools, onText: (d) => (streamed += d) });
  assert.equal(streamed, 'Checking.');
  assert.equal(first.stopReason, 'tool_use');
  assert.deepEqual(first.toolCalls[0], { id: 'call_1', name: 'read_file', input: { path: 'a.txt' } });
  assert.match(first.toolCalls[1].parseError, /not valid JSON/);
  const sent = requests.at(-1);
  assert.equal(sent.headers.authorization, 'Bearer k');
  assert.deepEqual(sent.json.messages[0], { role: 'system', content: 'sys' });
  assert.equal(sent.json.tools[1].function.name, 'web_search', 'other vendors get the local search tool');

  messages.push({ role: 'assistant', text: first.text, toolCalls: first.toolCalls, provider: 'xai', raw: null });
  messages.push({ role: 'tool', results: [{ id: 'call_1', name: 'read_file', content: 'body', isError: false }, { id: 'call_2', name: 'glob', content: 'bad', isError: true }] });
  const second = await provider.complete({ system: 'sys', messages, tools });
  assert.equal(second.text, 'All done.');
  assert.deepEqual(second.usage, { input: 11, output: 2 });
  const replay = requests.at(-1).json.messages;
  assert.equal(replay[2].tool_calls[0].function.arguments, '{"path":"a.txt"}');
  assert.deepEqual(replay.slice(3).map((m) => [m.role, m.tool_call_id]), [['tool', 'call_1'], ['tool', 'call_2']]);
});
