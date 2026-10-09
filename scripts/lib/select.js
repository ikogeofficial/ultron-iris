// Picks model IDs from the provider catalogs. Pure functions: no network, easy to test.

const SMALL = /(flash|mini|nano|small|lite|tiny|\b(1|3|4|7|8|9|12|14)b\b)/i;
const NVIDIA_BAD = /(parse|embed|rerank|guard|safety|\bvl\b|vision|reward|retriever|clip|topic)/i;

export function isFreeTextModel(m) {
  if (typeof m?.id !== 'string' || !m.id.endsWith(':free')) return false;
  if (/embed|image|audio|moderation|guard|rerank/i.test(m.id)) return false;
  const out = m.architecture?.output_modalities;
  if (Array.isArray(out) && !(out.length === 1 && out[0] === 'text')) return false;
  const p = m.pricing;
  if (p && (Number(p.prompt) > 0 || Number(p.completion) > 0)) return false;
  return true;
}

const byContext = (a, b) =>
  (b.context_length || 0) - (a.context_length || 0) || a.id.localeCompare(b.id);

const isReasoning = (m) => (m.supported_parameters || []).includes('reasoning');

export function selectOpenRouter(list, count = 3) {
  const pool = (Array.isArray(list) ? list : []).filter(isFreeTextModel);
  const top = (arr) => arr.slice(0, count).map((m) => m.id);

  const researcher = top([...pool].sort(byContext));

  const reasoning = pool.filter(isReasoning);
  const supervisor = top([...(reasoning.length ? reasoning : pool)].sort(byContext));

  // Default/Memorist: fast and plain. Reasoning models are avoided because they can
  // spend the whole token cap thinking and return an empty reply.
  const plain = pool.filter((m) => !isReasoning(m));
  const basePool = plain.length ? plain : pool;
  const smallFirst = [...basePool].sort(
    (a, b) => (SMALL.test(b.id) ? 1 : 0) - (SMALL.test(a.id) ? 1 : 0) || byContext(a, b)
  );
  const def = top(smallFirst);

  return { default: def, researcher, supervisor, memorist: def };
}

export function selectNvidia(list) {
  const ids = (Array.isArray(list) ? list : [])
    .map((m) => m?.id)
    .filter((id) => typeof id === 'string' && /nemotron/i.test(id) && !NVIDIA_BAD.test(id));
  const rank = (id) => (/super/i.test(id) ? 0 : /nano/i.test(id) ? 1 : 2);
  ids.sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
  return ids[0] ?? null;
}

export function applyOverrides(selected, overrides) {
  const out = { openrouter: { ...selected.openrouter }, nvidia: { ...selected.nvidia } };
  const orOver = overrides?.openrouter || {};
  for (const [role, ids] of Object.entries(orOver)) {
    if (!Array.isArray(ids) || ids.length === 0) continue;
    for (const id of ids) {
      if (typeof id !== 'string' || !id.endsWith(':free')) {
        throw new Error(`Override for "${role}" has a non-free model ID: ${id}`);
      }
    }
    out.openrouter[role] = ids;
  }
  if (overrides?.nvidia?.model) out.nvidia.model = overrides.nvidia.model;
  return out;
}
