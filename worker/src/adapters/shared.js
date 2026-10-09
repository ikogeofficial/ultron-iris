// Shared plumbing for OpenAI-style /chat/completions endpoints.
// Each provider still has its own adapter file (R5); this only avoids copy-paste.

export class AdapterError extends Error {
  constructor(message, { status = 0 } = {}) {
    super(String(message).slice(0, 200));
    this.name = 'AdapterError';
    this.status = status;
    this.rateLimited = status === 429;
  }
}

// Some models (e.g. Gemma) reject the "system" role. Fold it into the first user message.
export function foldSystemIntoUser(messages) {
  const system = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n');
  const rest = messages.filter((m) => m.role !== 'system');
  if (!system) return rest;
  const i = rest.findIndex((m) => m.role === 'user');
  if (i === -1) return [{ role: 'user', content: system }, ...rest];
  const copy = rest.slice();
  copy[i] = { role: 'user', content: `${system}\n\n${rest[i].content}` };
  return copy;
}

function errorText(data) {
  const e = data?.error;
  if (!e) return null;
  return typeof e === 'string' ? e : e.message || null;
}

export async function callChatCompletions({ url, headers, model, messages, maxTokens, fetchImpl, timeoutMs }) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    let res;
    let text;
    try {
      res = await fetchImpl(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify({ model, messages, max_tokens: maxTokens }),
        signal: ctrl.signal
      });
      text = await res.text();
    } catch (e) {
      if (e?.name === 'AbortError') throw new AdapterError('timeout', { status: 0 });
      throw new AdapterError(`network error: ${e?.message || e}`, { status: 0 });
    }

    let data = null;
    try { data = JSON.parse(text); } catch { /* not JSON */ }

    if (!res.ok) throw new AdapterError(errorText(data) || `HTTP ${res.status}`, { status: res.status });
    if (data?.error) {
      throw new AdapterError(errorText(data) || 'provider error', { status: Number(data.error.code) || res.status });
    }
    const content = data?.choices?.[0]?.message?.content;
    if (typeof content !== 'string' || !content.trim()) {
      throw new AdapterError('empty reply (model returned no text)', { status: res.status });
    }
    return { reply: content.trim(), usage: data.usage ?? null };
  } finally {
    clearTimeout(timer);
  }
}
