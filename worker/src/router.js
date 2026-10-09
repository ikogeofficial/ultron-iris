// Fallback chain: OpenRouter key -> OpenRouter key -> Nemotron (3 attempts max = 1 try + 2 retries).
// Every failed attempt records WHY (R13). Key values are never recorded, only their names.
import * as openrouter from './adapters/openrouter.js';
import * as nvidia from './adapters/nvidia.js';

const ADAPTERS = { openrouter, nvidia };

export function collectKeys(env) {
  const or = [];
  const nv = [];
  for (const [name, key] of Object.entries(env || {})) {
    if (typeof key !== 'string' || !key) continue;
    if (/^OR_KEY_\d+$/.test(name)) or.push({ name, key, n: Number(name.split('_')[2]) });
    else if (/^NVIDIA_KEY(_\d+)?$/.test(name)) nv.push({ name, key, n: Number(name.split('_')[2] || 0) });
  }
  or.sort((a, b) => a.n - b.n);
  nv.sort((a, b) => a.n - b.n);
  return { or, nv };
}

function rotate(list, start) {
  if (!list.length) return [];
  const s = ((start % list.length) + list.length) % list.length;
  return [...list.slice(s), ...list.slice(0, s)];
}

export function buildChain({ or, nv }, { maxAttempts, startIndex = 0, nvidiaModel }) {
  const nvUsable = nvidiaModel ? nv : [];
  const orSlots = Math.max(0, maxAttempts - (nvUsable.length ? 1 : 0));
  const first = rotate(or, startIndex).slice(0, orSlots).map((k) => ({ provider: 'openrouter', ...k }));
  const rest = rotate(nvUsable, startIndex).slice(0, maxAttempts - first.length).map((k) => ({ provider: 'nvidia', ...k }));
  return [...first, ...rest];
}

function pickModel(entry, role, models, attemptIndex) {
  if (entry.provider === 'nvidia') return models.nvidia?.model || null;
  const list = models.openrouter?.[role] || [];
  return list.length ? list[attemptIndex % list.length] : null;
}

export async function runChain({ chain, role, models, messages, maxTokens, fetchImpl, timeoutMs }) {
  const attempts = [];
  for (let i = 0; i < chain.length; i++) {
    const entry = chain[i];
    const model = pickModel(entry, role, models, i);
    if (!model) {
      attempts.push({ n: i + 1, provider: entry.provider, key: entry.name, model: null, status: 0, rateLimited: false, reason: 'no model configured' });
      continue;
    }
    try {
      const result = await ADAPTERS[entry.provider].chat({
        key: entry.key, model, messages, maxTokens, fetchImpl, timeoutMs
      });
      attempts.push({ n: i + 1, provider: entry.provider, key: entry.name, model, status: 200, rateLimited: false, reason: 'ok' });
      return { ok: true, reply: result.reply, usage: result.usage, provider: entry.provider, model, attempts };
    } catch (e) {
      attempts.push({
        n: i + 1,
        provider: entry.provider,
        key: entry.name,
        model,
        status: e?.status ?? 0,
        rateLimited: Boolean(e?.rateLimited),
        reason: String(e?.message || e).slice(0, 200)
      });
    }
  }
  const allRateLimited = attempts.length > 0 && attempts.every((a) => a.rateLimited);
  return { ok: false, attempts, allRateLimited };
}
