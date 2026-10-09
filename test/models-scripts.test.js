import test from 'node:test';
import assert from 'node:assert/strict';
import { buildModelsConfig } from '../scripts/models-update.js';
import { checkModels } from '../scripts/models-check.js';

const orData = [
  { id: 'x/long:free', context_length: 500000, pricing: { prompt: '0', completion: '0' } },
  { id: 'y/small-7b:free', context_length: 32000, pricing: { prompt: '0', completion: '0' } }
];
const nvData = [{ id: 'nvidia/nemotron-3-super-120b' }];

const fakeFetch = (routes) => async (url) => {
  const r = routes[url];
  if (!r) return { ok: false, status: 404, json: async () => ({}) };
  if (r === 'fail') return { ok: false, status: 500, json: async () => ({}) };
  return { ok: true, status: 200, json: async () => ({ data: r }) };
};
const OR = 'https://openrouter.ai/api/v1/models';
const NV = 'https://integrate.api.nvidia.com/v1/models';

test('buildModelsConfig produces status ok with a fixed clock', async () => {
  const { config, warnings } = await buildModelsConfig({
    fetchImpl: fakeFetch({ [OR]: orData, [NV]: nvData }), now: () => new Date('2026-01-01T00:00:00Z')
  });
  assert.equal(config.status, 'ok');
  assert.equal(config.generatedAt, '2026-01-01T00:00:00.000Z');
  assert.equal(config.nvidia.model, 'nvidia/nemotron-3-super-120b');
  assert.equal(warnings.length, 0);
});

test('NVIDIA failure is a warning, not a crash', async () => {
  const { config, warnings } = await buildModelsConfig({ fetchImpl: fakeFetch({ [OR]: orData, [NV]: 'fail' }) });
  assert.equal(config.status, 'ok');
  assert.equal(config.nvidia.model, null);
  assert.ok(warnings.some((w) => /NVIDIA/.test(w)));
});

test('OpenRouter failure throws loudly', async () => {
  await assert.rejects(buildModelsConfig({ fetchImpl: fakeFetch({ [OR]: 'fail' }) }), /HTTP 500/);
});

test('no free models gives status unset', async () => {
  const { config } = await buildModelsConfig({ fetchImpl: fakeFetch({ [OR]: [{ id: 'paid/x' }], [NV]: nvData }) });
  assert.equal(config.status, 'unset');
});

test('checkModels flags unset config, missing and non-free models', async () => {
  assert.match((await checkModels({ status: 'unset' }))[0], /not generated/);
  const cfg = { status: 'ok', openrouter: { default: ['x/long:free', 'gone:free', 'paid/x'] }, nvidia: { model: 'nvidia/gone' } };
  const problems = await checkModels(cfg, { fetchImpl: fakeFetch({ [OR]: orData, [NV]: nvData }) });
  assert.ok(problems.some((p) => /gone:free.*no longer/.test(p)));
  assert.ok(problems.some((p) => /paid\/x.*:free/.test(p)));
  assert.ok(problems.some((p) => /nvidia\/gone/.test(p)));
});

test('checkModels passes a healthy config', async () => {
  const cfg = { status: 'ok', openrouter: { default: ['x/long:free'] }, nvidia: { model: 'nvidia/nemotron-3-super-120b' } };
  assert.deepEqual(await checkModels(cfg, { fetchImpl: fakeFetch({ [OR]: orData, [NV]: nvData }) }), []);
});
