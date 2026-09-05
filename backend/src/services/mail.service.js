import { config } from '../config.js';
import { resolveDriver, render } from '../lib/mailer/index.js';
import { mailerFrom, resolveMailConfig, cachedLoader } from '../lib/mailer/runtime.js';
import { describeServer, providerList } from '../lib/mailer/index.js';
import { appPasswordShapeHint } from '../lib/mailer/providers.js';
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
    // What will actually be dialed, and where that came from. `inferred` is the whole point of the address-only
    // form: when it is set, nobody typed a host and none is needed.
    server: plan.server ? describeServer(plan.server) : null,
    server_host: plan.server?.host || null,
    inferred: plan.inferred || null,
    needs_app_password: Boolean(plan.needsAppPassword),
    // The length of a password is not a secret, and it is the single most common mail-setup mistake: Google
    // hands out 16 characters, and people paste the 12-character one from an older form (or a login password).
    // Saying it here beats reading a 535 from the provider and guessing.
    password_length: plan.passwordLength || 0,
    password_shape: appPasswordShapeHint(plan.providerBrand, plan.passwordLength),
    provider_note: plan.providerNote || null,
    // Served, not copied into the frontend, so a provider added to providers.js shows up in the panel unchanged.
    providers: providerList(),
    // A host that was typed on purpose and disagrees with the address is worth a sentence and a button; a
    // placeholder is not a conflict, it is nothing, and resolveDriver already said so.
    conflict: row.smtp_host && plan.provider && !plan.ignoredHost
      && String(row.smtp_host).toLowerCase() !== plan.provider.host.toLowerCase()
      ? { stored_host: row.smtp_host, wanted_host: plan.provider.host, brand: plan.provider.brand,
          wanted_server: describeServer({ host: plan.provider.host, port: plan.provider.port, secure: plan.provider.secure }) }
      : plan.ignoredHost ? { stored_host: plan.ignoredHost, ignored: true, wanted_server: describeServer(plan.server),
                             brand: plan.provider.brand } : null,
    // The link window, as the row states it (null = whatever INVITE_TTL_MINUTES says). Shown on the settings panel
    // and on the Users page, because "did the mail go out and how long does the link work" is one question.
    invite_ttl_minutes: Number.isFinite(Number(row.mail_invite_ttl_minutes)) && Number(row.mail_invite_ttl_minutes) > 0
      ? Number(row.mail_invite_ttl_minutes) : null,
    // Deliberately no provider contact here: this is read whenever the settings screen opens, and a "check
    // connection" that runs on page load would be a login attempt the admin never asked for. Use checkMail().
  };
}

/**
 * Minutes an invitation link stays valid: the company row when it says something, the environment otherwise.
 * Kept here because this service is what reads and caches that row, and an invitation is the only thing that
 * asks. Clamped to 1-1440 so a mistyped 0 cannot make every link expire before it is mailed.
 */
export async function inviteTtlMinutes() {
  const row = await loader.load().catch(() => ({}));
  const stored = Number(row.mail_invite_ttl_minutes);
  const minutes = Number.isFinite(stored) && stored > 0 ? stored : config.invite.ttlMinutes;
  return Math.min(1440, Math.max(1, Math.round(minutes)));
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
  const shape = appPasswordShapeHint(status.providerBrand, status.passwordLength);
  const verify = await m.verify();
  const connected = verify.ok !== false;
  // The count comes first, because it is the part a person can fix in ten seconds; the provider's own words
  // follow for every other kind of refusal.
  if (!connected) verify.hint = [shape, refusalHint(verify.error)].filter(Boolean).join(' ') || null;
  if (!to) return { connected, verify, mail: null, ...pick(status) };
  // A login that will not connect cannot deliver either, so say that once instead of also failing the send.
  if (!connected) {
    return { connected, verify, mail: null, ...pick(status),
             note: 'The mail server refused the connection, so no message was attempted. The words above are its own.' };
  }
  return { connected, verify, mail: await send(m, to), ...pick(status) };
}
const pick = ({ driver, from, server, inferred, needsAppPassword, providerBrand, passwordLength }) =>
  ({ driver, from, server: server ? describeServer(server) : null, inferred: inferred || null,
     needs_app_password: Boolean(needsAppPassword), password_length: passwordLength || 0,
     password_shape: appPasswordShapeHint(providerBrand, passwordLength) });

/**
 * The two ways a mail setup fails, told apart by the words the provider used, because the fix is different:
 * a refused login is a password problem, and a host that never answers is a server problem. Anything else gets
 * the server's own sentence and no guess from us.
 */
/** Exported because its two sentences are the whole answer to a failed mail setup, and a test should keep them pointed at the real provider wording. */
export function refusalHint(error) {
  const text = String(error || '').toLowerCase();
  if (/username and password|invalid login|535|authfailed|too many failed/.test(text)) {
    return 'That is the login being refused, not the network. Gmail and Google Workspace want an **App Password** '
         + '(Google account → Security → 2-Step Verification → App passwords) in the password box, never the '
         + 'password you type on the website; the 16 characters with a space in the middle are pasted as they are shown.';
  }
  if (/econnrefused|etimedout|enotfound|esocket|connect |tls|ssl/.test(text)) {
    return 'Nothing answered on that host and port. For a Gmail address the app picks smtp.gmail.com:465 with '
         + 'implicit TLS on its own, and both work: if 465 is blocked where this runs, type port 587 with '
         + '*implicit TLS* left off in the advanced boxes and 587 / STARTTLS is used instead. Some hosts block 25 '
         + 'and 465 out entirely — that is a firewall, not a password. Then check this machine can reach the '
         + 'internet on that port at all.';
  }
  return 'The words above are the server\u2019s own. Fix that and press again — nothing was sent while it fails.';
}

async function send(m, to) {
  const status = m.status();
  const when = new Date().toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
  const vars = { driver: status.driver, from: status.from, when,
    host: status.server ? `${status.server} · ${status.login}` : 'not set (no SMTP login configured)' };
  const text = render('PeoplePay360 mail test\n\nDriver: {{driver}}\nFrom: {{from}}\nSent: {{when}}\n\nIf you can read this in your inbox, the credentials are good and invitations will arrive.', vars);
  const html = render('<p><b>PeoplePay360 mail test</b></p><p>Driver: <code>{{driver}}</code><br/>From: <code>{{from}}</code><br/>Sent: {{when}}</p>'
    + '<p>If you can read this in your inbox, the credentials work and account invitations will arrive.</p>', vars);
  try {
    const out = await m.send({ to, subject: 'PeoplePay360 · mail test', text, html, previewDir: config.mailDir });
    return { ok: true, driver: out.driver, message_id: out.messageId || null, file: out.file || null, from: status.from,
             // In preview mode nothing was refused and nothing arrived: the .eml *is* the delivery, so name it
             // instead of letting "ok: true" read as "go and check your inbox".
             note: out.driver === 'preview'
               ? 'No SMTP login is configured, so this went to backend/storage/mail as a file rather than to an inbox. The mail account and its password are the only two boxes that need filling (a Gmail, Outlook, Zoho, Yahoo, iCloud, Fastmail or QQ address picks its own server), then keep "Send real mail" on.'
               : null };
  } catch (e) {
    // The provider's own words are the answer: "Username and Password not accepted" means a login password was
    // used where an App Password was needed, and no message of ours could say that better than Gmail does.
    return { ok: false, driver: status.driver, error: e.message, from: status.from };
  }
}
