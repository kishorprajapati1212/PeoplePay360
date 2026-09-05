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
/*
 * Redis can be pointed at with either style, and both the API and this worker accept both — because a
 * docker-compose file that sets REDIS_HOST=redis while the worker only understood REDIS_URL silently
 * retried against 127.0.0.1 forever. Precedence: REDIS_URL, then REDIS_HOST/PORT, then localhost.
 */
const urlTarget = env('REDIS_URL', '');
const redisUrl = urlTarget ? url(urlTarget) : null;
const hostOf = (fallback) => (redisUrl?.hostname || env('REDIS_HOST', '') || fallback).replace(/^https?:\/\//, '');
const portOf = () => Number(redisUrl?.port || env('REDIS_PORT', '') || 6379);

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
    host: hostOf('127.0.0.1'),
    port: portOf(),
    password: (redisUrl?.password ? decodeURIComponent(redisUrl.password) : '') || env('REDIS_PASSWORD', '') || undefined,
    username: redisUrl?.username || env('REDIS_USERNAME', '') || undefined,
    db: num('REDIS_DB', redisUrl?.pathname ? Number(redisUrl.pathname.slice(1)) || 0 : 0),
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
    // Empty driver = the mailer decides: EMAIL_NAME + EMAIL_PASSWORD present → real sending, absent → .eml files.
    MAIL_DRIVER: env('MAIL_DRIVER', ''),
    MAIL_FROM: env('MAIL_FROM', ''),
    MAIL_DAILY_LIMIT: num('MAIL_DAILY_LIMIT', 200),
    EMAIL_NAME: env('EMAIL_NAME', ''), EMAIL_PASSWORD: env('EMAIL_PASSWORD', ''),
    SMTP_HOST: env('SMTP_HOST', ''), SMTP_PORT: env('SMTP_PORT', '587'), SMTP_SECURE: env('SMTP_SECURE', 'false'),
    dir: env('MAIL_DIR', join(ROOT, 'storage/mail')),
    publicBaseUrl: env('PUBLIC_WEB_URL', `http://localhost:${num('WEB_PORT', 5173)}`),
  },
  queues: { pdf: 'payslip-pdf', email: 'payslip-email' },
};
