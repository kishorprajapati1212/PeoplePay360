import { createTransport } from 'nodemailer';
import { writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { render, htmlEscape } from './template.js';
export * from './template.js';

/**
 * Drivers:
 *   preview  – writes .eml files to storage/mail and returns ok (the default: zero config, nothing leaves the box)
 *   stream   – logs to stdout only (used by tests)
 *   smtp     – SMTP_* env
 *   gmail    – nodemailer gmail OAuth2 / app password (see docs: 500/day on a personal account)
 * The API never calls nodemailer directly, so a bulk send is always the same code path in dev and prod.
 */
/** The one place that decides how mail goes out, so the worker, its health endpoint and this module agree. */
export function resolveDriver(config = {}) {
  const name = pick(config, ['EMAIL_NAME', 'GMAIL_USER', 'SMTP_USER']);
  const pass = pick(config, ['EMAIL_PASSWORD', 'GMAIL_APP_PASSWORD', 'SMTP_PASS']);
  const host = pick(config, ['SMTP_HOST']);
  const want = String(config.MAIL_DRIVER || '').trim().toLowerCase();
  let driver = want;
  let note = null;
  if (!driver || driver === 'auto') {
    if (!name || !pass) { driver = 'preview'; note = 'no EMAIL_NAME / EMAIL_PASSWORD set — writing .eml files to storage/mail instead'; }
    else if (/gmail\.com$/i.test(name) || /gmail/i.test(host)) driver = 'gmail';
    else if (host) driver = 'smtp';
    else { driver = 'preview'; note = 'EMAIL_NAME/EMAIL_PASSWORD are set but SMTP_HOST is empty — add it, or set MAIL_DRIVER=gmail for a Google inbox'; }
  }
  const from = pick(config, ['MAIL_FROM']) || (name ? `PeoplePay360 Payroll <${name}>` : 'PeoplePay360 <no-reply@localhost>');
  return { driver, note, name, pass, host, from, dailyLimit: Number(config.MAIL_DAILY_LIMIT || config.dailyLimit || 200) };
}
const pick = (o, keys) => keys.map((k) => o[k]).find((v) => v !== undefined && v !== null && String(v).trim() !== '') || '';

export function createMailer(config = {}) {
  const plan = resolveDriver(config);
  let driver = plan.driver;
  const { name, pass, host, from } = plan;
  let note = plan.note;
  const dailyLimit = plan.dailyLimit;
  const transport = driver === 'smtp'
    ? createTransport({ host, port: Number(config.SMTP_PORT || 587), secure: String(config.SMTP_SECURE) === 'true',
                        auth: { user: name, pass }, pool: true, maxConnections: 3 })
    : driver === 'gmail'
    ? createTransport({ service: 'gmail', auth: config.GMAIL_OAUTH
        ? { type: 'oauth2', user: name, clientId: config.GMAIL_CLIENT_ID, clientSecret: config.GMAIL_CLIENT_SECRET, refreshToken: config.GMAIL_REFRESH_TOKEN }
        : { user: name, pass } })
    : null;

  /** What Settings → System shows, so you can see which way mail goes without reading logs. */
  function status() { return { driver, from, login: name || null, dailyLimit, note }; }

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
function toEml(mail) {
  const head = [`From: ${mail.from}`, `To: ${[].concat(mail.to || []).join(', ')}`];
  if (mail.cc) head.push(`Cc: ${[].concat(mail.cc).join(', ')}`);
  head.push(`Subject: ${mail.subject}`, 'MIME-Version: 1.0', 'Content-Type: text/html; charset="utf-8"', 'X-Preview: 1');
  const body = String(mail.html || '').replace(/<br\/>/g, '\n');
  return Buffer.from(`${head.join('\r\n')}\r\n\r\n${body}\r\n`, 'utf8');
}
export const chunk = (list, size) => { const out = []; for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size)); return out; };
