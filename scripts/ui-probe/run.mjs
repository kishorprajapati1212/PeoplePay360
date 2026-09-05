/*
 * Runs the UI probe: bundles scripts/ui-probe/ui-probe.jsx with the esbuild that ships with Vite, puts it
 * in a jsdom window with a stubbed fetch, and prints what each screen actually rendered.
 *
 *   node scripts/ui-probe/run.mjs
 *
 * jsdom is deliberately not a project dependency (it is 40 packages of dev-only weight); if it is missing
 * this prints the one command that fixes it. React and the app's own modules resolve from frontend/.
 */
import { existsSync, readFileSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { build } from '../../frontend/node_modules/esbuild/lib/main.js';

const HERE = new URL('.', import.meta.url).pathname;
const FRONTEND = join(HERE, '..', '..', 'frontend');
const ENTRY = join(HERE, 'ui-probe.jsx');
if (!existsSync(join(FRONTEND, 'node_modules', 'esbuild'))) {
  console.error('frontend dependencies are missing — run: npm --prefix frontend install');
  process.exit(2);
}

let jsdomPath;
try {
  jsdomPath = createRequire(join(HERE, 'x.js')).resolve('jsdom');
} catch {
  try { jsdomPath = createRequire(join(FRONTEND, 'package.json')).resolve('jsdom'); } catch { jsdomPath = null; }
}
if (!jsdomPath) {
  console.error('jsdom is not installed — the probe cannot run without it:\n  npm install --no-save jsdom');
  process.exit(2);
}
const { JSDOM } = await import(jsdomPath);

const out = join(mkdtempSync(join(tmpdir(), 'ui-probe-')), 'bundle.js');
await build({
  entryPoints: [ENTRY],
  bundle: true,
  format: 'iife',
  platform: 'browser',
  jsx: 'automatic',
  target: 'es2020',
  outfile: out,
  nodePaths: [join(FRONTEND, 'node_modules')],
  loader: { '.js': 'jsx', '.css': 'empty' },
  define: {
    // import.meta.env is a Vite-only object; the probe pins the two values the app reads.
    'import.meta.env': JSON.stringify({ VITE_API_BASE: '/api', VITE_APP_NAME: 'PeoplePay360', MODE: 'test', DEV: false, PROD: false }),
    'process.env.NODE_ENV': '"development"',
  },
  logLevel: 'error',
});

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
  url: 'http://localhost:5173/', runScripts: 'dangerously', pretendToBeVisual: true,
});
const { window } = dom;
window.matchMedia = window.matchMedia || (() => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
window.ResizeObserver = window.ResizeObserver || class { observe() {} unobserve() {} disconnect() {} };
window.scrollTo = () => {};

const errors = [];
window.addEventListener('error', (e) => errors.push(`${e.error?.message || e.message}\n${(e.error?.stack || '').split('\n').slice(1, 4).join('\n')}`));

const tag = window.document.createElement('script');
tag.textContent = readFileSync(out, 'utf8');
window.document.body.appendChild(tag);
await new Promise((r) => setTimeout(r, 400));

if (typeof window.__runProbe !== 'function') {
  console.error('the probe never registered — the bundle did not evaluate');
  if (errors.length) console.error('\n' + errors.slice(0, 3).join('\n'));
  process.exit(2);
}
const report = await window.__runProbe();

/**
 * Rules about source the DOM cannot reach, in the same format and the same exit code as the rendered cases.
 * A browser bundle has no `fs`, so anything that has to read a file belongs here rather than in the probe:
 * the payrun progress bar, for instance, is three state transitions behind a computed run.
 */
const SOURCE_RULES = [
  ['a bar is a bar · no chart or progress track is drawn with round ends', /rounded-full/,
    ['pages/dashboards/charts.jsx', 'pages/payroll/PayrunDetailPage.jsx'],
    'a 6px or 8px track with rounded-full is a pill; use rounded-sm and let the track clip the fill'],
];
const sourceLines = [];
for (const [name, forbidden, files, advice] of SOURCE_RULES) {
  const hits = files.filter((rel) => forbidden.test(readFileSync(join(FRONTEND, 'src', rel), 'utf8')));
  if (hits.length) {
    sourceLines.push(`  ✗ ${name}\n      found in ${hits.join(', ')} — ${advice}`);
    errors.push(`${name}: rounded ends still drawn in ${hits.join(', ')}`);
  } else sourceLines.push(`  ok   ${name}`);
}
console.log(report);
if (sourceLines.length) console.log('\nscreen rules read from source\n' + sourceLines.join('\n'));
if (errors.length) console.log('');
if (errors.length) console.log('\nwindow errors:\n' + errors.slice(0, 4).join('\n'));
process.exit(/probe cases clean/.test(report) && errors.length === 0 ? 0 : 1);
