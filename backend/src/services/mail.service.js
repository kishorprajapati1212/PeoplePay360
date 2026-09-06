import { config } from '../config.js';
import { resolveDriver, render } from '../lib/mailer/index.js';
import { mailerFrom, resolveMailConfig, cachedLoader } from '../lib/mailer/runtime.js';
import * as repo from '../repositories/company.repo.js';

/**
 * Mail for the API process.
 *
 * The company row is read through a 15-second cache because a bulk invitation loop sends one message per
 * account and should not hit Postgres once per mail — and because a settings save must take effect within a
 * second, not a restart. `invalidate()` is what the company service calls after a save.
 */
const loader = cachedLoader(() => repo.mailRow());
export const invalidateMail = () => loader.invalidate();

/** The mailer every request path builds from: `PATCH /company` and this file are the only ways to change it. */
export const mailer = () => mailerFrom({ loadRow: loader.load, base: process.env });

/** What Settings → Company shows under the mail panel, and what `/health` prints. */
export async function mailStatus() {
  const row = await loader.load().catch(() => ({}));
  const plan = resolveDriver(resolveMailConfig(row, process.env));
  return {
    driver: plan.driver,
    from: plan.from,
    login: plan.login || plan.name || null,
    daily_limit: plan.dailyLimit,
    note: plan.note || null,
    // The row's own values, minus the secret, so the panel can show what is stored where.
    enabled: row.mail_enabled !== false && String(row.mail_enabled) !== 'false',
    host: row.smtp_host || null,
    port: row.smtp_port ?? null,
    secure: Boolean(row.smtp_secure),
    user: row.smtp_user || null,
    password_stored: Boolean(row.smtp_password),
    // Deliberately no provider contact here: this is read whenever the settings screen opens, and a "check
    // connection" that runs on page load would be a login attempt the admin never asked for. Use checkMail().
  };
}

/**
 * `POST /company/mail/check` — the two questions a mail setup has, answered in one call: does the login
 * connect (`verify`), and does a message actually arrive (`mail`). With no address it only connects, which is
 * the safe thing to press while a password is still being typed.
 *
 * Both go through the same mailer an invitation uses, so a green light here means the real thing works — that is
 * the whole point of the button.
 */
export async function checkMail({ to }) {
  const m = await mailer();
  const status = m.status();
  const verify = await m.verify();
  const connected = verify.ok !== false;
  if (!to) return { connected, verify, mail: null, ...pick(status) };
  // A login that will not connect cannot deliver either, so say that once instead of also failing the send.
  if (!connected) {
    return { connected, verify, mail: null, ...pick(status),
             note: 'The mail server refused the connection, so no message was attempted. The words above are its own.' };
  }
  return { connected, verify, mail: await send(m, to), ...pick(status) };
}
const pick = ({ driver, from }) => ({ driver, from });

async function send(m, to) {
  const status = m.status();
  const when = new Date().toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
  const vars = { driver: status.driver, from: status.from, when, host: process.env.SMTP_HOST || 'not set' };
  const text = render('PeoplePay360 mail test\n\nDriver: {{driver}}\nFrom: {{from}}\nSent: {{when}}\n\nIf you can read this in your inbox, the credentials are good and invitations will arrive.', vars);
  const html = render('<p><b>PeoplePay360 mail test</b></p><p>Driver: <code>{{driver}}</code><br/>From: <code>{{from}}</code><br/>Sent: {{when}}</p>'
    + '<p>If you can read this in your inbox, the credentials work and account invitations will arrive.</p>', vars);
  try {
    const out = await m.send({ to, subject: 'PeoplePay360 · mail test', text, html, previewDir: config.mailDir });
    return { ok: true, driver: out.driver, message_id: out.messageId || null, file: out.file || null, from: status.from,
             // In preview mode nothing was refused and nothing arrived: the .eml *is* the delivery, so name it
             // instead of letting "ok: true" read as "go and check your inbox".
             note: out.driver === 'preview'
               ? 'No SMTP login is configured, so this went to backend/storage/mail as a file rather than to an inbox. Fill in the host, user and password above and keep "Send real mail" on.'
               : null };
  } catch (e) {
    // The provider's own words are the answer: "Username and Password not accepted" means a login password was
    // used where an App Password was needed, and no message of ours could say that better than Gmail does.
    return { ok: false, driver: status.driver, error: e.message, from: status.from };
  }
}
