// Claude API list prices, USD per 1M tokens. Source: the Claude API price list. A model that is not in this table
export const CLAUDE_PRICES = {
  'claude-opus-5-5': { input: 4.0, output: 20.0, cache_read: 0.20, cache_write_5m: 5.0, cache_write_1h: 8.0 },
  'claude-sonnet-5-5': { input: 2.0, output: 10.0, cache_read: 0.20, cache_write_5m: 2.5, cache_write_1h: 4.0 },
  'claude-haiku-5-5': { input: 0.10, output: 0.50, cache_read: 0.01, cache_write_5m: 0.125, cache_write_1h: 0.20 },
};

export function priceFor(model) {
  if (!model) return null;
  const m = String(model).toLowerCase();
  for (const id of Object.keys(CLAUDE_PRICES)) {
    if (m === id || m.startsWith(`${id}-`) || m.startsWith(`${id}[`) || m.startsWith(`${id}@`)) return { id, ...CLAUDE_PRICES[id] };
  }
  return null;
}

export function tokensUsd(model, tokens) {
  const p = priceFor(model);
  if (!p) return null;
  return ((tokens.input || 0) * p.input + (tokens.output || 0) * p.output + (tokens.cache_read || 0) * p.cache_read
    + (tokens.cache_write_5m || 0) * p.cache_write_5m + (tokens.cache_write_1h || 0) * p.cache_write_1h) / 1e6;
}
