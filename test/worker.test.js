import test from 'node:test';
import assert from 'node:assert/strict';
import { createHandler } from '../worker/src/index.js';
import limits from '../config/limits.json' with { type: 'json' };

const okModels = { status: 'ok', generatedAt: 'g1', openrouter: { default: ['m1:free'] }, nvidia: { model: 'nvidia/x' } };
const env = { OR_KEY_1: 'SECRET-OR-ONE', OR_KEY_2: 'SECRET-OR-TWO', NVIDIA_KEY_1: 'SECRET-NV-ONE', ALLOWED_ORIGINS: 'https://app.test' };
const okFetch = async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ message: { content: 'pong' } }], usage: { total_tokens: 7 } }) });
const req = (path, init = {}) => new Request(`https://w.test${path}`, init);
const post = (body, headers = {}) => req('/chat', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://app.test', ...headers }, body: JSON.stringify(body) });
const userMsg = (t = 'hi') => ({ messages: [{ role: 'user', content: t }] });

function memoryKV() {
  const store = new Map();
  return { store, get: async (k) => (store.has(k) ? JSON.parse(store.get(k)) : null), put: async (k, v) => { store.set(k, v); } };
}

test('health: 503 with clear problems when models are unset', async () => {
  const h = createHandler({ models: { status: 'unset', openrouter: { default: [] }, nvidia: { model: null } } });
  const res = await h(req('/health'), env);
  assert.equal(res.status, 503);
  const j = await res.json();
  assert.equal(j.ok, false);
  assert.ok(j.problems.some((p) => /models:update/.test(p)));
});

test('health: 200 when configured, and never leaks key values', async () => {
  const h = createHandler({ models: okModels });
  const res = await h(req('/health'), env);
  assert.equal(res.status, 200);
  const text = await res.text();
  assert.ok(!text.includes('SECRET-'));
  const j = JSON.parse(text);
  assert.deepEqual(j.keys, { openrouter: 2, nvidia: 1 });
});

test('health deep: makes a real round trip through the chain', async () => {
  const h = createHandler({ models: okModels, fetchImpl: okFetch });
  const j = await (await h(req('/health?deep=1'), env)).json();
  assert.equal(j.deep.ok, true);
  assert.equal(j.ok, true);
});

test('chat: happy path returns reply', async () => {
  const h = createHandler({ models: okModels, fetchImpl: okFetch });
  const res = await h(post(userMsg()), env);
  assert.equal(res.status, 200);
  const j = await res.json();
  assert.equal(j.reply, 'pong');
  assert.equal(j.cached, false);
  assert.equal(res.headers.get('Access-Control-Allow-Origin'), 'https://app.test');
});

test('chat: cache hit makes zero model calls', async () => {
  let calls = 0;
  const kv = memoryKV();
  const h = createHandler({ models: okModels, fetchImpl: async (...a) => { calls++; return okFetch(...a); } });
  await h(post(userMsg('same')), { ...env, CACHE: kv });
  const second = await (await h(post(userMsg('same')), { ...env, CACHE: kv })).json();
  assert.equal(calls, 1);
  assert.equal(second.cached, true);
  assert.equal(second.reply, 'pong');
});

test('chat: bad JSON, bad body, oversized body', async () => {
  const h = createHandler({ models: okModels, fetchImpl: okFetch });
  const badJson = new Request('https://w.test/chat', { method: 'POST', headers: { Origin: 'https://app.test' }, body: '{nope' });
  assert.equal((await h(badJson, env)).status, 400);
  assert.equal((await h(post({ messages: [] }), env)).status, 400);
  assert.equal((await h(post({ messages: [{ role: 'user', content: 'x' }], pad: 'y'.repeat(limits.maxBodyBytes) }), env)).status, 413);
});

test('chat: rate limit returns 429 with Retry-After', async () => {
  const h = createHandler({ models: okModels, fetchImpl: okFetch, limits: { ...limits, rateLimitPerMin: 1 } });
  assert.equal((await h(post(userMsg('a')), env)).status, 200);
  const res = await h(post(userMsg('b')), env);
  assert.equal(res.status, 429);
  assert.ok(res.headers.get('Retry-After'));
});

test('chat: all providers failing gives a graceful 503 with the full attempt list', async () => {
  const h = createHandler({ models: okModels, fetchImpl: async () => ({ ok: false, status: 500, text: async () => '{"error":{"message":"down"}}' }) });
  const res = await h(post(userMsg()), env);
  assert.equal(res.status, 503);
  const j = await res.json();
  assert.equal(j.error, 'busy');
  assert.equal(j.attempts.length, 3);
  assert.ok(j.attempts.every((a) => a.reason && a.status === 500));
});

test('chat: all 429 upstream is flagged as rate_limited_upstream', async () => {
  const h = createHandler({ models: okModels, fetchImpl: async () => ({ ok: false, status: 429, text: async () => '{"error":{"message":"limit"}}' }) });
  const res = await h(post(userMsg()), env);
  assert.equal(res.status, 429);
  assert.equal((await res.json()).error, 'rate_limited_upstream');
});

test('chat: unset models or no keys is a clear 503, not a crash', async () => {
  const unset = createHandler({ models: { status: 'unset', openrouter: { default: [] }, nvidia: { model: null } } });
  assert.equal((await unset(post(userMsg()), env)).status, 503);
  const nokeys = createHandler({ models: okModels, fetchImpl: okFetch });
  assert.equal((await nokeys(post(userMsg()), { ALLOWED_ORIGINS: 'https://app.test' })).status, 503);
});

test('cors: unknown origin refused, preflight works for allowed origin', async () => {
  const h = createHandler({ models: okModels, fetchImpl: okFetch });
  assert.equal((await h(post(userMsg(), { Origin: 'https://evil.test' }), env)).status, 403);
  const pre = await h(req('/chat', { method: 'OPTIONS', headers: { Origin: 'https://app.test' } }), env);
  assert.equal(pre.status, 204);
  assert.equal(pre.headers.get('Access-Control-Allow-Origin'), 'https://app.test');
});

test('unknown route is 404', async () => {
  const h = createHandler({ models: okModels });
  assert.equal((await h(req('/nope'), env)).status, 404);
});

test('cache failure does not break chat', async () => {
  const broken = { get: async () => { throw new Error('kv down'); }, put: async () => { throw new Error('kv down'); } };
  const h = createHandler({ models: okModels, fetchImpl: okFetch });
  const res = await h(post(userMsg('x')), { ...env, CACHE: broken });
  assert.equal(res.status, 200);
});
