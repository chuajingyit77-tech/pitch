// Provider keys, model choices and per-agent provider assignment.
import { readJson, writeJson } from './store.js';

export const PROVIDERS = {
  anthropic: { label: 'Claude (Anthropic)', env: 'ANTHROPIC_API_KEY', kind: 'anthropic' },
  openai: { label: 'OpenAI', env: 'OPENAI_API_KEY', kind: 'openai', baseURL: '' },
  xai: { label: 'Grok (xAI)', env: 'XAI_API_KEY', kind: 'openai', baseURL: 'https://api.x.ai/v1' },
  moonshot: { label: 'Kimi (Moonshot)', env: 'MOONSHOT_API_KEY', kind: 'openai', baseURL: 'https://api.moonshot.ai/v1' },
};

const DEFAULTS = {
  providers: {
    anthropic: { apiKey: '', model: 'claude-opus-5-5' },
    // No default model for the others: IDs change often, so the UI lists what the key can use.
    openai: { apiKey: '', model: '', baseURL: '' },
    xai: { apiKey: '', model: '', baseURL: '' },
    moonshot: { apiKey: '', model: '', baseURL: '' },
  },
  // Which vendor drives which agent. Any agent falls back to a configured vendor.
  agents: { assistant: 'moonshot', pitch: 'anthropic', sales: 'xai', coding: 'openai' },
  braveKey: '',
  codingWorkspace: '',
};

export function loadConfig() {
  const saved = readJson('config.json', {});
  const cfg = structuredClone(DEFAULTS);
  for (const id of Object.keys(cfg.providers)) Object.assign(cfg.providers[id], saved.providers?.[id]);
  Object.assign(cfg.agents, saved.agents);
  if (typeof saved.braveKey === 'string') cfg.braveKey = saved.braveKey;
  if (typeof saved.codingWorkspace === 'string') cfg.codingWorkspace = saved.codingWorkspace;
  return cfg;
}

export function saveConfig(patch) {
  const cfg = loadConfig();
  for (const [id, p] of Object.entries(patch.providers || {})) {
    if (!cfg.providers[id]) continue;
    for (const k of ['apiKey', 'model', 'baseURL']) {
      if (typeof p[k] === 'string') cfg.providers[id][k] = p[k].trim();
    }
  }
  for (const [agent, provider] of Object.entries(patch.agents || {})) {
    if (agent in cfg.agents && PROVIDERS[provider]) cfg.agents[agent] = provider;
  }
  if (typeof patch.braveKey === 'string') cfg.braveKey = patch.braveKey.trim();
  if (typeof patch.codingWorkspace === 'string') cfg.codingWorkspace = patch.codingWorkspace.trim();
  writeJson('config.json', cfg);
  return cfg;
}

export function apiKeyFor(cfg, id) {
  return cfg.providers[id]?.apiKey || process.env[PROVIDERS[id].env] || '';
}

/** A provider is usable once it has a key and a model. */
export function isReady(cfg, id) {
  if (id === 'mock') return process.env.AGENT_HUB_MOCK === '1';
  return Boolean(apiKeyFor(cfg, id) && cfg.providers[id]?.model);
}

/** The vendor an agent will actually run on: its assigned one, else the first usable one. */
export function resolveProvider(cfg, agentId) {
  if (process.env.AGENT_HUB_MOCK === '1') return 'mock';
  const preferred = cfg.agents[agentId];
  if (preferred && isReady(cfg, preferred)) return preferred;
  return Object.keys(PROVIDERS).find((id) => isReady(cfg, id)) || null;
}

/** Config safe to send to the browser: keys are reduced to a hint. */
export function publicConfig(cfg) {
  const providers = {};
  for (const [id, meta] of Object.entries(PROVIDERS)) {
    const key = apiKeyFor(cfg, id);
    providers[id] = {
      label: meta.label,
      hasKey: Boolean(key),
      keyHint: key ? `…${key.slice(-4)}` : '',
      fromEnv: !cfg.providers[id].apiKey && Boolean(key),
      model: cfg.providers[id].model,
      baseURL: cfg.providers[id].baseURL || meta.baseURL || '',
      ready: isReady(cfg, id),
    };
  }
  return {
    providers,
    agents: cfg.agents,
    hasBraveKey: Boolean(cfg.braveKey),
    codingWorkspace: cfg.codingWorkspace,
  };
}
