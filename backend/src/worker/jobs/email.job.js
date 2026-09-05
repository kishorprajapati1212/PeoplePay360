import { readFile, stat } from 'node:fs/promises';
import { Worker } from 'bullmq';
import { createMailer, payslipEmailVars, render } from '../../lib/mailer/index.js';
import { config } from '../config.js';
import { logger } from '../logger.js';
import { queueConnection } from '../redis.js';
import { one, query, markTask, failTask } from '../db.js';
import { payslipPackage } from './payslip-data.js';

const mailer = createMailer({ ...config.mail, MAIL_DRIVER: config.mail.MAIL_DRIVER });
const DAY = 86_400_000;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** ₹ with Indian digit grouping — the email is read on a phone, so "20070.55" is not good enough. */
const inr = (v) => `₹${(Number(v) || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
/** "1 Oct 2026 – 15 Oct 2026" beats the period key; parsed from the ISO text so no timezone shift can move a day. */
function periodLabel(slip) {
  const day = (iso) => { const [y, m, d] = String(iso ?? '').slice(0, 10).split('-'); return m ? `${Number(d)} ${MONTHS[Number(m) - 1]} ${y}` : null; };
  const a = day(slip.period_start); const b = day(slip.period_end);
  return a && b ? `${a} – ${b}` : (slip.period_key ?? '');
}
const sentToday = { day: new Date().toISOString().slice(0, 10), n: 0 };

/**
 * SEND_EMAIL — one payslip to one inbox, with the stored PDF attached.
 *
 * With MAIL_DRIVER=preview (the default) nothing leaves the machine: an .eml file lands in storage/mail
 * so the demo is verifiable offline. The delivery row is the ledger: QUEUED → SENT / BOUNCED / FAILED,
 * and the payslip carries email_status so the pay-run screen can show it without a join.
 */
export function createEmailWorker({ concurrency = config.worker.concurrency } = {}) {
  return new Worker(config.queues.email, async (job) => {
    const { taskId, payslipId, version } = job.data ?? {};
    if (taskId) await markTask(taskId, 'PROCESSING', { jobId: String(job.id) });
    const task = taskId ? await one(`select payload from task_queue where id = $1::uuid`, [taskId]) : null;
    const payload = task?.payload ?? {};

    const pkg = await payslipPackage(payslipId);
    if (!pkg) throw new Error(`Payslip ${payslipId} no longer exists`);
    const to = payload.to || pkg.slip.work_email;
    if (!to) throw new Error('No work email on file for this employee');

    const pdfPath = payload.pdfPath || pkg.slip.pdf_path;
    const attachments = [];
    if (pdfPath) {
      try {
        const buf = await readFile(pdfPath);
        attachments.push({ filename: pdfPath.split('/').pop(), content: buf, contentType: 'application/pdf' });
      } catch (e) {
        logger.warn({ pdfPath, err: e.message }, 'stored pdf missing — the slip is sent without an attachment');
      }
    }
    const company = pkg.company ?? {};
    const dailyLimit = Number(company.mail_daily_limit || config.mail.MAIL_DAILY_LIMIT || 200);
    if (sentToday.day !== new Date().toISOString().slice(0, 10)) { sentToday.day = new Date().toISOString().slice(0, 10); sentToday.n = 0; }
    if (sentToday.n >= dailyLimit) throw new Error(`Daily mail cap (${dailyLimit}) reached — the send will be retried tomorrow`);

    const vars = { ...payslipEmailVars({ company, employee: pkg.employee, payslip: pkg.slip, net: inr(pkg.slip.net_amount),
      periodLabel: periodLabel(pkg.slip), link: `${config.mail.publicBaseUrl}/payslips/${payslipId}` }),
      gross: inr(pkg.slip.gross_amount) };
    const subject = payload.subject || `Payslip ${periodLabel(pkg.slip)} — ${company.company_name || 'PeoplePay360'}`;
    const text = render('Hi {{first_name}},\n\nYour payslip for {{period}} is ready. Net pay: {{net}}.\nOpen it here: {{link}}\n\n{{company}}', vars);
    const html = render('<p>Hi <b>{{first_name}}</b>,</p><p>Your payslip for <b>{{period}}</b> is ready. Net pay: <b>{{net}}</b>.</p>'
      + '<p><a href="{{link}}">Open the payslip in the portal</a> — the PDF is attached.</p><p style="color:#667">{{company}}</p>', vars);

    const out = await mailer.send({ to, subject, text, html, from: payload.from || company.mail_from || config.mail.MAIL_FROM,
      cc: payload.ccHr ? company.mail_from : undefined, attachments, previewDir: config.mail.dir });
    if (!out?.ok) throw new Error(out?.error || 'mail driver refused the message');
    sentToday.n += 1;

    await query(`update email_deliveries set status = 'SENT'::delivery_status, message_id = coalesce($3, message_id),
                        sent_at = now(), attempts = attempts + 1, preview_url = coalesce($4, preview_url), error = null
                 where payslip_id = $1::uuid and ($2::int is null or document_version = $2)`,
      [payslipId, version ?? null, out.messageId ?? null, out.file ?? null]);
    await query(`update payslips set email_status = 'SENT', released_at = coalesce(released_at, now()) where id = $1::uuid`, [payslipId]);
    await query(`update payruns set sent_at = coalesce(sent_at, now())
                 where id = (select payrun_id from payslips where id = $1::uuid)`, [payslipId]);
    if (taskId) await markTask(taskId, 'COMPLETED', { jobId: String(job.id) });
    logger.info({ to, payslipId, driver: out.driver, attachments: attachments.length }, 'payslip emailed');
    return { payslipId, to, driver: out.driver, messageId: out.messageId ?? null };
  }, { connection: queueConnection, concurrency, lockDuration: 60_000, limiter: { max: Math.max(1, Number(config.mail.MAIL_DAILY_LIMIT) || 200), duration: DAY / 24 },
       stalledInterval: 30_000, maxStalledCount: 2 });
}

export async function onEmailFailed(job, error) {
  const taskId = job?.data?.taskId;
  if (!taskId) return;
  const res = await failTask(taskId, error?.message ?? 'send failed', job ? String(job.id) : undefined);
  const payslipId = job?.data?.payslipId;
  await query(`update email_deliveries set status = $3::delivery_status, error = $4, attempts = attempts + 1
               where payslip_id = $1::uuid and ($2::int is null or document_version = $2)`,
    [payslipId, job?.data?.version ?? null, res?.retryable ? 'QUEUED' : 'FAILED', String(error?.message ?? '').slice(0, 300)]);
  await query(`update payslips set email_status = $2 where id = $1::uuid`, [payslipId, res?.retryable ? 'PENDING' : 'FAILED']);
  logger.error({ taskId, retryable: res?.retryable, err: error?.message }, 'email job failed');
}
export const emailJobName = 'payslip-email';
export const mailCapabilities = async () => {
  const v = await mailer.verify();
  return { ...v, pdf_renderer: config.pdf.renderer, preview_dir: config.mail.dir };
};
export const storageFootprint = async () => {
  try { const s = await stat(config.pdf.dir); return { bytes: s.size, dir: config.pdf.dir }; } catch { return { bytes: 0, dir: config.pdf.dir }; }
};
