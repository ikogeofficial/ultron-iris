import test from 'node:test';
import assert from 'node:assert/strict';
import { isFreeTextModel, selectOpenRouter, selectNvidia, applyOverrides } from '../scripts/lib/select.js';

const m = (id, ctx = 8000, extra = {}) => ({ id, context_length: ctx, pricing: { prompt: '0', completion: '0' }, ...extra });

test('only :free text models are accepted', () => {
  assert.equal(isFreeTextModel(m('a/b:free')), true);
  assert.equal(isFreeTextModel(m('a/b')), false);
  assert.equal(isFreeTextModel(m('a/embed-x:free')), false);
  assert.equal(isFreeTextModel({ ...m('a/b:free'), pricing: { prompt: '0.1', completion: '0' } }), false);
  assert.equal(isFreeTextModel({ ...m('a/b:free'), architecture: { output_modalities: ['image'] } }), false);
});

test('selectOpenRouter never returns a non-free ID and fills every role', () => {
  const list = [
    m('big/long:free', 1_000_000),
    m('mid/think:free', 128000, { supported_parameters: ['reasoning'] }),
    m('tiny/nano-8b:free', 32000),
    m('paid/model', 999999)
  ];
  const s = selectOpenRouter(list);
  for (const ids of Object.values(s)) {
    assert.ok(ids.length > 0);
    for (const id of ids) assert.ok(id.endsWith(':free'));
  }
  assert.equal(s.researcher[0], 'big/long:free');
  assert.equal(s.supervisor[0], 'mid/think:free');
  assert.equal(s.default[0], 'tiny/nano-8b:free');
  assert.ok(!s.default.includes('mid/think:free'));
});

test('selectOpenRouter handles empty or bad input', () => {
  assert.deepEqual(selectOpenRouter([]).default, []);
  assert.deepEqual(selectOpenRouter(null).default, []);
});

test('selectNvidia prefers super, skips non-chat models', () => {
  const id = selectNvidia([{ id: 'nvidia/nemotron-parse' }, { id: 'nvidia/nemotron-3-nano-30b' }, { id: 'nvidia/nemotron-3-super-120b' }, { id: 'meta/llama' }]);
  assert.equal(id, 'nvidia/nemotron-3-super-120b');
  assert.equal(selectNvidia([]), null);
});

test('applyOverrides rejects non-free OpenRouter IDs', () => {
  const base = { openrouter: { default: ['a:free'] }, nvidia: { model: null } };
  assert.throws(() => applyOverrides(base, { openrouter: { default: ['paid/x'] } }), /non-free/);
  const ok = applyOverrides(base, { openrouter: { default: ['b:free'] }, nvidia: { model: 'nvidia/x' } });
  assert.deepEqual(ok.openrouter.default, ['b:free']);
  assert.equal(ok.nvidia.model, 'nvidia/x');
});
