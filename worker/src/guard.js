// Credit guard helpers (see 03-credit-guard.md): validation, trimming, cache key, rate limit.

export function validateChatBody(body, limits, agents) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, error: 'Body must be a JSON object' };
  }
  const agent = body.agent ?? 'default';
  if (typeof agent !== 'string' || !Object.hasOwn(agents, agent)) {
    return { ok: false, error: `Agent "${String(agent)}" is not available yet` };
  }
  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    return { ok: false, error: '"messages" must be a non-empty array' };
  }
  for (const m of body.messages) {
    if (!m || (m.role !== 'user' && m.role !== 'assistant')) {
      return { ok: false, error: 'Each message needs role "user" or "assistant"' };
    }
    if (typeof m.content !== 'string' || !m.content.trim()) {
      return { ok: false, error: 'Each message needs non-empty text content' };
    }
    if (m.content.length > limits.maxMessageChars) {
      return { ok: false, error: `A message is longer than ${limits.maxMessageChars} characters` };
    }
  }
  if (body.messages[body.messages.length - 1].role !== 'user') {
    return { ok: false, error: 'The last message must be from the user' };
  }
  return { ok: true, agent, messages: trimMessages(body.messages, limits.contextMessages) };
}

export function trimMessages(messages, keep) {
  let out = messages.slice(-keep).map((m) => ({ role: m.role, content: m.content }));
  while (out.length > 1 && out[0].role !== 'user') out = out.slice(1);
  return out;
}

export async function cacheKey(agent, version, messages) {
  const data = new TextEncoder().encode(JSON.stringify({ agent, version, messages }));
  const digest = await crypto.subtle.digest('SHA-256', data);
  const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `chat:${hex}`;
}

// Best-effort limiter: memory is per Worker instance, so it slows abuse but is not a hard cap.
export function createRateLimiter({ perMinute, now = () => Date.now() }) {
  const hits = new Map();
  return function check(id) {
    const t = now();
    const recent = (hits.get(id) || []).filter((x) => t - x < 60_000);
    if (recent.length >= perMinute) {
      hits.set(id, recent);
      return { allowed: false, retryAfter: Math.max(1, Math.ceil((60_000 - (t - recent[0])) / 1000)) };
    }
    recent.push(t);
    hits.set(id, recent);
    if (hits.size > 5000) {
      for (const [k, v] of hits) if (!v.some((x) => t - x < 60_000)) hits.delete(k);
    }
    return { allowed: true, retryAfter: 0 };
  };
}
