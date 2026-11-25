// Claude adapter, on the official Anthropic SDK.
import Anthropic from '@anthropic-ai/sdk';

const FALLBACK_BETA = 'server-side-fallback-2026-07-01';

function toApiMessages(messages) {
  const out = [];
  for (const m of messages) {
    if (m.role === 'user') {
      out.push({ role: 'user', content: m.content });
    } else if (m.role === 'assistant') {
      // Replay Claude's own turn untouched (thinking blocks must come back unchanged);
      // a turn written by another vendor is rebuilt from its text and tool calls.
      if (m.provider === 'anthropic' && m.raw) {
        out.push({ role: 'assistant', content: m.raw });
      } else {
        const blocks = [];
        if (m.text) blocks.push({ type: 'text', text: m.text });
        for (const c of m.toolCalls || []) blocks.push({ type: 'tool_use', id: c.id, name: c.name, input: c.input });
        if (blocks.length) out.push({ role: 'assistant', content: blocks });
      }
    } else if (m.role === 'tool') {
      // Every result of one turn goes back in a single user message.
      out.push({
        role: 'user',
        content: m.results.map((r) => ({
          type: 'tool_result',
          tool_use_id: r.id,
          content: r.content,
          ...(r.isError ? { is_error: true } : {}),
        })),
      });
    }
  }
  return out;
}

function toApiTools(tools) {
  return tools.map((t) => {
    // Web search runs on Anthropic's servers when Claude is the model.
    if (t.name === 'web_search') return { type: 'web_search_20260209', name: 'web_search', max_uses: 8 };
    return { name: t.name, description: t.description, input_schema: t.schema, eager_input_streaming: true };
  });
}

export function createAnthropicProvider({ apiKey, model }) {
  const client = apiKey ? new Anthropic({ apiKey }) : new Anthropic();
  let useFallbacks = true;

  async function oneRequest({ system, apiMessages, tools, onText, onServerTool, signal, effort }) {
    const params = {
      model,
      max_tokens: 64000,
      system,
      messages: apiMessages,
      tools: toApiTools(tools),
      thinking: { type: 'adaptive' },
      output_config: { effort: effort || 'high' },
      cache_control: { type: 'ephemeral' },
    };
    // On a safety decline, let the API re-run the request on a fallback model in the same call.
    const stream = useFallbacks
      ? client.beta.messages.stream({ ...params, betas: [FALLBACK_BETA], fallbacks: 'default' }, { signal })
      : client.messages.stream(params, { signal });
    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') onText?.(event.delta.text);
      if (event.type === 'content_block_start' && event.content_block.type === 'server_tool_use') {
        onServerTool?.(event.content_block.name);
      }
    }
    return stream.finalMessage();
  }

  return {
    id: 'anthropic',
    model,
    async complete({ system, messages, tools, onText, onServerTool, signal, effort }) {
      const apiMessages = toApiMessages(messages);
      const usage = { input: 0, output: 0 };
      let message;
      let jsonRetries = 0;
      for (let pauses = 0; ; ) {
        try {
          message = await oneRequest({ system, apiMessages, tools, onText, onServerTool, signal, effort });
        } catch (err) {
          if (err instanceof Anthropic.BadRequestError && useFallbacks) {
            // The account or model may not accept the fallbacks beta; continue without it.
            useFallbacks = false;
            continue;
          }
          if (err instanceof Anthropic.APIError || signal?.aborted || jsonRetries++ >= 2) throw err;
          continue; // unparseable tool input or a dropped connection: re-issue the turn
        }
        usage.input += message.usage?.input_tokens || 0;
        usage.output += message.usage?.output_tokens || 0;
        // A long server-side tool turn pauses; send it back so the server continues it.
        if (message.stop_reason === 'pause_turn' && pauses++ < 5) {
          apiMessages.push({ role: 'assistant', content: message.content });
          continue;
        }
        break;
      }
      const text = message.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
      const toolCalls = message.content
        .filter((b) => b.type === 'tool_use')
        .map((b) => ({ id: b.id, name: b.name, input: b.input }));
      return { text, toolCalls, stopReason: message.stop_reason, usage, raw: message.content };
    },
    async listModels() {
      const ids = [];
      for await (const m of client.models.list()) ids.push(m.id);
      return ids;
    },
  };
}
