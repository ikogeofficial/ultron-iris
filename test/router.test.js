import test from 'node:test';
import assert from 'node:assert/strict';
import { collectKeys, buildChain, runChain } from '../worker/src/router.js';
import { foldSystemIntoUser } from '../worker/src/adapters/shared.js';

const models = { openrouter: { default: ['m1:free', 'm2:free'] }, nvidia: { model: 'nvidia/nemotron-x' } };
const env = { OR_KEY_1: 'a', OR_KEY_2: 'b', OR_KEY_3: 'c', NVIDIA_KEY_1: 'n', OTHER: 'z', OR_KEY_9: '' };

const reply = (content, status = 200) => ({ ok: status < 400, status, text: async () => JSON.stringify(status < 400 ? { choices: [{ message: { content } }], usage: { total_tokens: 5 } } : { error: { message: content } }) });

test('collectKeys finds and orders keys, ignores empties and unrelated names', () => {
  const k = collectKeys(env);
  assert.deepEqual(k.or.map((x) => x.name), ['OR_KEY_1', 'OR_KEY_2', 'OR_KEY_3']);
  assert.deepEqual(k.nv.map((x) => x.name), ['NVIDIA_KEY_1']);
});

test('chain is capped at maxAttempts and ends with Nemotron', () => {
  const chain = buildChain(collectKeys(env), { maxAttempts: 3, nvidiaModel: 'x' });
  assert.equal(chain.length, 3);
  assert.equal(chain[2].provider, 'nvidia');
  assert.equal(chain.filter((c) => c.provider === 'openrouter').length, 2);
});

test('chain skips Nemotron when no model is set, and handles no keys', () => {
  assert.equal(buildChain(collectKeys(env), { maxAttempts: 3, nvidiaModel: null }).every((c) => c.provider === 'openrouter'), true);
  assert.deepEqual(buildChain(collectKeys({}), { maxAttempts: 3, nvidiaModel: 'x' }), []);
});

test('rotation changes the first key', () => {
  const k = collectKeys(env);
  assert.notEqual(buildChain(k, { maxAttempts: 3, startIndex: 0, nvidiaModel: 'x' })[0].name, buildChain(k, { maxAttempts: 3, startIndex: 1, nvidiaModel: 'x' })[0].name);
});

test('first success returns immediately', async () => {
  let calls = 0;
  const r = await runChain({ chain: buildChain(collectKeys(env), { maxAttempts: 3, nvidiaModel: 'x' }), role: 'default', models, messages: [{ role: 'user', content: 'hi' }], maxTokens: 50, timeoutMs: 1000, fetchImpl: async () => { calls++; return reply('hello'); } });
  assert.equal(r.ok, true);
  assert.equal(r.reply, 'hello');
  assert.equal(calls, 1);
});

test('falls through 429s to Nemotron and records every attempt', async () => {
  const seen = [];
  const fetchImpl = async (url, init) => {
    seen.push(url);
    return url.includes('nvidia') ? reply('from nemotron') : reply('rate limited', 429);
  };
  const r = await runChain({ chain: buildChain(collectKeys(env), { maxAttempts: 3, nvidiaModel: 'x' }), role: 'default', models, messages: [{ role: 'user', content: 'hi' }], maxTokens: 50, timeoutMs: 1000, fetchImpl });
  assert.equal(r.ok, true);
  assert.equal(r.provider, 'nvidia');
  assert.equal(r.attempts.length, 3);
  assert.equal(r.attempts[0].rateLimited, true);
  assert.equal(seen.length, 3);
});

test('all failing: never throws, lists every reason, flags all-429', async () => {
  const chain = buildChain(collectKeys(env), { maxAttempts: 3, nvidiaModel: 'x' });
  const r = await runChain({ chain, role: 'default', models, messages: [], maxTokens: 50, timeoutMs: 1000, fetchImpl: async () => reply('slow down', 429) });
  assert.equal(r.ok, false);
  assert.equal(r.allRateLimited, true);
  assert.equal(r.attempts.length, 3);
  assert.ok(r.attempts.every((a) => a.status === 429 && a.reason));
  const r2 = await runChain({ chain, role: 'default', models, messages: [], maxTokens: 50, timeoutMs: 1000, fetchImpl: async () => { throw new Error('boom'); } });
  assert.equal(r2.ok, false);
  assert.equal(r2.allRateLimited, false);
  assert.match(r2.attempts[0].reason, /boom/);
});

test('empty reply counts as a failure, not a success', async () => {
  const r = await runChain({ chain: buildChain(collectKeys({ OR_KEY_1: 'a' }), { maxAttempts: 1, nvidiaModel: null }), role: 'default', models, messages: [], maxTokens: 50, timeoutMs: 1000, fetchImpl: async () => reply('   ') });
  assert.equal(r.ok, false);
  assert.match(r.attempts[0].reason, /empty reply/);
});

test('missing model for role is recorded, not crashed on', async () => {
  const r = await runChain({ chain: buildChain(collectKeys({ OR_KEY_1: 'a' }), { maxAttempts: 1, nvidiaModel: null }), role: 'researcher', models, messages: [], maxTokens: 50, timeoutMs: 1000, fetchImpl: async () => reply('x') });
  assert.equal(r.ok, false);
  assert.match(r.attempts[0].reason, /no model/);
});

test('system role is folded for providers that reject it', () => {
  const out = foldSystemIntoUser([{ role: 'system', content: 'S' }, { role: 'user', content: 'U' }]);
  assert.equal(out.length, 1);
  assert.equal(out[0].content, 'S\n\nU');
});

test('API keys never appear in attempt records', async () => {
  const r = await runChain({ chain: buildChain(collectKeys({ OR_KEY_1: 'SECRETVALUE' }), { maxAttempts: 1, nvidiaModel: null }), role: 'default', models, messages: [], maxTokens: 50, timeoutMs: 1000, fetchImpl: async () => reply('bad', 401) });
  assert.ok(!JSON.stringify(r).includes('SECRETVALUE'));
});
