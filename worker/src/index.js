// ULTRON proxy Worker. Stack: PWA + Cloudflare Worker + Supabase.
// Step 2: GET /health and POST /chat (Default agent only).
import models from '../../config/models.json' with { type: 'json' };
import limits from '../../config/limits.json' with { type: 'json' };
import { AGENTS } from './agents.js';
import { cacheKey, createRateLimiter, validateChatBody } from './guard.js';
import { buildChain, collectKeys, runChain } from './router.js';

const STACK = 'PWA + Cloudflare Worker + Supabase';

function allowedOrigins(env) {
  return String(env?.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
}

function corsHeaders(origin, allowed) {
  if (origin && allowed.includes(origin)) {
    return {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400',
      Vary: 'Origin'
    };
  }
  return { Vary: 'Origin' };
}

export function createHandler({
  models: m = models,
  limits: l = limits,
  fetchImpl = (...args) => globalThis.fetch(...args),
  now = () => Date.now()
} = {}) {
  const rate = createRateLimiter({ perMinute: l.rateLimitPerMin, now });

  return async function handle(request, env = {}, ctx) {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin');
    const allowed = allowedOrigins(env);
    const cors = corsHeaders(origin, allowed);

    const json = (body, status = 200, extra = {}) =>
      new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...cors, ...extra }
      });

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: origin && allowed.includes(origin) ? 204 : 403, headers: cors });
    }
    if (origin && !allowed.includes(origin)) {
      return json({ ok: false, error: 'Origin not allowed' }, 403);
    }

    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    const keys = collectKeys(env);

    // ---------- GET /health ----------
    if (request.method === 'GET' && url.pathname === '/health') {
      const problems = [];
      if (m.status !== 'ok') problems.push('config/models.json is not generated (run npm run models:update, commit, redeploy)');
      if (!m.openrouter?.default?.length) problems.push('no free OpenRouter model for the Default agent');
      if (keys.or.length + keys.nv.length === 0) problems.push('no API keys found in Worker secrets');
      if (!m.nvidia?.model) problems.push('no Nemotron model configured (fallback skipped)');
      if (!allowed.length) problems.push('ALLOWED_ORIGINS is empty (browser calls will be refused)');

      const critical = m.status !== 'ok' || !m.openrouter?.default?.length || keys.or.length + keys.nv.length === 0;
      const body = {
        ok: !critical,
        stack: STACK,
        models: { status: m.status, generatedAt: m.generatedAt, nvidia: m.nvidia?.model ? 'set' : 'none', defaultCount: m.openrouter?.default?.length || 0 },
        keys: { openrouter: keys.or.length, nvidia: keys.nv.length },
        cache: Boolean(env.CACHE),
        problems
      };

      if (url.searchParams.get('deep') === '1' && !critical) {
        const gate = rate(ip);
        if (!gate.allowed) return json({ ...body, ok: false, deep: { error: 'rate limited' } }, 429, { 'Retry-After': String(gate.retryAfter) });
        const chain = buildChain(keys, { maxAttempts: l.maxAttempts, startIndex: Math.floor(now() / 60000), nvidiaModel: m.nvidia?.model });
        const r = await runChain({
          chain, role: 'default', models: m,
          messages: [{ role: 'user', content: 'Reply with the single word: ok' }],
          maxTokens: 20, fetchImpl, timeoutMs: l.requestTimeoutMs
        });
        body.deep = { ok: r.ok, model: r.model ?? null, provider: r.provider ?? null, attempts: r.attempts };
        body.ok = r.ok;
        return json(body, r.ok ? 200 : 503);
      }
      return json(body, critical ? 503 : 200);
    }

    // ---------- POST /chat ----------
    if (request.method === 'POST' && url.pathname === '/chat') {
      const raw = await request.text();
      if (new TextEncoder().encode(raw).length > l.maxBodyBytes) {
        return json({ ok: false, error: 'Request body too large' }, 413);
      }
      let body;
      try { body = JSON.parse(raw); } catch { return json({ ok: false, error: 'Body is not valid JSON' }, 400); }

      const v = validateChatBody(body, l, AGENTS);
      if (!v.ok) return json({ ok: false, error: v.error }, 400);

      const gate = rate(ip);
      if (!gate.allowed) {
        return json({ ok: false, error: 'rate_limited', message: `Too many requests. Retry in ${gate.retryAfter}s.`, retryAfter: gate.retryAfter }, 429, { 'Retry-After': String(gate.retryAfter) });
      }

      const agent = AGENTS[v.agent];
      const messages = [{ role: 'system', content: agent.system }, ...v.messages];
      const key = await cacheKey(v.agent, m.generatedAt, v.messages);

      if (env.CACHE) {
        try {
          const hit = await env.CACHE.get(key, 'json');
          if (hit?.reply) return json({ ok: true, cached: true, agent: v.agent, ...hit });
        } catch (e) {
          console.error(JSON.stringify({ evt: 'cache_read_failed', reason: String(e?.message || e) }));
        }
      }

      if (m.status !== 'ok') return json({ ok: false, error: 'not_configured', message: 'Models are not configured yet.' }, 503);

      const chain = buildChain(keys, { maxAttempts: l.maxAttempts, startIndex: Math.floor(now() / 60000), nvidiaModel: m.nvidia?.model });
      if (!chain.length) return json({ ok: false, error: 'not_configured', message: 'No API keys are configured.' }, 503);

      const result = await runChain({
        chain, role: agent.role, models: m, messages,
        maxTokens: l.agents[agent.role].maxTokens, fetchImpl, timeoutMs: l.requestTimeoutMs
      });

      console.log(JSON.stringify({
        evt: 'chat', agent: v.agent, ok: result.ok, provider: result.provider ?? null, model: result.model ?? null,
        tokens: result.usage?.total_tokens ?? null,
        attempts: result.attempts.map((a) => ({ p: a.provider, k: a.key, s: a.status }))
      }));

      if (!result.ok) {
        const retryAfter = 30;
        return json({
          ok: false,
          error: result.allRateLimited ? 'rate_limited_upstream' : 'busy',
          message: `Ultron is busy. Retry in ${retryAfter}s.`,
          retryAfter,
          attempts: result.attempts
        }, result.allRateLimited ? 429 : 503, { 'Retry-After': String(retryAfter) });
      }

      const payload = { reply: result.reply, provider: result.provider, model: result.model, usage: result.usage };
      if (env.CACHE) {
        const write = env.CACHE.put(key, JSON.stringify(payload), { expirationTtl: l.cacheTtlSeconds })
          .catch((e) => console.error(JSON.stringify({ evt: 'cache_write_failed', reason: String(e?.message || e) })));
        if (ctx?.waitUntil) ctx.waitUntil(write); else await write;
      }
      return json({ ok: true, cached: false, agent: v.agent, ...payload, attempts: result.attempts.length });
    }

    return json({ ok: false, error: 'Not found' }, 404);
  };
}

const handler = createHandler();
export default { fetch: (request, env, ctx) => handler(request, env, ctx) };
