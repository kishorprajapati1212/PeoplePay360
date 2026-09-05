import { createTransport } from 'nodemailer';
import { writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { render, htmlEscape } from './template.js';
import { providerFor, providerNames, isPlaceholderHost, describeServer } from './providers.js';
export * from './providers.js';
export * from './template.js';

/**
 * Drivers:
 *   preview  – writes .eml files to storage/mail and returns ok (the default: zero config, nothing leaves the box)
 *   stream   – logs to stdout only (used by tests)
 *   smtp     – SMTP_* env
 *   gmail    – nodemailer gmail OAuth2 / app password (see docs: 500/day on a personal account)
 * The API never calls nodemailer directly, so a bulk send is always the same code path in dev and prod.
 */
/**
 * The one place that decides how mail goes out, so the API, the worker and its health endpoint agree.
 *
 * The rule is one sentence: **what you typed wins, and `providers.js` fills only what you left blank**. That is
 * what makes an address and a password a complete configuration for Gmail, Outlook, Zoho, Yahoo, iCloud,
 * Fastmail or QQ — and an obvious error message, rather than a silent preview, for anything else.
 */
export function resolveDriver(config = {}) {
  // One list per fact, and every name a deployment is likely to use is in it: an alias that nobody reads turns
  // a working inbox into a folder of .eml files, and that failure looks like a bug in the app.
  const name = pick(config, ['EMAIL_NAME', 'EMAIL_USER', 'GMAIL_USER', 'SMTP_USER']);
  const pass = pick(config, ['EMAIL_PASSWORD', 'EMAIL_PASS', 'GMAIL_APP_PASSWORD', 'SMTP_PASS', 'SMTP_PASSWORD']);
  const provider = providerFor(name);
  const rawHost = pick(config, ['SMTP_HOST']);
  // A host that is really a leftover placeholder must not out-rank a known address: that is how "I only gave it
  // the email and the password" ends in `getaddrinfo ENOTFOUND smtp.reply.example`.
  const ignoredHost = rawHost && provider && isPlaceholderHost(rawHost) ? rawHost : '';
  const typedHost = rawHost && rawHost !== ignoredHost ? rawHost : '';
  const host = typedHost || provider?.host || '';
  // A port and a TLS mode belong to the host they were typed with: when that host is a placeholder and goes
  // away, they go with it, or the panel ends up advertising "smtp.gmail.com:587 · implicit TLS" — a server
  // nobody asked for and no Gmail port answers on.
  // A port and a TLS mode belong to the host they were typed with. When no host was typed at all, the table owns
  // the whole triple — otherwise a deployment that still carries the old `SMTP_PORT=587` line in its .env gets
  // "smtp.gmail.com:587 · implicit TLS", which is a pair of numbers no server answers on.
  const fromEnv = ignoredHost || typedHost ? '' : '';
  const envPort = ignoredHost ? '' : pick(config, ['SMTP_PORT']);
  const envSecure = ignoredHost ? '' : pick(config, ['SMTP_SECURE']);
  const tableOwns = !typedHost && Boolean(provider);
  const port = Number((tableOwns ? provider.port : (envPort || fromEnv || provider?.port)) || 587) || 587;
  const secure = tableOwns ? !!provider.secure : envSecure === '' ? !!provider?.secure : isOn(envSecure);

  const want = String(config.MAIL_DRIVER || '').trim().toLowerCase();
  let driver = want === 'auto' ? '' : want;
  let note = null;
  if (!driver) {
    if (!name || !pass) { driver = 'preview'; note = 'no mail account is set yet — the address and its password are the only two things needed (Settings → Company → E-mail delivery, or EMAIL_NAME / EMAIL_PASSWORD in the environment)'; }
    else if (!host) { driver = 'preview'; note = `${providerNames()} are recognised from the address alone; ${domainOf(name) || 'that address'} is not one of them, so its SMTP host is needed too`; }
    else if (!typedHost && provider?.service) driver = provider.service;   // a Gmail box, sent Gmail's own way
    else driver = 'smtp';
  }
  const server = host ? { host, port, secure } : null;
  if (ignoredHost && server)
    note = `the SMTP host on record (${ignoredHost}) names no server, so it is ignored: ${name} is a ${provider.brand} address and this app dials ${describeServer(server)} for it. Clear that box in Settings → Company and the note goes away.`;
  if (!server && driver !== 'preview' && driver !== 'stream') {
    note = `MAIL_DRIVER=${driver} but no host is known — set SMTP_HOST, or use an address we recognise`;
    driver = 'preview';
  }
  const from = pick(config, ['MAIL_FROM']) || (name ? `PeoplePay360 Payroll <${name}>` : 'PeoplePay360 <no-reply@localhost>');
  // `pass` is deliberately not a property of the answer: this object is handed to the status endpoint, the
  // worker log and the bulk-send response, and a password that travels with them is a password in a log file.
  // createMailer still reads it, via a non-enumerable property that JSON.stringify and {...plan} both skip.
  const plan = { driver, note, name, host, from, server, ignoredHost: ignoredHost || null, provider: provider || null,
           inferred: !typedHost && provider ? provider.label : null,
           needsAppPassword: Boolean(provider?.appPassword), providerNote: provider?.note || null,
           // Length only — never the value. A 14-character "app password" is a paste that lost a group, and the
           // provider's answer for it is a bare 535, so the app does the counting instead.
           providerBrand: provider?.brand || null,
           passwordLength: pass ? String(pass).replace(/\s+/g, '').length : 0,
           dailyLimit: Number(config.MAIL_DAILY_LIMIT || config.dailyLimit || 200) };
  Object.defineProperty(plan, 'pass', { value: pass, enumerable: false });
  return plan;
}
const pick = (o, keys) => keys.map((k) => o[k]).find((v) => v !== undefined && v !== null && String(v).trim() !== '') || '';
const isOn = (v) => v === true || String(v).toLowerCase() === 'true' || v === '1';
const domainOf = (address) => String(address || '').split('@')[1] || '';

export function createMailer(config = {}) {
  const plan = resolveDriver(config);
  const { driver, note, name, pass, from, server, inferred, needsAppPassword, providerNote, dailyLimit } = plan;
  const transport = !server || driver === 'preview'
    ? null
    : driver === 'gmail'
    ? createTransport({ service: 'gmail', auth: config.GMAIL_OAUTH
        ? { type: 'oauth2', user: name, clientId: config.GMAIL_CLIENT_ID, clientSecret: config.GMAIL_CLIENT_SECRET, refreshToken: config.GMAIL_REFRESH_TOKEN }
        : { user: name, pass } })
    // Host, port and TLS as decided above — the plan is the only source, so the transport cannot disagree with
    // what the settings screen or /health says it will do.
    : createTransport({ host: server.host, port: server.port, secure: server.secure, auth: { user: name, pass }, pool: true, maxConnections: 3 });

  /** What Settings → System shows, so you can see which way mail goes without reading logs. */
  function status() {
    return { driver, from, login: name || null, dailyLimit, note,
             server, inferred, needsAppPassword, provider_note: providerNote,
             providerBrand: plan.providerBrand, passwordLength: plan.passwordLength };
  }

  async function send({ to, subject, text, html, attachments = [], from: fromOverride, cc, replyTo, previewDir }) {
    const mail = { from: fromOverride || from, to, subject, text, html: html || textToHtml(text), cc, replyTo, attachments };
    if (driver === 'preview') {
      const eml = toEml(mail);
      let file = null;
      if (previewDir) {
        file = join(previewDir, `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.eml`);
        await mkdir(dirname(file), { recursive: true });
        await writeFile(file, eml);
      }
      return { ok: true, driver, messageId: `<preview-${Date.now()}@localhost>`, accepted: [to], rejected: [], file, preview: eml.subarray(0, 400).toString() };
    }
    if (driver === 'stream') { process.stdout.write(`[mail] → ${to}: ${subject}\n`); return { ok: true, driver, messageId: `<stream-${Date.now()}@localhost>`, accepted: [to], rejected: [] }; }
    try {
      const info = await transport.sendMail(mail);
      return { ok: true, driver, messageId: info.messageId, accepted: [].concat(info.accepted || []), rejected: [].concat(info.rejected || []), response: info.response };
    } catch (e) {
      // The provider's own words are the useful part: "Username and Password not accepted" means a login
      // password was used instead of an App Password — and nothing else on the payslip screen would say so.
      const detail = [e.response, e.responseCode, e.code].filter(Boolean).join(' ');
      throw new Error(`${driver} rejected the message: ${e.message}${detail ? ` (${detail})` : ''}`);
    }
  }
  /** Verify credentials at boot instead of failing on payslip #1,432. */
  async function verify() {
    if (!transport) return { ok: true, driver, note };
    try { await transport.verify(); return { ok: true, driver, note }; } catch (e) { return { ok: false, driver, error: e.message, note }; }
  }
  return { driver, status, send, verify, render };
}
function textToHtml(text = '') {
  return `<div style="font:14px/1.55 -apple-system,Segoe UI,Roboto,sans-serif;color:#111418">${
    htmlEscape(text).replace(/\n/g, '<br/>')}</div>`;
}
/**
 * The file a preview send writes must read like the message that would have gone out, because on a box with no
 * SMTP login it IS the delivery: people open it in an editor, find the URL and paste it into an e-mail they
 * type themselves. So it is written as a real multipart/alternative \u2014 text part first, HTML after \u2014 and a
 * message that was built HTML-only gets a plain rendering, because tags around a link hide the thing that
 * matters. (It used to write the HTML with the tags still in it and no text part at all.)
 */
function toEml(mail) {
  const head = [`From: ${mail.from}`, `To: ${[].concat(mail.to || []).join(', ')}`];
  if (mail.cc) head.push(`Cc: ${[].concat(mail.cc).join(', ')}`);
  head.push(`Subject: ${mail.subject}`, 'MIME-Version: 1.0', 'X-Preview: 1');
  const html = String(mail.html || '').replace(/<br\/>/g, '<br>');
  const text = String(mail.text || '').trim() || htmlToText(html);
  const part = (type, body) => [`Content-Type: ${type}; charset="utf-8"`, 'Content-Transfer-Encoding: 8bit', '', body].join('\r\n');
  if (!html) return Buffer.from(`${head.join('\r\n')}${'\r\nContent-Type: text/plain; charset="utf-8"'
    + '\r\nContent-Transfer-Encoding: 8bit'}\r\n\r\n${text}\r\n`, 'utf8');
  const boundary = `----=_Part_${Date.now().toString(36)}`;
  head.push(`Content-Type: multipart/alternative; boundary="${boundary}"`);
  const inner = [`--${boundary}`, part('text/plain', text), `--${boundary}`, part('text/html', html), `--${boundary}--`];
  return Buffer.from(`${head.join('\r\n')}\r\n\r\n${inner.join('\r\n')}\r\n`, 'utf8');
}
/** Enough of a renderer for a preview file: block ends become newlines, anchors keep their href as text. */
function htmlToText(html) {
  return String(html)
    .replace(/<a [^>]*href="([^"]*)"[^>]*>.*?<\/a>/gs, (m, href) => ` ${href} `)
    .replace(/<\/p>|<br\s*\/?>/gi, '\n\n').replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ').replace(/[ \t]{2,}/g, ' ').replace(/\n{3,}/g, '\n\n')
    .replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ').trim();
}
export const chunk = (list, size) => { const out = []; for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size)); return out; };
