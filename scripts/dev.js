// One command for local development (no Docker): API + worker + React app, with clickable URLs.
//   node scripts/dev.js                 start all three
//   node scripts/dev.js --no-web        API + worker only
//   node scripts/dev.js --no-worker     API + web only
import { spawn } from 'node:child_process';
import { banner } from '../backend/src/utils/urls.js';

const flags = new Set(process.argv.slice(2));
const port = (key, fallback) => process.env[key] || fallback;
const API_PORT = port('PORT', '4000');
const WEB_PORT = port('WEB_PORT', '5173');
const WORKER_PORT = port('WORKER_PORT', '4100');

const children = [];
let shuttingDown = false;

function start(name, args) {
  const child = spawn('npm', args, { stdio: 'inherit', shell: false });
  child.on('exit', (code) => {
    if (!shuttingDown) {
      console.error(`\n[${name}] stopped with exit code ${code}\n`);
      stop(code ?? 1);
    }
  });
  children.push(child);
}

function stop(code = 0) {
  shuttingDown = true;
  for (const child of children) child.kill('SIGTERM');
  setTimeout(() => process.exit(code), 500);
}

process.on('SIGINT', () => stop(0));
process.on('SIGTERM', () => stop(0));

if (!flags.has('--no-api')) start('api', ['--prefix', 'backend', 'run', 'dev']);
if (!flags.has('--no-worker')) start('worker', ['--prefix', 'backend', 'run', 'worker:dev']);
if (!flags.has('--no-web')) start('web', ['--prefix', 'frontend', 'run', 'dev']);

// Give the processes a moment to boot, then print the URLs the terminal can open with Ctrl+Click.
setTimeout(() => {
  banner([
    ['Web app', `http://localhost:${WEB_PORT}`],
    ['Sign in', `http://localhost:${WEB_PORT}/login`],
    ['API', `http://localhost:${API_PORT}/api`],
    ['API health', `http://localhost:${API_PORT}/api/health`],
    ['Worker health', `http://localhost:${WORKER_PORT}/health`],
  ], 'PeoplePay360 · running');
  console.log('  Demo logins (password for all: Password@123)');
  console.log('  admin@oxp.com · hr@oxp.com · hr2@oxp.com · payroll@oxp.com · payroll-admin@oxp.com · <employee>@oxp.com\n');
}, 2500);
