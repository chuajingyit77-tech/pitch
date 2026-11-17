import { PROVIDERS, apiKeyFor } from '../config.js';
import { createAnthropicProvider } from './anthropic.js';
import { createOpenAICompatProvider } from './openai-compat.js';
import { createMockProvider } from './mock.js';

/** Build the adapter for a vendor. Every adapter exposes complete() and listModels(). */
export function createProvider(cfg, id) {
  if (id === 'mock') return createMockProvider();
  const meta = PROVIDERS[id];
  if (!meta) throw new Error(`Unknown provider: ${id}`);
  const settings = cfg.providers[id];
  const apiKey = apiKeyFor(cfg, id);
  if (meta.kind === 'anthropic') return createAnthropicProvider({ apiKey, model: settings.model });
  return createOpenAICompatProvider({ id, apiKey, model: settings.model, baseURL: settings.baseURL || meta.baseURL });
}
