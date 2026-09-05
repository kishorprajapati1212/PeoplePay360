import { useCallback, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { payroll } from '../../api/endpoints.js';
import { useApi, useAction } from '../../hooks/useApi.js';
import { PageHeader } from '../../layout/PageHeader.jsx';
import { Panel } from '../../components/ui/Panel.jsx';
import { StatusChip } from '../../components/ui/StatusChip.jsx';
import { DataTable } from '../../components/data/DataTable.jsx';
import { ErrorPanel, EmptyState } from '../../components/ui/Feedback.jsx';
import { Modal } from '../../components/ui/Modal.jsx';
import { Checkbox } from '../../components/ui/controls.jsx';
import { useToast } from '../../components/ui/Toast.jsx';
import { useCan } from '../../rbac/Can.jsx';
import { download } from '../../utils/download.js';
import { inr, num, date, datetime, periodLabel } from '../../utils/format.js';

/**
 * The payrun workflow, exactly as the mockup describes it:
 *   DRAFT → COMPUTED → VALIDATED → (PDFs) → PAID → Emailed
 * Each button calls one endpoint; numbers are frozen after validate, and the payslips cannot be
 * emailed before the run is marked paid. Everything the run produced stays readable afterwards.
 */
export function PayrunDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const { run, busy } = useAction();
  const [send, setSend] = useState(null);

  const can = {
    compute: useCan('payroll:compute'),
    validate: useCan('payroll:validate'),
    paid: useCan('payroll:mark_paid'),
    pdf: useCan('payroll:pdf'),
    send: useCan('payroll:send_bulk'),
    del: useCan('payroll:payrun_delete'),
  };

  const load = useCallback(() => Promise.all([payroll.payruns.one(id), payroll.payruns.warnings(id).catch(() => []), payroll.payruns.tasks(id).catch(() => []), payroll.payruns.emails(id).catch(() => [])]), [id]);
  const { data, loading, error, reload } = useApi(load, [id]);
  const [run0, warnings, tasks, emails] = data || [{}, [], [], []];
  const status = run0.status;
  const slips = run0.payslips || [];

  const act = (key, fn, message) => run(key, fn).then(() => { toast.success(message); reload(); }).catch((e) => toast.error(e.message));

  return (
    <>
      <PageHeader
        title={run0.name || 'Payrun'}
        subtitle={`${periodLabel(run0.period_key)} · ${date(run0.period_start)} – ${date(run0.period_end)} · ${run0.salary_structure || 'no structure'}`}
        actions={<>
          <button className="btn-ghost btn-sm" onClick={() => run('csv', () => download(`/payruns/${id}/export.csv`, `salary-register-${run0.period_key}.csv`)).catch((e) => toast.error(e.message))}>Salary register CSV</button>
          <button className="btn-ghost btn-sm" onClick={() => run('zip', () => download(`/payruns/zip/${id}`, `payslips-${run0.period_key}.zip`)).catch((e) => toast.error(e.message))}>All PDFs (ZIP)</button>
          <Link className="btn-ghost btn-sm" to="/payruns">All payruns</Link>
        </>}
      />
      {loading && <Panel><p className="text-sm text-slate-400">Loading the run…</p></Panel>}
      {error && <ErrorPanel error={error} onRetry={reload} />}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <Stat label="Status" value={<StatusChip value={status} />} hint={stampFor(status, run0)} />
        <Stat label="Gross" value={inr(run0.total_gross)} hint={`${num(run0.payslip_count)} payslips`} />
        <Stat label="Deductions" value={inr(run0.total_deductions)} hint="statutory + recoveries" />
        <Stat label="Net payable" value={inr(run0.total_net)} tone="money" hint={`employer cost ${inr(run0.employer_cost)}`} />
        <Stat label="Ready to release" value={`${num(run0.emails_sent || 0)} sent`} hint={`${num(run0.emails_failed || 0)} failed · ${num(warnings?.length || run0.warning_count)} warnings`} />
      </div>

      <WorkflowBar status={status} can={can} busy={busy}
                   onCompute={() => act('compute', () => payroll.payruns.compute(id, {}), 'Computed every payslip in this run')}
                   onValidate={() => act('validate', () => payroll.payruns.validate(id, {}), 'Validated — the numbers are locked')}
                   onPdfs={() => act('pdf', () => payroll.payruns.generatePdfs(id, { reason: 'payrun' }), 'PDF generation queued to the worker')}
                   onPaid={() => act('paid', () => payroll.payruns.markPaid(id, {}), 'Marked paid')}
                   onSend={() => setSend({ force: false, ccHr: false })}
                   onVoid={() => act('void', () => payroll.payruns.void(id, {}), 'Payrun voided')} />

      <div className="mt-4 grid gap-4 xl:grid-cols-3">
        <Panel className="xl:col-span-2" title="Payslips in this run" subtitle="click a row for the slip with its rule-by-rule working" pad={false}>
          <DataTable rows={slips} columns={[
            { key: 'employee', label: 'Employee', render: (r) => (<div><p className="text-slate-100">{r.employee || r.employee_name}</p><p className="text-xs text-slate-500">{r.employee_code}</p></div>) },
            { key: 'gross_amount', label: 'Gross', align: 'right', render: (r) => inr(r.gross_amount) },
            { key: 'total_deductions', label: 'Deductions', align: 'right', render: (r) => inr(r.total_deductions) },
            { key: 'net_amount', label: 'Net', align: 'right', render: (r) => <span className="font-medium text-slate-100">{inr(r.net_amount)}</span> },
            { key: 'worked_days', label: 'Days', align: 'right', render: (r) => `${num(r.worked_days ?? '—')} / ${num(r.expected_working_days ?? '—')}` },
            { key: 'status', label: 'Status', render: (r) => <StatusChip value={r.status} /> },
            { key: 'pdf_hash', label: 'PDF', render: (r) => (r.pdf_hash ? <span className="chip border-emerald-500/30 bg-emerald-500/10 text-emerald-300">v{r.document_version || 1}</span> : <span className="text-xs text-slate-500">not rendered</span>) },
            { key: 'email_status', label: 'Email', render: (r) => (r.email_status ? <StatusChip value={r.email_status} /> : <span className="text-xs text-slate-600">—</span>) },
            { key: '_a', label: '', render: (r) => <button className="btn-ghost btn-sm" onClick={() => navigate('/payslips/' + (r.payslip_id || r.id))}>Open</button> },
          ]} empty={<EmptyState title="No payslips yet" hint="Compute the run to generate one slip per selected employee." />} />
        </Panel>

        <div className="space-y-4">
          <Panel title="Warnings" subtitle="nothing here blocks you, but read them before locking">
            {(warnings || []).length ? (
              <ul className="space-y-2 text-sm">
                {warnings.map((w, i) => (
                  <li key={i} className="flex gap-2 rounded-lg bg-amber-500/5 px-2.5 py-2 text-amber-100/90 ring-1 ring-amber-500/20">
                    <span>▲</span><span className="min-w-0"><span className="block">{w.message || w.warning || w.label}</span>
                    {w.employee && <span className="block text-xs text-amber-200/60">{w.employee}</span>}</span>
                  </li>
                ))}
              </ul>
            ) : <p className="text-sm text-slate-500">No warnings. {status === 'DRAFT' ? 'Compute to see the per-person checks.' : ''}</p>}
          </Panel>

          <Panel title="Queue" subtitle="PDF and email jobs this run pushed to Redis" pad={false}>
            <ul className="divide-y divide-line/70 text-sm">
              {(tasks || []).slice(0, 8).map((t) => (
                <li key={t.id} className="flex items-center gap-2 px-4 py-2">
                  <span className="text-xs text-slate-400">{t.task_type === 'GENERATE_PDF' ? 'PDF' : 'Email'}</span>
                  <StatusChip value={t.status} />
                  <span className="ml-auto text-xs text-slate-500">{t.attempts > 0 ? `${t.attempts} attempt${t.attempts > 1 ? 's' : ''} · ` : ''}{datetime(t.updated_at || t.created_at)}</span>
                </li>
              ))}
              {!(tasks || []).length && <li className="px-4 py-3 text-sm text-slate-500">Nothing queued yet.</li>}
            </ul>
          </Panel>

          {(emails || []).length > 0 && (
            <Panel title="Delivery log" pad={false}>
              <ul className="divide-y divide-line/70 text-sm">
                {(emails || []).slice(0, 10).map((e) => (
                  <li key={e.id} className="flex items-center gap-2 px-4 py-2">
                    <span className="min-w-0 flex-1 truncate text-slate-300">{e.recipient}</span>
                    <StatusChip value={e.status} />
                  </li>
                ))}
              </ul>
            </Panel>
          )}
        </div>
      </div>

      <Modal open={!!send} onClose={() => setSend(null)} width="max-w-md" title="Email payslips to employees"
             subtitle="Queued to the worker, one job per person, with the PDF attached."
             footer={<><button className="btn-ghost" onClick={() => setSend(null)}>Cancel</button>
                      <button className="btn-primary" disabled={!!busy} onClick={() => {
                        act('send', () => payroll.payruns.send(id, { force: send.force, cc_hr: send.ccHr }), 'Send queued');
                        setSend(null);
                      }}>{busy === 'send' ? 'Queueing…' : 'Queue the send'}</button></>}>
        <div className="flex flex-col gap-3">
          <Checkbox checked={send?.force} onChange={(v) => setSend({ ...send, force: v })} label="Send again even if already delivered"
                    hint="Used after a correction: it bumps the document version and re-sends." />
          <Checkbox checked={send?.ccHr} onChange={(v) => setSend({ ...send, ccHr: v })} label="Copy the HR mailbox" />
          {!send?.force && <p className="text-xs text-slate-500">People who already received this version are skipped automatically.</p>}
        </div>
      </Modal>
    </>
  );
}

function Stat({ label, value, hint, tone }) {
  return (
    <div className="panel panel-pad">
      <p className="label">{label}</p>
      <p className={'mt-1.5 text-lg font-semibold ' + (tone === 'money' ? 'text-emerald-300' : 'text-slate-50')}>{value}</p>
      {hint && <p className="mt-0.5 text-xs text-slate-500">{hint}</p>}
    </div>
  );
}

function stampFor(status, run) {
  if (status === 'PAID') return 'paid ' + datetime(run.paid_at);
  if (status === 'VALIDATED') return 'locked ' + datetime(run.validated_at);
  if (status === 'COMPUTED') return 'computed ' + datetime(run.computed_at);
  return 'created ' + datetime(run.created_at);
}

function WorkflowBar({ status, can, busy, onCompute, onValidate, onPdfs, onPaid, onSend, onVoid }) {
  const steps = [
    { key: 'compute', label: 'Compute payslips', show: ['DRAFT', 'COMPUTED'].includes(status) && can.compute, run: onCompute, note: 'runs every rule, pro-rata on days worked' },
    { key: 'validate', label: 'Validate & lock', show: status === 'COMPUTED' && can.validate, run: onValidate, note: 'numbers stop moving after this' },
    { key: 'pdf', label: 'Generate PDFs', show: ['VALIDATED', 'PAID'].includes(status) && can.pdf, run: onPdfs, note: 'queued to the worker, not in the browser' },
    { key: 'paid', label: 'Mark paid', show: status === 'VALIDATED' && can.paid, run: onPaid, note: 'releases the run for employees' },
    { key: 'send', label: 'Email payslips', show: status === 'PAID' && can.send, run: onSend, note: 'bulk send with attachment' },
  ];
  return (
    <div className="mt-4 flex flex-wrap items-center gap-2">
      {steps.map((s) => s.show && (
        <button key={s.key} className="btn-primary btn-sm" onClick={s.run} disabled={!!busy} title={s.note}>
          {busy === s.key ? 'Working…' : s.label}
        </button>
      ))}
      {status === 'DRAFT' && can.del && <button className="btn-danger btn-sm" onClick={onVoid} disabled={!!busy}>Void this draft</button>}
      {status === 'DRAFT' && !can.compute && <p className="text-xs text-slate-500">Your role can create runs but not compute them — that is deliberate: payroll_user does the maths.</p>}
    </div>
  );
}
