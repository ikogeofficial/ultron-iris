import test from 'node:test';
import assert from 'node:assert/strict';
import { scanText, scanRepo } from '../scripts/check-secrets.js';
import models from '../config/models.json' with { type: 'json' };

test('secret scanner catches key shapes and passes plain text', () => {
  assert.ok(scanText('sk-or-v1-' + 'a'.repeat(30)).length > 0);
  assert.ok(scanText('nvapi-' + 'B'.repeat(30)).length > 0);
  assert.ok(scanText(['-----BEGIN', 'PRIVATE KEY-----'].join(' ')).length > 0);
  assert.equal(scanText('OR_KEY_1=').length, 0);
});

test('this repo contains no secrets', () => {
  assert.deepEqual(scanRepo(), []);
});

test('committed models.json is either unset or only free IDs', () => {
  if (models.status !== 'ok') return;
  for (const ids of Object.values(models.openrouter)) for (const id of ids) assert.ok(id.endsWith(':free'), id);
});
