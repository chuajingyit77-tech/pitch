// Adapter for vendors that speak the OpenAI chat-completions API natively: OpenAI, xAI (Grok), Moonshot (Kimi).
import OpenAI from 'openai';

function toApiMessages(system, messages) {
  const out = [{ role: 'system', content: system }];
  for (const m of messages) {
    if (m.role === 'user') {
      out.push({ role: 'user', content: m.content });
    } else if (m.role === 'assistant') {
      const msg = { role: 'assistant', content: m.text || null };
      if (m.toolCalls?.length) {
        msg.tool_calls = m.toolCalls.map((c) => ({
          id: c.id,
          type: 'function',
          function: { name: c.name, arguments: JSON.stringify(c.input ?? {}) },
        }));
      }
      if (msg.content || msg.tool_calls) out.push(msg);
    } else if (m.role === 'tool') {
      for (const r of m.results) out.push({ role: 'tool', tool_call_id: r.id, content: r.content });
    }
  }
  return out;
}

const STOP = { stop: 'end_turn', tool_calls: 'tool_use', length: 'max_tokens', content_filter: 'refusal' };

export function createOpenAICompatProvider({ id, apiKey, model, baseURL }) {
  const client = new OpenAI({ apiKey, ...(baseURL ? { baseURL } : {}) });
  return {
    id,
    model,
    async complete({ system, messages, tools, onText, signal }) {
      const stream = await client.chat.completions.create(
        {
          model,
          messages: toApiMessages(system, messages),
          ...(tools.length
            ? {
                tools: tools.map((t) => ({
                  type: 'function',
                  function: { name: t.name, description: t.description, parameters: t.schema },
                })),
              }
            : {}),
          stream: true,
          stream_options: { include_usage: true },
        },
        { signal },
      );
      let text = '';
      let finish = null;
      const calls = [];
      const usage = { input: 0, output: 0 };
      for await (const chunk of stream) {
        if (chunk.usage) {
          usage.input = chunk.usage.prompt_tokens || 0;
          usage.output = chunk.usage.completion_tokens || 0;
        }
        const choice = chunk.choices?.[0];
        if (!choice) continue;
        if (choice.delta?.content) {
          text += choice.delta.content;
          onText?.(choice.delta.content);
        }
        for (const tc of choice.delta?.tool_calls || []) {
          const slot = (calls[tc.index ?? 0] ||= { id: '', name: '', args: '' });
          if (tc.id) slot.id = tc.id;
          if (tc.function?.name) slot.name += tc.function.name;
          if (tc.function?.arguments) slot.args += tc.function.arguments;
        }
        if (choice.finish_reason) finish = choice.finish_reason;
      }
      const toolCalls = calls.filter(Boolean).map((c, i) => {
        const call = { id: c.id || `call_${Date.now()}_${i}`, name: c.name };
        try {
          call.input = c.args ? JSON.parse(c.args) : {};
        } catch {
          call.input = {};
          call.parseError = `Tool arguments were not valid JSON: ${c.args.slice(0, 200)}`;
        }
        return call;
      });
      const stopReason = toolCalls.length && finish !== 'length' ? 'tool_use' : STOP[finish] || 'end_turn';
      return { text, toolCalls, stopReason, usage, raw: null };
    },
    async listModels() {
      const ids = [];
      for await (const m of client.models.list()) ids.push(m.id);
      return ids.sort();
    },
  };
}
