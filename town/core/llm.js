// Model adapter. The whole system talks to a model through this one file.
// Swap the provider in config (or env) and nothing else changes.
//
// Supported:
//   anthropic  - api.anthropic.com           (Claude)
//   openai     - any OpenAI-compatible /v1/chat/completions
//                (DeepSeek, Qwen/DashScope-compat, Moonshot, Groq,
//                 Together, OpenRouter, vLLM, LM Studio, ...)
//   ollama     - a model running on your own machine, no key, no network cost
//   echo       - no network at all; returns a fixed shape. For tests and dry runs.

const DEFAULTS = {
  anthropic: { baseUrl: 'https://api.anthropic.com', model: 'claude-sonnet-5-5' },
  openai:    { baseUrl: 'https://api.openai.com',    model: 'gpt-4o-mini' },
  ollama:    { baseUrl: 'http://localhost:11434',    model: 'qwen2.5:14b' },
  echo:      { baseUrl: '',                          model: 'echo' },
};

// Known OpenAI-compatible endpoints, so config can say `preset: 'deepseek'`
// instead of spelling out a URL.
export const PRESETS = {
  deepseek:   { provider: 'openai', baseUrl: 'https://api.deepseek.com',                        model: 'deepseek-chat' },
  qwen:       { provider: 'openai', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode',  model: 'qwen-plus' },
  moonshot:   { provider: 'openai', baseUrl: 'https://api.moonshot.cn',                         model: 'moonshot-v1-8k' },
  groq:       { provider: 'openai', baseUrl: 'https://api.groq.com/openai',                     model: 'llama-3.3-70b-versatile' },
  together:   { provider: 'openai', baseUrl: 'https://api.together.xyz',                        model: 'Qwen/Qwen2.5-72B-Instruct-Turbo' },
  openrouter: { provider: 'openai', baseUrl: 'https://openrouter.ai/api',                       model: 'anthropic/claude-sonnet-4.5' },
  local:      { provider: 'openai', baseUrl: 'http://localhost:8000',                           model: 'local-model' },
  claude:     { provider: 'anthropic' },
  ollama:     { provider: 'ollama' },
};

export function resolveModelConfig(cfg = {}, env = process.env) {
  const presetName = env.TOWN_PRESET || cfg.preset;
  const preset = presetName ? PRESETS[presetName] : null;
  if (presetName && !preset) {
    throw new Error(`Unknown preset "${presetName}". Known: ${Object.keys(PRESETS).join(', ')}`);
  }
  const provider = env.TOWN_PROVIDER || preset?.provider || cfg.provider || 'echo';
  const base = DEFAULTS[provider];
  if (!base) throw new Error(`Unknown provider "${provider}". Known: ${Object.keys(DEFAULTS).join(', ')}`);
  return {
    provider,
    preset: presetName || null,
    model:   env.TOWN_MODEL    || cfg.model   || preset?.model   || base.model,
    baseUrl: (env.TOWN_BASE_URL || cfg.baseUrl || preset?.baseUrl || base.baseUrl).replace(/\/+$/, ''),
    apiKey:  env.TOWN_API_KEY  || cfg.apiKey  || '',
    maxTokens:   cfg.maxTokens   ?? 1200,
    temperature: cfg.temperature ?? 0,
    timeoutMs:   cfg.timeoutMs   ?? 90000,
    retries:     cfg.retries     ?? 2,
  };
}

// Pull the first JSON object out of a model reply. Cheap models wrap JSON in
// prose or code fences; this tolerates both rather than failing the run.
export function extractJson(text) {
  if (typeof text !== 'string') return null;
  let s = text.trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) s = fence[1].trim();
  try { return JSON.parse(s); } catch { /* keep going */ }
  const start = s.indexOf('{');
  if (start === -1) return null;
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < s.length; i++) {
    const ch = s[i];
    if (esc) { esc = false; continue; }
    if (ch === '\\') { esc = true; continue; }
    if (ch === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) {
        try { return JSON.parse(s.slice(start, i + 1)); } catch { return null; }
      }
    }
  }
  return null;
}

async function post(url, headers, body, timeoutMs) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: ctl.signal,
    });
    const text = await res.text();
    if (!res.ok) {
      const err = new Error(`${res.status} ${res.statusText}: ${text.slice(0, 400)}`);
      err.status = res.status;
      throw err;
    }
    return JSON.parse(text);
  } finally {
    clearTimeout(timer);
  }
}

const CALLERS = {
  async anthropic(cfg, { system, prompt, images }) {
    if (!cfg.apiKey) throw new Error('No API key. Set TOWN_API_KEY.');
    const content = images?.length
      ? [...images.map(im => ({ type: 'image', source: { type: 'base64', media_type: im.mediaType, data: im.base64 } })),
         { type: 'text', text: prompt }]
      : prompt;
    const out = await post(`${cfg.baseUrl}/v1/messages`, {
      'x-api-key': cfg.apiKey,
      'anthropic-version': '2023-06-01',
    }, {
      model: cfg.model,
      max_tokens: cfg.maxTokens,
      temperature: cfg.temperature,
      system,
      messages: [{ role: 'user', content }],
    }, cfg.timeoutMs);
    return (out.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
  },

  async openai(cfg, { system, prompt, images }) {
    if (!cfg.apiKey && !/localhost|127\.0\.0\.1/.test(cfg.baseUrl)) {
      throw new Error('No API key. Set TOWN_API_KEY.');
    }
    const content = images?.length
      ? [{ type: 'text', text: prompt },
         ...images.map(im => ({ type: 'image_url', image_url: { url: `data:${im.mediaType};base64,${im.base64}` } }))]
      : prompt;
    const out = await post(`${cfg.baseUrl}/v1/chat/completions`, {
      authorization: `Bearer ${cfg.apiKey || 'not-needed'}`,
    }, {
      model: cfg.model,
      max_tokens: cfg.maxTokens,
      temperature: cfg.temperature,
      messages: [{ role: 'system', content: system }, { role: 'user', content }],
    }, cfg.timeoutMs);
    return out.choices?.[0]?.message?.content ?? '';
  },

  async ollama(cfg, { system, prompt }) {
    const out = await post(`${cfg.baseUrl}/api/chat`, {}, {
      model: cfg.model,
      stream: false,
      options: { temperature: cfg.temperature, num_predict: cfg.maxTokens },
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: prompt, ...(images?.length ? { images: images.map(im => im.base64) } : {}) },
      ],
    }, cfg.timeoutMs);
    return out.message?.content ?? '';
  },

  async echo(_cfg, { prompt, images }) {
    // Deterministic stand-in: proves the pipeline end to end with no network.
    const ask = (prompt.match(/^###\s*要查的事\s*\n([\s\S]*?)(?:\n###|$)/m) || [, ''])[1].trim();
    return JSON.stringify({
      verdict: 'flag',
      finding: `[echo] 未接模型，无法判断：${ask.slice(0, 80)}${images?.length ? `（带了 ${images.length} 张图）` : ''}`,
      evidence: '',
      severity: 'low',
      ask: '接上一个真实模型后重跑这一项。',
    });
  },
};

export function createModel(cfg = {}, env = process.env) {
  const resolved = resolveModelConfig(cfg, env);
  const call = CALLERS[resolved.provider];

  return {
    config: resolved,
    describe() {
      return resolved.provider === 'echo'
        ? 'echo (未接模型)'
        : `${resolved.provider}${resolved.preset ? `/${resolved.preset}` : ''} · ${resolved.model}`;
    },
    // Returns { ok, text, json, error, attempts }
    async ask({ system, prompt, json = true, images = null }) {
      let lastErr = null;
      for (let attempt = 1; attempt <= resolved.retries + 1; attempt++) {
        try {
          const text = await call(resolved, { system, prompt, images });
          const parsed = json ? extractJson(text) : null;
          if (json && !parsed) {
            lastErr = new Error('Model reply was not JSON');
            if (attempt <= resolved.retries) continue;
            return { ok: false, text, json: null, error: lastErr.message, attempts: attempt };
          }
          return { ok: true, text, json: parsed, error: null, attempts: attempt };
        } catch (err) {
          lastErr = err;
          // 4xx other than 429 will not get better by retrying.
          if (err.status && err.status !== 429 && err.status < 500) break;
          if (attempt <= resolved.retries) {
            await new Promise(r => setTimeout(r, 400 * Math.pow(2, attempt - 1)));
          }
        }
      }
      return { ok: false, text: '', json: null, error: lastErr?.message || 'unknown error', attempts: resolved.retries + 1 };
    },
  };
}
