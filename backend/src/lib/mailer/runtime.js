import { createMailer } from './index.js';

/**
 * Which mail settings are live, right now, in whichever process is asking.
 *
 * Two things had to be true at once: mail must be configurable from Settings → Company (nobody should have to
 * edit `backend/.env` and restart to send an invitation), and a company that prefers its SMTP secret outside the
 * database must keep working through the environment. So the rule is one line — **the environment is the base,
 * a non-empty database value overwrites it** — and `mail_enabled` is the switch that can veto sending on its own.
 *
 * The API and the worker both come through here. That matters: they read from different configs
 * (`process.env` and the worker's `config.mail`), and a mailer built from only one of them is how "the button
 * sends but the queue does not" starts.
 */

/** @param {object} row  the company's mail columns (may be empty: a fresh database or a failed read) */
export function resolveMailConfig(row = {}, base = {}) {
  const out = { ...base };
  const text = (v) => (v === undefined || v === null || String(v).trim() === '' ? null : String(v).trim());
  const value = (key, v) => { const t = text(v); if (t !== null) out[key] = t; };

  value('SMTP_HOST', row.smtp_host);
  value('SMTP_PORT', row.smtp_port);
  value('EMAIL_NAME', row.smtp_user);
  value('MAIL_FROM', row.mail_from);
  value('MAIL_DAILY_LIMIT', row.mail_daily_limit);
  if (text(row.smtp_password) !== null) out.EMAIL_PASSWORD = String(row.smtp_password);

  // Only decide transport at all when the company has actually configured one; otherwise the env keeps its
  // say (including SMTP_SECURE, which a plain env deployment may well have set by hand).
  if (text(row.smtp_host) || text(row.smtp_user)) {
    out.SMTP_SECURE = row.smtp_secure ? 'true' : 'false';
    // An explicit "implicit TLS" box means a port-465 style server: nodemailer's `service: 'gmail'` preset
    // would silently rewrite that to STARTTLS, so the driver is pinned instead of left to auto-detection.
    if (row.smtp_secure) out.MAIL_DRIVER = 'smtp';
  }
  // The switch on the settings screen is the last word: off means preview, whatever the credentials say.
  if (row.mail_enabled === false || String(row.mail_enabled) === 'false') out.MAIL_DRIVER = 'preview';
  return out;
}

/**
 * A mailer for the calling process. `loadRow` is injected because the API reads through its pool and the
 * worker through its own tiny `one()` — the merge logic stays in one file either way.
 *
 * A read that fails (no database, migration not run yet) falls back to the environment rather than failing the
 * send: a company whose Postgres is briefly unreachable should still be able to mail payslips.
 */
export async function mailerFrom({ loadRow, base = {} }) {
  let row = {};
  try { row = (await loadRow()) || {}; } catch { row = {}; }
  return createMailer(resolveMailConfig(row, base));
}

/** So a settings save does not have to wait for the cache to expire. */
export function cachedLoader(load, ttlMs = 15_000) {
  let row = null;
  let at = 0;
  const load_ = async () => { row = await load(); at = Date.now(); return row; };
  return {
    load: async () => (!row || Date.now() - at > ttlMs ? await load_() : row),
    invalidate: () => { row = null; at = 0; },
  };
}
