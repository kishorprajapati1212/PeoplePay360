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
import { toRows } from '../../utils/query.js';

/**
 * The payrun workflow, exactly as the mockup describes it:
 *   DRAFT → COMPUTED → VALIDATED → (PDFs) → PAID → Emailed
 * Each button calls one endpoint; numbers are frozen after validate, and payslips cannot be emailed
 * before the run is marked paid.
 *
 * Two things this screen is careful about, because it used to be wrong in both:
 *  - the table below reads the run's OWN employee rows (GET /payruns/:id returns `employees`, per-person
 *    compute state, not a `payslips` array), so "computed" is never shown as an empty list; and
 *  - the result of Compute/Validate/Send is read from the response and put on screen — a green toast that
 *    says "done" when 12 of 12 employees were skipped is worse than no message at all.
 */
export function PayrunDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const { run, busy } = useAction();
  const [send, setSend] = useState(null);
  const [outcome, setOutcome] = useState(null);   // the last Compute/Validate/Send result, kept on screen
  const [showOnlyProblems, setShowOnlyProblems] = useState(false);

  const can = {
    compute: useCan('payroll:compute'),
    validate: useCan('payroll:validate'),
    paid: useCan('payroll:mark_paid'),
    pdf: useCan('payroll:pdf'),
    send: useCan('payroll:send_bulk'),
    del: useCan('payroll:payrun_delete'),
  };

  const load = useCallback(() => Promise.all([
    payroll.payruns.one(id),
    payroll.payruns.warnings(id).catch(() => []),
    payroll.payruns.tasks(id).catch(() => []),
    payroll.payruns.emails(id).catch(() => []),
  ]), [id]);
  const { data, loading, error, reload } = useApi(load, [id]);
  const [run0 = {}, w = [], t = [], e = []] = data || [];
  const status = run0.status;
  const actions = run0.actions || {};
  const warnings = toRows(w); const tasks = toRows(t); const emails = toRows(e);
  // payrun.service.read() answers with `employees` — one row per person, including the ones that failed.
  const people = toRows(run0.employees && run0.employees.length ? run0.employees : run0.payslips);
  const problems = people.filter((r) => r.compute_status === 'ERROR' || !r.contract_id || r.payslip_status === 'ERROR');
  const shown = showOnlyProblems ? problems : people;

  const act = (key, fn, message) => run(key, fn).then((out) => { toast.success(typeof message === 'function' ? message(out) : message); reload(); return out; })
    .catch((e) => { toast.error(e.message); throw e; });

  async function compute() {
    try {
      const out = await run('compute', () => payroll.payruns.compute(id, {}));
      setOutcome({ kind: 'compute', ...describeCompute(out, people.length) });
      reload();
    } catch (err) { toast.error(err.message); }
  }
  async function validate() {
    try {
      const out = await run('validate', () => payroll.payruns.validate(id, {}));
      setOutcome({ kind: 'validate', text: `Locked for release — ${num(out?.payslip_count ?? run0.payslip_count)} payslips frozen.`, tone: 'good' });
      reload();
    } catch (err) {
      // The lock refuses while a person still has an ERROR row; say who, instead of only "422".
      setOutcome({ kind: 'validate', text: err.message, tone: 'bad', code: err.code });
      toast.error(err.message);
    }
  }
  async function doSend() {
    try {
      const out = await run('send', () => payroll.payruns.send(id, { force: send.force, cc_hr: send.ccHr }));
      setSend(null);
      setOutcome({ kind: 'send', ...describeSend(out) });
      reload();
    } catch (err) { toast.error(err.message); }
  }

  return (
    <>
      <PageHeader
        title={run0.name || 'Payrun'}
        subtitle={`${periodLabel(run0.period_key)} · ${date(run0.period_start)} – ${date(run0.period_end)} · ${run0.salary_structure || 'no structure'} · ${run0.compute_mode === 'ADVANCE_50' ? 'advance 50% + true-up' : 'pro-rata on days worked'}`}
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
        <Stat label="Checks" value={num(warnings.length) + (warnings.length === 1 ? ' flag' : ' flags')}
              hint={`${num(run0.error_count)} payslips blocked · ${num(run0.warning_count)} payslips with a flag · ${num(people.length)} people in the run`} />
      </div>

      <WorkflowBar status={status} can={can} busy={busy} actions={actions} run0={run0}
                   onCompute={compute}
                   onValidate={validate}
                   onPdfs={() => act('pdf', () => payroll.payruns.generatePdfs(id, { reason: 'payrun' }),
                     (out) => out?.queued ? `PDF generation queued for ${num(out.queued)} payslips` : 'Nothing to queue — the worker will pick up any slip already requested.')}
                   onPaid={() => act('paid', () => payroll.payruns.markPaid(id, {}), 'Marked paid — employees can now download the slip')}
                   onSend={() => setSend({ force: false, ccHr: false })}
                   onVoid={() => act('void', () => payroll.payruns.void(id, {}), 'Payrun voided')} />

      {outcome && (
        <div className={'mt-3 rounded-lg border px-3 py-2 text-sm ' + (outcome.tone === 'bad' ? 'border-red-500/40 bg-red-950/30 text-red-100'
                       : outcome.tone === 'warn' ? 'border-amber-500/40 bg-amber-500/10 text-amber-100' : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-100')}>
          <span className="mr-2 uppercase text-[10px] tracking-wide opacity-70">{outcome.kind}</span>{outcome.text}
          {outcome.failed?.length ? (
            <ul className="mt-1.5 space-y-1 text-xs opacity-90">
              {outcome.failed.slice(0, 6).map((f, i) => (
                <li key={i}>· {f.employee} — {f.error}{f.code ? ` (${f.code})` : ''}</li>
              ))}
              {outcome.failed.length > 6 && <li>· and {outcome.failed.length - 6} more</li>}
            </ul>
          ) : null}
          {outcome.hint && <p className="mt-1 text-xs opacity-80">{outcome.hint}</p>}
        </div>
      )}

      <div className="mt-4 grid gap-4 xl:grid-cols-3">
        <Panel className="xl:col-span-2" pad={false}
               title="Payslips in this run"
               subtitle={people.length ? `${num(people.length)} people · ${num(problems.length)} needing attention` : undefined}
               actions={problems.length ? (
                 <button className="btn-ghost btn-sm" onClick={() => setShowOnlyProblems((v) => !v)}>{showOnlyProblems ? `Show all ${people.length}` : `Only the ${problems.length} with problems`}</button>
               ) : null}>
          <DataTable rows={shown} columns={[
            { key: 'employee', label: 'Employee', render: (r) => (<div><p className="text-slate-100">{r.employee || r.employee_name}</p><p className="text-xs text-slate-500">{r.employee_code}{r.department ? ` · ${r.department}` : ''}</p></div>) },
            { key: 'compute_status', label: 'Compute', render: (r) => (r.compute_status === 'ERROR'
                ? <span className="chip border-red-500/30 bg-red-500/10 text-red-300" title={r.error_message || ''}>error{r.error_code ? ` · ${r.error_code}` : ''}</span>
                : r.payslip_id ? <span className="chip border-emerald-500/30 bg-emerald-500/10 text-emerald-300">computed</span>
                : <span className="text-xs text-slate-500" title={r.error_message || 'Not computed yet'}>not computed</span>) },
            { key: 'gross_amount', label: 'Gross', align: 'right', render: (r) => (r.gross_amount === null || r.gross_amount === undefined ? <span className="text-slate-600">—</span> : inr(r.gross_amount)) },
            { key: 'total_deductions', label: 'Deductions', align: 'right', render: (r) => (r.total_deductions == null ? <span className="text-slate-600">—</span> : inr(r.total_deductions)) },
            { key: 'net_amount', label: 'Net', align: 'right', render: (r) => (r.net_amount == null ? <span className="text-slate-600">—</span> : <span className="font-medium text-slate-100">{inr(r.net_amount)}</span>) },
            { key: 'worked_days', label: 'Days', align: 'right', render: (r) => `${num(r.paid_days ?? r.worked_days ?? '—')} / ${num(r.expected_working_days ?? '—')}` },
            { key: 'payslip_status', label: 'Slip', render: (r) => (r.payslip_status ? <StatusChip value={r.payslip_status} /> : <span className="text-xs text-slate-600">—</span>) },
            { key: 'email_status', label: 'Email', render: (r) => (r.email_status ? <StatusChip value={r.email_status} /> : <span className="text-xs text-slate-600">—</span>) },
            { key: '_a', label: '', render: (r) => (r.payslip_id
                ? <button className="btn-ghost btn-sm" onClick={() => navigate('/payslips/' + r.payslip_id)}>Open</button>
                : <span className="text-xs text-slate-600" title="Compute produces the slip row">no slip</span>) },
          ]} empty={people.length
            ? <EmptyState title="Nothing matches the filter" hint="Turn the problem filter off to see every person in the run." />
            : <EmptyState title="No payslips yet"
                          hint={status === 'DRAFT'
                            ? 'Press “Compute payslips” above. One slip per person appears with its net, and anything that cannot be computed is listed here with the reason.'
                            : 'This run has no people in it. Add them from Payruns → + New payrun → step 2, or check that their contract covers these dates.'} />} />
        </Panel>

        <div className="space-y-4">
          <Panel title="Checks" subtitle="nothing here blocks you except the rows marked ERROR — but read them before locking">
            {warnings.length ? (
              <ul className="space-y-2 text-sm">
                {warnings.map((x, i) => (
                  <li key={i} className={'flex gap-2 rounded-lg px-2.5 py-2 ring-1 ' + (x.severity === 'ERROR' ? 'bg-red-500/10 text-red-100 ring-red-500/25' : 'bg-amber-500/5 text-amber-100/90 ring-amber-500/20')}>
                    <span>{x.severity === 'ERROR' ? '⛔' : '▲'}</span>
                    <span className="min-w-0">
                      <span className="block">{x.message || x.warning || x.label}</span>
                      <span className="block text-xs opacity-70">
                        {x.employee || 'the run'}{x.rule_code ? ` · rule ${x.rule_code}` : ''}{x.severity ? ` · ${x.severity.toLowerCase()}` : ''}
                        {x.payslip_id ? <> · <button className="link" onClick={() => navigate('/payslips/' + x.payslip_id)}>open slip</button></> : null}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-slate-500">
                {status === 'DRAFT' ? 'Nothing to check yet — compute the run to see the per-person checks.'
                 : Number(run0.warning_count) > 0 ? `The run still counts ${num(run0.warning_count)} flag(s) on its payslips. Recompute to refresh this list, or open a slip to read its computation log.`
                 : 'No warnings — every rule found the data it needed.'}
              </p>
            )}
          </Panel>

          <Panel title="Queue" subtitle="PDF and email jobs this run pushed to Redis" pad={false}>
            <ul className="divide-y divide-line/70 text-sm">
              {tasks.slice(0, 8).map((x) => (
                <li key={x.id} className="flex items-center gap-2 px-4 py-2">
                  <span className="text-xs text-slate-400">{x.task_type === 'GENERATE_PDF' ? 'PDF' : x.task_type === 'SEND_EMAIL' ? 'Email' : x.task_type}</span>
                  <StatusChip value={x.status} />
                  <span className="ml-auto text-xs text-slate-500">{x.attempts > 0 ? `${x.attempts} attempt${x.attempts > 1 ? 's' : ''} · ` : ''}{datetime(x.updated_at || x.created_at)}</span>
                </li>
              ))}
              {!tasks.length && <li className="px-4 py-3 text-sm text-slate-500">Nothing queued yet — PDFs and e-mails appear here after you ask for them.</li>}
            </ul>
          </Panel>

          {emails.length > 0 && (
            <Panel title="Delivery log" pad={false}>
              <ul className="divide-y divide-line/70 text-sm">
                {emails.slice(0, 10).map((x) => (
                  <li key={x.id} className="flex items-center gap-2 px-4 py-2">
                    <span className="min-w-0 flex-1 truncate text-slate-300">{x.recipient}</span>
                    <StatusChip value={x.status} />
                    {x.error ? <span className="max-w-[40%] truncate text-xs text-red-300" title={x.error}>{x.error}</span> : null}
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
                      <button className="btn-primary" disabled={!!busy} onClick={doSend}>{busy === 'send' ? 'Queueing…' : 'Queue the send'}</button></>}>
        <div className="flex flex-col gap-3">
          <Checkbox checked={send?.force} onChange={(v) => setSend({ ...send, force: v })} label="Send again even if already delivered"
                    hint="Used after a correction: it bumps the document version and re-sends." />
          <Checkbox checked={send?.ccHr} onChange={(v) => setSend({ ...send, ccHr: v })} label="Copy the HR mailbox" />
          {!send?.force && <p className="text-xs text-slate-500">People who already received this version are skipped automatically.</p>}
          <p className="text-xs text-slate-500">{num(run0.payslip_count)} payslips in this run. Without a generated PDF a slip is reported as skipped rather than failing the batch — “Generate PDFs” above fixes that.</p>
        </div>
      </Modal>
    </>
  );
}

/** Turn the compute response into a sentence, because "it computed" is not an answer when nobody did. */
function describeCompute(out, inRun) {
  const results = out?.results || out?.payslips || [];
  // The service also returns the two totals; use them when a response shape changes under us.
  const okc = out?.computed !== undefined && !results.length ? Number(out.computed) : results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok);
  const flagged = results.reduce((a, r) => a + Number(r.warnings || 0), 0);
  const errored = results.reduce((a, r) => a + Number(r.errors || 0), 0);
  if (!results.length) {
    return { tone: 'bad', text: 'Compute returned no result — this run has no people in it yet.',
             hint: 'Add employees to the run (Payruns → + New payrun → step 2) or check their contracts cover these dates.' };
  }
  if (!okc) {
    return { tone: 'bad', text: `Nothing was computed: ${failed.length} of ${results.length} people failed before a slip could be made.`,
             failed, hint: failed[0]?.code === 'NO_CONTRACT' ? 'Most of these have no contract row for the period — fix the contract, then compute again.' : null };
  }
  const bits = [`${okc} of ${results.length} payslips computed`];
  if (flagged) bits.push(`${flagged} flag${flagged === 1 ? '' : 's'}`);
  if (errored) bits.push(`${errored} blocking error${errored === 1 ? '' : 's'}`);
  if (failed.length) bits.push(`${failed.length} skipped`);
  return { tone: errored || failed.length ? 'warn' : 'good', text: bits.join(' · '), failed: failed.length ? failed : undefined,
           hint: errored ? 'Validate stays locked while an error is open — the rows marked ERROR below say what is missing.' : null };
}
function describeSend(out) {
  const queued = Number(out?.queued || 0);
  const bits = [`${queued} message${queued === 1 ? '' : 's'} queued`];
  if (out?.skipped_missing_pdf) bits.push(`${out.skipped_missing_pdf} without a PDF`);
  if (out?.skipped_missing_email) bits.push(`${out.skipped_missing_email} with no work email`);
  return { tone: queued ? 'good' : 'bad', text: bits.join(' · '),
           hint: queued ? out.driver_note : 'Nothing was queued — generate the PDFs first (or send from a paid run).' };
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

function WorkflowBar({ status, can, busy, actions, run0, onCompute, onValidate, onPdfs, onPaid, onSend, onVoid }) {
  // The server already decides what the next legal move is (run.actions); this only explains it, so a
  // button never sits there grey with no reason next to it.
  const errs = Number(run0.error_count || 0);
  const steps = [
    { key: 'compute', label: 'Compute payslips', show: ['DRAFT', 'COMPUTED'].includes(status) && can.compute, run: onCompute,
      note: 'runs every rule, pro-rata on days worked', disabled: actions.can_compute === false, why: 'The run is in a state where recomputing is not allowed.' },
    { key: 'validate', label: 'Validate & lock', show: status === 'COMPUTED' && can.validate, run: onValidate,
      note: 'numbers stop moving after this', disabled: actions.can_validate === false,
      why: errs ? `${errs} payslip${errs === 1 ? '' : 's'} still ${errs === 1 ? 'has' : 'have'} an error — fix those rows first.` : 'Nothing to validate yet.' },
    { key: 'pdf', label: 'Generate PDFs', show: ['VALIDATED', 'PAID'].includes(status) && can.pdf, run: onPdfs,
      note: 'queued to the worker, not in the browser' },
    { key: 'paid', label: 'Mark paid', show: status === 'VALIDATED' && can.paid, run: onPaid,
      note: 'releases the run for employees', disabled: actions.can_mark_paid === false, why: 'Validate the run first.' },
    { key: 'send', label: 'Email payslips', show: status === 'PAID' && can.send, run: onSend,
      note: 'bulk send with attachment' },
  ];
  return (
    <div className="mt-4 flex flex-wrap items-center gap-2">
      {steps.map((s) => s.show && (
        <button key={s.key} className="btn-primary btn-sm" onClick={s.run} disabled={!!busy || s.disabled} title={s.disabled ? s.why : s.note}>
          {busy === s.key ? 'Working…' : s.label}
        </button>
      ))}
      {status === 'DRAFT' && can.del && <button className="btn-danger btn-sm" onClick={onVoid} disabled={!!busy}>Void this draft</button>}
      {status === 'DRAFT' && !can.compute && <p className="text-xs text-slate-500">Your role can create runs but not compute them — that is deliberate: payroll_user does the maths.</p>}
      {status === 'COMPUTED' && !can.validate && <p className="text-xs text-slate-500">You can compute and correct, but only a manager validates and releases.</p>}
    </div>
  );
}
