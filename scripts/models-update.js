// npm run models:update  -> rebuilds config/models.json from the live catalogs.
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { fetchCatalog, OPENROUTER_MODELS_URL, NVIDIA_MODELS_URL } from './lib/catalog.js';
import { selectOpenRouter, selectNvidia, applyOverrides } from './lib/select.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export async function buildModelsConfig({ fetchImpl = fetch, overrides = {}, nvidiaKey, now = () => new Date() } = {}) {
  const warnings = [];

  const orList = await fetchCatalog(OPENROUTER_MODELS_URL, fetchImpl);
  const openrouter = selectOpenRouter(orList);

  let nvidiaModel = null;
  try {
    const headers = nvidiaKey ? { Authorization: `Bearer ${nvidiaKey}` } : {};
    const nvList = await fetchCatalog(NVIDIA_MODELS_URL, fetchImpl, headers);
    nvidiaModel = selectNvidia(nvList);
  } catch (e) {
    warnings.push(`NVIDIA catalog not read (${e.message}). Set nvidia.model in config/models.overrides.json.`);
  }

  const merged = applyOverrides({ openrouter, nvidia: { model: nvidiaModel } }, overrides);

  for (const [role, ids] of Object.entries(merged.openrouter)) {
    if (!ids.length) warnings.push(`No free OpenRouter model found for role "${role}".`);
  }
  if (!merged.nvidia.model) warnings.push('No Nemotron model chosen: the NVIDIA fallback will be skipped.');

  const defaultOk = merged.openrouter.default?.length > 0;
  return {
    config: {
      status: defaultOk ? 'ok' : 'unset',
      generatedAt: now().toISOString(),
      openrouter: merged.openrouter,
      nvidia: merged.nvidia
    },
    warnings
  };
}

async function main() {
  const overrides = JSON.parse(await readFile(path.join(root, 'config/models.overrides.json'), 'utf8'));
  const { config, warnings } = await buildModelsConfig({ overrides, nvidiaKey: process.env.NVIDIA_KEY });
  await writeFile(path.join(root, 'config/models.json'), JSON.stringify(config, null, 2) + '\n');
  console.log(`config/models.json written (status: ${config.status})`);
  for (const [role, ids] of Object.entries(config.openrouter)) console.log(`  ${role}: ${ids.join(', ') || '(none)'}`);
  console.log(`  nvidia: ${config.nvidia.model ?? '(none)'}`);
  for (const w of warnings) console.warn(`WARNING: ${w}`);
  if (config.status !== 'ok') process.exit(1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error(`models:update FAILED: ${e.message}`); process.exit(1); });
}
