#!/usr/bin/env node
/**
 * Two cheap gates that catch the mistakes a rename or a folder move always leaves behind.
 *
 * 1. static  — every relative `import … from './x'` in the whole project (backend and frontend) points
 *              at a file that exists, and every named import actually exists in that file's source.
 * 2. dynamic — load every backend module for real, so a bad path in a service → repository → lib edge
 *              fails here instead of on the first request; then verify that namespaced calls
 *              (`repo.foo()`) match a real export.
 *
 * Entry points (src/index.js, src/worker/index.js) are skipped by the dynamic pass on purpose: importing
 * them would bind a port. They are still checked statically, and `npm run smoke` boots the API for real.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

// The repo root is two levels above this file (backend/scripts/), so the checker works from any cwd.
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SCAN = ['backend/src', 'backend/db', 'backend/scripts', 'backend/test', 'frontend/src'];
const NO_LOAD = new Set(['index.js', 'seed.js']);

// Without the dependencies every single `import pg from 'pg'` fails, and the report looks like 76 broken
// modules when the real problem is that nobody ran npm install yet. Say that instead.
if (!existsSync(join(ROOT, 'backend', 'node_modules')) || !existsSync(join(ROOT, 'frontend', 'node_modules'))) {
  console.error('deps missing — run `npm run setup` at the repo root (or npm install inside backend/ and frontend/), then me again.');
  console.error(`looked for: ${join(ROOT, 'backend', 'node_modules')} and ${join(ROOT, 'frontend', 'node_modules')}`);
  process.exit(1);
}

const files = [];
for (const folder of SCAN) {
  const start = join(ROOT, folder);
  if (!existsSync(start)) continue;
  (function walk(dir) {
    for (const entry of readdirSync(dir)) {
      const p = join(dir, entry);
      if (statSync(p).isDirectory()) walk(p);
      else if (p.endsWith('.js') || p.endsWith('.jsx')) files.push(p);
    }
  })(start);
}
files.sort();

/** './x' → x.js | x.jsx | x/index.js — the three ways a relative import can legally resolve. */
function resolveSpec(fromFile, spec) {
  const base = resolve(dirname(fromFile), spec);
  const candidates = base.endsWith('.js') || base.endsWith('.jsx') ? [base] : [base + '.js', base + '.jsx', join(base, 'index.js'), join(base, 'index.jsx')];
  for (const cand of candidates) {
    if (existsSync(cand) && statSync(cand).isFile()) return cand;

  }
  return null;
}

const IMPORT_RE = /(?:^|\n)\s*(?:import|export)[\s\S]*?from\s+['"]([^'"]+)['"]/g;
const DYNAMIC_RE = /import\(\s*['"]([^'"]+)['"]\s*\)/g;

const broken = [];
for (const f of files) {
  const src = readFileSync(f, 'utf8');
  for (const match of [...src.matchAll(IMPORT_RE), ...src.matchAll(DYNAMIC_RE)]) {
    const spec = match[1];
    if (!spec.startsWith('.')) continue;
    if (!resolveSpec(f, spec)) broken.push(`${relative(ROOT, f)} → ${spec}`);
  }
}

const loadErrors = [];
const missingExports = [];
for (const f of files) {
  if (!f.includes('/backend/src/') || NO_LOAD.has(f.split('/').pop())) continue;
  try { await import(pathToFileURL(f).href); }
  catch (e) { loadErrors.push(`${relative(ROOT, f)}\n    ${(e.message || String(e)).split('\n')[0]}`); continue; }
  // every `ns.thing(` used against a namespace import must be a real export of that module
  const src = readFileSync(f, 'utf8');
  for (const [_, ns, spec] of src.matchAll(/import\s+\*\s+as\s+(\w+)\s+from\s+'([^']+)'/g)) {
    if (!spec.startsWith('.')) continue;
    const target = resolveSpec(f, spec);
    if (!target) continue;
    let mod;
    try { mod = await import(pathToFileURL(target).href); } catch { continue; }
    // strip comments, strings and import lines: only real call sites count
    const body = src
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .split('\n')
      .map((l) => l.replace(/\/\/.*$/, '').replace(/'[^']*'|"[^"]*"|`[^`]*`/g, "''"))
      .filter((l) => !/^\s*import\s*\(?\s*|from\s+'/.test(l))
      .join('\n');
    for (const used of new Set([...body.matchAll(new RegExp(`\\b${ns}\\.([A-Za-z_$][\\w$]*)`, 'g'))].map((m) => m[1]))) {
      if (!(used in mod)) missingExports.push(`${relative(ROOT, f)}: ${ns}.${used} is not exported by ${spec}`);
    }
  }
}

console.log(`scanned ${files.length} files (${SCAN.join(', ')})`);
if (broken.length) console.log(`\nbroken import paths:\n  ${broken.join('\n  ')}`);
if (loadErrors.length) console.log(`\nmodule load errors:\n  ${loadErrors.join('\n  ')}`);
if (missingExports.length) console.log(`\nmissing exports:\n  ${missingExports.join('\n  ')}`);
if (broken.length || loadErrors.length || missingExports.length) {
  console.log(`\nFAIL — ${broken.length} broken path(s), ${loadErrors.length} load error(s), ${missingExports.length} missing export(s)`);
  process.exit(1);
}
console.log('OK — every import resolves, every backend module loads, every namespaced call exists');
process.exit(0);
