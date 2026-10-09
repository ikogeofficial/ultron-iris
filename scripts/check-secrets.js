// Fails if anything that looks like a real key is in the repo (R11).
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SKIP = new Set(['node_modules', '.git', '.wrangler', 'dist']);

export const PATTERNS = [
  ['OpenRouter key', /sk-or-v1-[A-Za-z0-9]{20,}/],
  ['NVIDIA key', /nvapi-[A-Za-z0-9_-]{20,}/],
  ['Google API key', /AIza[0-9A-Za-z_-]{30,}/],
  ['Google OAuth secret', /GOCSPX-[A-Za-z0-9_-]{10,}/],
  ['Tavily key', /tvly-[A-Za-z0-9_-]{16,}/],
  ['JWT / Supabase key', /eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}/],
  ['Private key block', /-----BEGIN [A-Z ]*PRIVATE KEY-----/]
];

export function scanText(text) {
  const hits = [];
  for (const [label, re] of PATTERNS) if (re.test(text)) hits.push(label);
  return hits;
}

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

export function scanRepo(dir = root) {
  const problems = [];
  for (const file of walk(dir)) {
    const rel = path.relative(dir, file);
    const base = path.basename(file);
    if ((base === '.env' || (base.startsWith('.env.') && base !== '.env.example')) || base === '.dev.vars') {
      problems.push(`${rel}: environment file must not be committed`);
      continue;
    }
    if (statSync(file).size > 1_000_000) continue;
    const text = readFileSync(file, 'utf8');
    for (const label of scanText(text)) problems.push(`${rel}: looks like a ${label}`);
  }
  return problems;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const problems = scanRepo();
  if (problems.length) {
    console.error('SECRET SCAN FAILED');
    for (const p of problems) console.error(`  - ${p}`);
    process.exit(1);
  }
  console.log('secret scan OK');
}
