import { join } from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { Worker } from 'bullmq';
import { renderPayslipPdf } from '../../lib/pdf/index.js';
import { config } from '../config.js';
import { logger } from '../logger.js';
import { queueConnection } from '../redis.js';
import { one, query, markTask, failTask } from '../db.js';
import { payslipPackage, pdfInput } from './payslip-data.js';

/**
 * GENERATE_PDF — render one payslip, store it under storage/pdfs/<period>/, and ledger it.
 *
 * The file is written first, then payslip_documents, then the task row. If any step dies mid-way the
 * next attempt simply re-renders (the document insert is an upsert on (payslip_id, kind, version)),
 * so a crash never leaves a half-recorded PDF.
 */
export function createPdfWorker({ concurrency = config.worker.concurrency } = {}) {
  return new Worker(config.queues.pdf, async (job) => {
    const { taskId, payslipId, version } = job.data ?? {};
    const log = logger.child({ job: job.name, id: job.id, taskId });
    if (taskId) await markTask(taskId, 'PROCESSING', { jobId: String(job.id) });
    if (!payslipId) throw new Error('payslipId is required');

    const pkg = await payslipPackage(payslipId);
    if (!pkg) throw new Error(`Payslip ${payslipId} no longer exists`);
    const { slip } = pkg;
    const rendered = await renderPayslipPdf(pdfInput(pkg));
    const dir = join(config.pdf.dir, slip.period_key || 'unknown');
    await mkdir(dir, { recursive: true });
    const key = `payslip-${slip.employee_code || slip.id}-${slip.period_key}-v${version ?? slip.document_version}.pdf`;
    const path = join(dir, key);
    await writeFile(path, rendered.buffer);

    await query(`insert into payslip_documents (payslip_id, kind, version, storage_path, bytes, sha256, renderer)
                 values ($1,'PAYSLIP'::document_kind,$2,$3,$4,$5,$6)
                 on conflict (payslip_id, kind, version) do update
                   set storage_path = excluded.storage_path, bytes = excluded.bytes, sha256 = excluded.sha256,
                       renderer = excluded.renderer, generated_at = now()`,
      [payslipId, version ?? slip.document_version, path, rendered.bytes, rendered.sha256, config.pdf.renderer]);
    await query(`update payslips set pdf_hash = $2, pdf_path = $3, pdf_generated_at = now() where id = $1`, [payslipId, rendered.sha256, path]);
    // a freshly rendered slip invalidates "already sent" only when the version moved on
    await query(`update email_deliveries set status = 'SKIPPED'::delivery_status, error = 'Superseded by a re-render'
                  where payslip_id = $1 and status = 'QUEUED'::delivery_status and document_version < $2`,
      [payslipId, version ?? slip.document_version]);

    log.debug({ bytes: rendered.bytes, path }, 'payslip pdf written');
    if (taskId) await markTask(taskId, 'COMPLETED', { jobId: String(job.id) });
    return { payslipId, path, bytes: rendered.bytes, sha256: rendered.sha256, version: version ?? slip.document_version };
  }, { connection: queueConnection, concurrency, lockDuration: 60_000, stalledInterval: 30_000, maxStalledCount: 2 });
}

/** Called by the queue's failed hook so a DEAD job is reflected in Postgres, not only in Redis. */
export async function onPdfFailed(job, error) {
  const taskId = job?.data?.taskId;
  if (!taskId) return;
  const res = await failTask(taskId, error?.message ?? 'render failed', job ? String(job.id) : undefined);
  logger.error({ taskId, attempts: res?.attempts, retryable: res?.retryable, err: error?.message }, 'pdf job failed');
  const payslipId = job?.data?.payslipId;
  if (!res?.retryable && payslipId) await one(`update payslips set notes = coalesce(notes, '') || $2 where id = $1`,
    [payslipId, `\nPDF generation failed permanently: ${String(error?.message ?? '').slice(0, 200)}`]);
}
export const pdfJobName = 'payslip-pdf';
