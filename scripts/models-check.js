// npm run models:check -> fails loudly if any configured model is gone or not free (R4).
import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { fetchCatalog, OPENROUTER_MODELS_URL, NVIDIA_MODELS_URL } from './lib/catalog.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export async function checkModels(config, { fetchImpl = fetch, nvidiaKey } = {}) {
  const problems = [];
  if (config.status !== 'ok') {
    return ['config/models.json is not generated yet. Run: npm run models:update'];
  }
  const orList = await fetchCatalog(OPENROUTER_MODELS_URL, fetchImpl);
  const known = new Map(orList.map((m) => [m.id, m]));
  for (const [role, ids] of Object.entries(config.openrouter)) {
    if (!ids.length) problems.push(`Role "${role}" has no models.`);
    for (const id of ids) {
      if (!id.endsWith(':free')) problems.push(`${role}: ${id} does not end in :free`);
      else if (!known.has(id)) problems.push(`${role}: ${id} is no longer in the OpenRouter catalog (404 risk)`);
    }
  }
  if (config.nvidia?.model) {
    try {
      const headers = nvidiaKey ? { Authorization: `Bearer ${nvidiaKey}` } : {};
      const nv = await fetchCatalog(NVIDIA_MODELS_URL, fetchImpl, headers);
      if (!nv.some((m) => m.id === config.nvidia.model)) {
        problems.push(`nvidia: ${config.nvidia.model} is not in the NVIDIA catalog`);
      }
    } catch (e) {
      problems.push(`nvidia catalog could not be read (${e.message}); model not verified`);
    }
  }
  return problems;
}

async function main() {
  const config = JSON.parse(await readFile(path.join(root, 'config/models.json'), 'utf8'));
  const problems = await checkModels(config, { nvidiaKey: process.env.NVIDIA_KEY });
  if (problems.length) {
    console.error('models:check FAILED');
    for (const p of problems) console.error(`  - ${p}`);
    process.exit(1);
  }
  console.log('models:check OK: every configured model exists and is free.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error(`models:check FAILED: ${e.message}`); process.exit(1); });
}
