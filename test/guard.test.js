import test from 'node:test';
import assert from 'node:assert/strict';
import { validateChatBody, trimMessages, cacheKey, createRateLimiter } from '../worker/src/guard.js';
import { AGENTS } from '../worker/src/agents.js';
import limits from '../config/limits.json' with { type: 'json' };

test('validate accepts a normal body and defaults agent', () => {
  const r = validateChatBody({ messages: [{ role: 'user', content: 'hi' }] }, limits, AGENTS);
  assert.equal(r.ok, true);
  assert.equal(r.agent, 'default');
});

test('validate rejects bad bodies', () => {
  const bad = [null, [], {}, { messages: [] }, { messages: [{ role: 'system', content: 'x' }] },
    { messages: [{ role: 'user', content: '  ' }] },
    { messages: [{ role: 'assistant', content: 'x' }] },
    { agent: 'researcher', messages: [{ role: 'user', content: 'x' }] },
    { agent: '__proto__', messages: [{ role: 'user', content: 'x' }] },
    { messages: [{ role: 'user', content: 'x'.repeat(limits.maxMessageChars + 1) }] }];
  for (const b of bad) assert.equal(validateChatBody(b, limits, AGENTS).ok, false, JSON.stringify(b)?.slice(0, 60));
});

test('trim keeps last N and starts on a user turn', () => {
  const msgs = Array.from({ length: 10 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: String(i) }));
  const t = trimMessages(msgs, 6);
  assert.ok(t.length <= 6);
  assert.equal(t[0].role, 'user');
  assert.equal(t[t.length - 1].content, '9');
});

test('cache key is stable and input-sensitive', async () => {
  const a = await cacheKey('default', 'v1', [{ role: 'user', content: 'hi' }]);
  assert.equal(a, await cacheKey('default', 'v1', [{ role: 'user', content: 'hi' }]));
  assert.notEqual(a, await cacheKey('default', 'v2', [{ role: 'user', content: 'hi' }]));
  assert.notEqual(a, await cacheKey('default', 'v1', [{ role: 'user', content: 'ho' }]));
});

test('rate limiter blocks after the limit and recovers', () => {
  let t = 0;
  const check = createRateLimiter({ perMinute: 2, now: () => t });
  assert.equal(check('a').allowed, true);
  assert.equal(check('a').allowed, true);
  const blocked = check('a');
  assert.equal(blocked.allowed, false);
  assert.ok(blocked.retryAfter >= 1);
  assert.equal(check('b').allowed, true);
  t = 61_000;
  assert.equal(check('a').allowed, true);
});
