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
export function createMailer(config = {}) {
  const driver = config.MAIL_DRIVER || 'preview';
  const transport = driver === 'smtp'
    ? createTransport({ host: config.SMTP_HOST, port: Number(config.SMTP_PORT || 587), secure: String(config.SMTP_SECURE) === 'true',
                        auth: config.SMTP_USER ? { user: config.SMTP_USER, pass: config.SMTP_PASS } : undefined, pool: true, maxConnections: 3 })
    : driver === 'gmail'
    ? createTransport({ service: 'gmail', auth: config.GMAIL_OAUTH ? { type: 'oauth2', user: config.GMAIL_USER, clientId: config.GMAIL_CLIENT_ID, clientSecret: config.GMAIL_CLIENT_SECRET, refreshToken: config.GMAIL_REFRESH_TOKEN } : { user: config.GMAIL_USER, pass: config.GMAIL_APP_PASSWORD } })
    : null;

  async function send({ to, subject, text, html, attachments = [], from, cc, replyTo, previewDir }) {
    const mail = { from: from || config.MAIL_FROM || 'PeoplePay360 <no-reply@localhost>', to, subject, text, html: html || textToHtml(text), cc, replyTo, attachments };
    if (driver === 'preview' || (driver === 'smtp' && !config.SMTP_HOST)) {
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
    const info = await transport.sendMail(mail);
    return { ok: true, driver, messageId: info.messageId, accepted: [].concat(info.accepted || []), rejected: [].concat(info.rejected || []), response: info.response };
  }
  /** Verify credentials at boot instead of failing on payslip #1,432. */
  async function verify() {
    if (!transport) return { ok: true, driver };
    try { await transport.verify(); return { ok: true, driver }; } catch (e) { return { ok: false, driver, error: e.message }; }
  }
  return { driver, send, verify, render };
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
