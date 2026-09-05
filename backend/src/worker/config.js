import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
// Same dependency-free .env reader the API uses: .env holds dev defaults, not secrets.
for (const file of [join(ROOT, '.env.local'), join(ROOT, '.env')]) {
  try {
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/i.exec(line);
      if (m && process.env[m[1]] === undefined) {
        process.env[m[1]] = m[2].trim().replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1');
      }
    }
  } catch { /* no .env file is fine */ }
}

const env = (k, d) => (process.env[k] === undefined || process.env[k] === '' ? d : process.env[k]);
const num = (k, d) => (Number.isFinite(Number(env(k, d))) ? Number(env(k, d)) : d);
const url = (u) => { try { return new URL(u); } catch { return null; } };

/**
 * Worker config mirrors src/config.js and reads the same variables, so one .env drives both
 * processes (and one docker-compose service block can share it). Every value has a working default:
 * nothing has to be typed to run the stack.
 */
const databaseUrl = env('DATABASE_URL', 'postgres://postgres:postgres@127.0.0.1:5432/peoplepay360');
const dbUrl = url(databaseUrl);
const redisUrl = url(env('REDIS_URL', 'redis://127.0.0.1:6379'));

export const config = {
  env: env('NODE_ENV', 'development'),
  root: ROOT,
  db: {
    connectionString: databaseUrl,
    host: dbUrl?.hostname ?? '127.0.0.1',
    port: num('PGPORT', Number(dbUrl?.port || 5432)),
    user: decodeURIComponent(dbUrl?.username || 'postgres'),
    password: decodeURIComponent(dbUrl?.password || 'postgres'),
    database: (dbUrl?.pathname || '/peoplepay360').replace(/^\//, ''),
    ssl: env('PGSSL') === 'true' ? { rejectUnauthorized: false } : undefined,
    max: num('PG_POOL_MAX', 6),
  },
  redis: {
    host: redisUrl?.hostname ?? '127.0.0.1',
    port: num('REDIS_PORT', Number(redisUrl?.port || 6379)),
    password: redisUrl?.password ? decodeURIComponent(redisUrl.password) : undefined,
    username: redisUrl?.username || undefined,
    db: num('REDIS_DB', 0),
    tls: env('REDIS_TLS') === 'true',
  },
  worker: {
    port: num('WORKER_PORT', 4100),
    host: env('WORKER_HOST', '0.0.0.0'),
    concurrency: num('WORKER_CONCURRENCY', 4),
    reclaimSeconds: num('WORKER_RECLAIM_SECONDS', 90),
    webPort: num('WEB_PORT', 5173),
    apiPort: num('PORT', 4000),
  },
  pdf: { renderer: env('PDF_RENDERER', 'pdfkit'), dir: env('PDF_DIR', join(ROOT, 'storage/pdfs')) },
  mail: {
    MAIL_DRIVER: env('MAIL_DRIVER', 'preview'),
    MAIL_FROM: env('MAIL_FROM', 'OXP Payroll <payroll@oxp.com>'),
    MAIL_DAILY_LIMIT: num('MAIL_DAILY_LIMIT', 200),
    SMTP_HOST: env('SMTP_HOST', ''), SMTP_PORT: env('SMTP_PORT', '587'), SMTP_SECURE: env('SMTP_SECURE', 'false'),
    SMTP_USER: env('SMTP_USER', ''), SMTP_PASS: env('SMTP_PASS', ''),
    GMAIL_USER: env('GMAIL_USER', ''), GMAIL_APP_PASSWORD: env('GMAIL_APP_PASSWORD', ''),
    dir: env('MAIL_DIR', join(ROOT, 'storage/mail')),
    publicBaseUrl: env('PUBLIC_WEB_URL', `http://localhost:${num('WEB_PORT', 5173)}`),
  },
  queues: { pdf: 'payslip-pdf', email: 'payslip-email' },
};
