import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Zero-config by design: every value has a working default, so `docker compose up` (or plain
 * `node src/index.js` against the bundled Postgres/Redis) boots with an empty environment.
 * Override anything with real env vars or with backend/.env (that file is dev defaults, not secrets).
 */
const here = dirname(fileURLToPath(import.meta.url));
export const ROOT = join(here, '..');
function loadDotEnv() {
  for (const p of [join(ROOT, '.env.local'), join(ROOT, '.env')]) {
    try {
      for (const line of readFileSync(p, 'utf8').split('\n')) {
        const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/i.exec(line);
        if (!m) continue;
        const key = m[1];
        let v = m[2].trim();
        if (/^".*"$/.test(v) || /^'.*'$/.test(v)) v = v.slice(1, -1);
        if (process.env[key] === undefined) process.env[key] = v;
      }
    } catch { /* no .env — defaults are enough */ }
  }
}
loadDotEnv();
const env = (k, d) => (process.env[k] === undefined || process.env[k] === '' ? d : process.env[k]);
const num = (k, d) => (env(k, d) === d ? d : Number(env(k, d)));
const bool = (k, d) => String(env(k, d)).toLowerCase() === 'true';

export const config = {
  env: env('NODE_ENV', 'development'),
  host: env('HOST', '0.0.0.0'),
  isProd: env('NODE_ENV') === 'production',
  port: num('PORT', 4000),
  webOrigin: env('WEB_ORIGIN', 'http://localhost:5173'),
  webPort: num('WEB_PORT', 5173),
  workerPort: num('WORKER_PORT', 4100),
  databaseUrl: env('DATABASE_URL', 'postgres://postgres:postgres@127.0.0.1:5432/peoplepay360'),
  pg: { ssl: bool('PG_SSL', false), max: num('PG_POOL_MAX', 10), idleTimeoutMillis: num('PG_IDLE_MS', 30_000) },
  redis: { host: env('REDIS_HOST', '127.0.0.1'), port: num('REDIS_PORT', 6379), password: env('REDIS_PASSWORD', '') || undefined, db: num('REDIS_DB', 0), tls: bool('REDIS_TLS', false) },
  jwt: { secret: env('JWT_SECRET', 'dev-only-insecure-secret-change-me'), accessTtl: env('JWT_ACCESS_TTL', '12h'), refreshTtlDays: num('JWT_REFRESH_DAYS', 30), issuer: env('JWT_ISSUER', 'peoplepay360') },
  cookies: { name: 'pp360_rt', secure: bool('COOKIE_SECURE', false), sameSite: env('COOKIE_SAME_SITE', 'lax'), domain: env('COOKIE_DOMAIN', '') || undefined },
  bcrypt: { rounds: num('BCRYPT_ROUNDS', 10) },
  uploadDir: env('UPLOAD_DIR', join(ROOT, 'storage/uploads')),
  mailDir: env('MAIL_DIR', join(ROOT, 'storage/mail')),
  pdf: { renderer: env('PDF_RENDERER', 'pdfkit'), dir: env('PDF_DIR', join(ROOT, 'storage/pdfs')) },
  // Sending: leave EMAIL_NAME/EMAIL_PASSWORD empty and nothing leaves the machine (.eml files in storage/mail).
  // Fill them in with your Gmail address + an App Password and real sending switches on by itself.
  mail: { driver: env('MAIL_DRIVER', ''), from: env('MAIL_FROM', ''), dailyLimit: num('MAIL_DAILY_LIMIT', 200),
    name: env('EMAIL_NAME', env('GMAIL_USER', env('SMTP_USER', ''))),
    password: env('EMAIL_PASSWORD', env('GMAIL_APP_PASSWORD', env('SMTP_PASS', ''))),
    host: env('SMTP_HOST', ''), port: num('SMTP_PORT', 587), secure: bool('SMTP_SECURE', false) },
  queue: { concurrency: num('WORKER_CONCURRENCY', 2), stalledAfterMs: num('QUEUE_STALLED_MS', 60_000) },
  demo: { enabled: bool('SEED_DEMO', true), password: env('DEMO_PASSWORD', 'Password@123') },
  login: { maxAttempts: num('LOGIN_MAX_ATTEMPTS', 8), windowSec: num('LOGIN_WINDOW_SEC', 300), lockoutSec: num('LOGIN_LOCKOUT_SEC', 900) },
  rate: { enabled: bool('RATE_LIMIT', true), perMinute: num('RATE_PER_MINUTE', 240) },
  cors: { extraOrigins: env('CORS_ORIGINS', '').split(',').map((s) => s.trim()).filter(Boolean) },
  // The SPA dev server + whatever CORS_ORIGINS lists; '*' when the web origin is wildcarded on purpose.
  webDist: env('WEB_DIST', join(ROOT, '..', 'frontend', 'dist')),
  serveStatic: bool('SERVE_WEB', true),
  // The address a link in an e-mail should use. WEB_ORIGIN is right on a laptop; on a shared box set
  // PUBLIC_APP_URL to what the browser actually types, or every invite lands with an unreachable link.
  appUrl: env('PUBLIC_APP_URL', env('WEB_ORIGIN', 'http://localhost:5173')),
  // An invitation is sent by the request that made it, one message per account — nobody has to wait for a
  // worker, and nothing is lost when Redis is not running. INVITE_VIA_QUEUE=true is the opposite choice:
  // hand each account its own job and let the worker dial SMTP (its retries, its rate limits).
  invite: { ttlHours: num('INVITE_TTL_HOURS', 72), viaQueue: bool('INVITE_VIA_QUEUE', false), bulkLimit: num('INVITE_BULK_LIMIT', 50) },
  features: { invite: bool('FEATURE_INVITE', true), sso: bool('FEATURE_SSO', false), kiosk: bool('FEATURE_KIOSK', true) },
};
Object.defineProperty(config.cors, 'origin', {
  get() {
    if (config.env === 'development') return true; // Vite on another port, Docker on any host — dev only
    return [config.webOrigin, ...config.cors.extraOrigins];
  },
});
export const publicConfig = () => ({
  env: config.env, webOrigin: config.webOrigin, features: config.features,
  currency: 'INR', currencySymbol: '₹', timezone: env('TZ', 'Asia/Kolkata'),
  pdfRenderer: config.pdf.renderer, mailDriver: config.mail.driver,
});
