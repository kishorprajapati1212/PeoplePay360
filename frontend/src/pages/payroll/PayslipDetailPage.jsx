import { useCallback, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { payroll, portal, auth } from '../../api/endpoints.js';
import { useApi, useAction } from '../../hooks/useApi.js';
import { PageHeader } from '../../layout/PageHeader.jsx';
import { Panel } from '../../components/ui/Panel.jsx';
import { StatusChip } from '../../components/ui/StatusChip.jsx';
import { KeyValue, ErrorPanel } from '../../components/ui/Feedback.jsx';
import { Modal } from '../../components/ui/Modal.jsx';
import { Field, Input, Textarea } from '../../components/ui/controls.jsx';
import { useToast } from '../../components/ui/Toast.jsx';
import { useCan } from '../../rbac/Can.jsx';
import { download, downloadSlip } from '../../utils/download.js';
import { inr, num, date, datetime, periodLabel } from '../../utils/format.js';
import { toRows, totalOf } from '../../utils/query.js';

/**
 * One payslip, with its working: earnings, deductions, the totals the engine computed, and the buttons
 * that change it (recompute, manual adjustment, arrear). Downloading the stored PDF is audited by the API.
 */
export function PayslipDetailPage() {
  const { id } = useParams();
  const toast = useToast();
  const { run, busy } = useAction();
  const [adjust, setAdjust] = useState(null);
  const [arrear, setArrear] = useState(null);   // null = the dialog is closed; an object means "open with these values"

  const mayEdit = useCan('payslip:edit_lines');
  const mayArrear = useCan('payslip:arrear');
  const mayCompute = useCan('payroll:compute');
  const mayPdf = useCan('payroll:pdf');
  /* An employee may open this screen for their own slip only, and their reads go through /api/portal —
     which is the same payload with the ownership check already applied. One boolean, decided here. */
  const mayReadAll = useCan('payslip:read_all');

  const load = useCallback(() => Promise.all([
    (mayReadAll ? payroll.payslips.one(id) : portal.payslip(id)),
    mayReadAll ? payroll.payslips.history(id).catch(() => []) : Promise.resolve([]),
    mayReadAll ? payroll.payslips.downloads(id).catch(() => []) : Promise.resolve([]),
  ]), [id, mayReadAll]);
  const { data, loading, error, reload } = useApi(load, [id]);
  const [slip = {}, h = [], d = []] = data || [];
  const history = toRows(h); const downloads = toRows(d);
  const lines = toRows(slip.lines || slip.payslip_lines);
  const earnings = lines.filter((l) => l.line_kind === 'EARNING');
  const deductions = lines.filter((l) => l.line_kind === 'DEDUCTION' || l.line_kind === 'ADJUSTMENT');

  /* The two boxes below take one money number each. The API checks it again (±₹99,99,999, see
     linePatch/arrearBody in backend/src/validators/payroll.schema.js) — saying it here turns the box red
     while you type instead of after a save that was going to be refused. */
  const MAX_MONEY = 9999999;
  function moneyProblem(raw, { negative = false } = {}) {
    if (raw === '' || raw === null || raw === undefined) return 'Enter an amount';
    const n = Number(raw);
    if (!Number.isFinite(n)) return 'Enter a number, not text';
    if (n === 0) return 'Zero changes nothing — enter the amount';
    if (!negative && n < 0) return 'Keep it positive; the kind decides which side of the total it lands on';
    if (Math.abs(n) > MAX_MONEY) return 'Up to ₹99,99,999 only';
    return null;
  }
  const adjProblem = adjust ? (moneyProblem(adjust.amount) || (adjust.reason?.trim() ? null : 'Say why this line exists')) : null;
  const arrProblem = arrear ? (moneyProblem(arrear.amount, { negative: true }) || (arrear.reason?.trim() ? null : 'A reason is required — it is printed on the arrear slip')) : null;

  async function saveAdjust() {
    const body = { replace: false, lines: [{ rule_code: adjust.rule_code || 'MANUAL', rule_name: adjust.name || 'Manual adjustment', amount: Number(adjust.amount), line_kind: adjust.kind, computation_log: adjust.reason || 'Entered by payroll' }] };
    await run('adj', () => payroll.payslips.lines(id, body)).then(() => { setAdjust(null); reload(); toast.success('Line added — recompute to refresh the totals'); }).catch((e) => toast.error(e.message));
  }
  async function raiseArrear() {
    await run('arr', () => payroll.payslips.arrear(id, { amount: Number(arrear.amount), reason: arrear.reason }))
      .then(() => { setArrear(null); reload(); toast.success('Arrear slip raised'); }).catch((e) => toast.error(e.message));
  }

  if (loading) return <Panel><p className="text-sm text-slate-400">Loading the slip…</p></Panel>;
  if (error) return <ErrorPanel error={error} onRetry={reload} />;

  return (
    <>
      <PageHeader
        title={`${slip.employee || 'Payslip'} · ${periodLabel(slip.period_key)}`}
        subtitle={`${slip.employee_code} · ${slip.department || ''} · ${slip.payrun || ''} · document v${num(slip.document_version || 1)}`}
        actions={<>
          <button className="btn-ghost btn-sm" onClick={() => run('pv', () => auth.slipToken(id)).then((out) => window.open(out.url, '_blank')).catch((e) => toast.error(e.message))}>Preview</button>
          <button className="btn-primary btn-sm" disabled={!!busy} onClick={() => run('dl', () => mayReadAll ? download(`/payslips/${id}/pdf`, `payslip-${slip.employee_code}-${slip.period_key}.pdf`) : downloadSlip(id, slip.employee_code, slip.period_key)).catch((e) => toast.error(e.message))}>
            {slip.pdf_hash ? 'Download PDF' : 'Render & download'}
          </button>
          {mayPdf && !slip.pdf_hash && <button className="btn-ghost btn-sm" onClick={() => run('q', () => payroll.payslips.print(id)).then(() => { toast.success('PDF queued to the worker'); setTimeout(reload, 1500); }).catch((e) => toast.error(e.message))}>Queue PDF</button>}
          {mayCompute && ['DRAFT', 'COMPUTED'].includes(slip.status) && <button className="btn-ghost btn-sm" onClick={() => run('c', () => payroll.payslips.compute(id, {})).then(() => { reload(); toast.success('Recomputed'); }).catch((e) => toast.error(e.message))}>Recompute</button>}
          <Link to={'/payruns/' + slip.payrun_id} className="btn-ghost btn-sm">Payrun</Link>
        </>}
      />

      <div className="grid gap-4 xl:grid-cols-3">
        <Panel className="xl:col-span-2" pad={false}>
          <div className="flex items-center justify-between gap-4 border-b border-line px-4 py-3">
            <div className="flex items-center gap-3">
              <StatusChip value={slip.status} />
              <span className="text-xs text-slate-500">{date(slip.period_start)} – {date(slip.period_end)}</span>
            </div>
            <div className="text-right">
              <p className="label">Net pay</p>
              <p className="text-2xl font-semibold text-emerald-300">{inr(slip.net_amount)}</p>
            </div>
          </div>
          <div className="grid gap-4 p-4 sm:grid-cols-2">
            <LineTable title="Earnings" rows={earnings} tone="emerald" />
            <LineTable title="Deductions & recoveries" rows={deductions} tone="red"
                       action={mayEdit ? <button className="btn-ghost btn-sm" onClick={() => setAdjust({ kind: 'DEDUCTION', name: '', rule_code: '', amount: '', reason: '' })}>+ line</button> : null} />
          </div>
          <div className="grid grid-cols-2 gap-4 border-t border-line px-4 py-3 text-sm sm:grid-cols-5">
            <Total label="Gross" value={inr(slip.gross_amount)} />
            <Total label="Taxable" value={slip.computation_summary?.taxableGross != null ? inr(slip.computation_summary.taxableGross) : '—'} />
            <Total label="Deductions" value={'− ' + inr(slip.total_deductions)} />
            <Total label="Adjustments" value={inr(slip.total_adjustments)} />
            <Total label="YTD net" value={inr(slip.ytd_net)} />
          </div>
          <div className="border-t border-line px-4 py-3">
            <p className="label">Days & attendance in this period</p>
            <div className="mt-2 grid grid-cols-2 gap-2 text-sm sm:grid-cols-5">
              {[['Expected', slip.expected_working_days], ['Paid', slip.paid_days], ['Worked', slip.worked_days], ['Leave', slip.leave_days], ['Unpaid', slip.unpaid_leave_days], ['Absent', slip.absent_days], ['OT hours', slip.overtime_hours], ['Pro-rata', slip.pro_rata_factor]]
                .map(([label, value]) => (
                  <div key={label} className="rounded-lg bg-ink-850/70 px-2.5 py-1.5">
                    <p className="text-[11px] text-slate-500">{label}</p>
                    <p className="tabular-nums text-slate-100">{typeof value === 'number' ? (label === 'Pro-rata' ? value.toFixed(3) : num(value)) : (value ?? '—')}</p>
                  </div>
                ))}
            </div>
          </div>
        </Panel>

        <Panel title="How this slip was computed" subtitle="The same numbers the engine used, in the order it used them." className="mb-4">
          <ol className="space-y-2 text-sm text-slate-300">
            {explainSlip(slip).map((line, i) => (
              <li key={line} className="flex gap-2.5">
                <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-brand-500/15 text-[11px] font-semibold text-brand-300">{i + 1}</span>
                <span className="min-w-0">{line}</span>
              </li>
            ))}
          </ol>
        </Panel>

        {mayReadAll && (
        <div className="space-y-4">
          {mayEdit && ['DRAFT', 'COMPUTED'].includes(slip.status) && <InputsPanel slip={slip} id={id} onSaved={reload} />}
          <Panel title="Document" subtitle="what the employee receives">
            <KeyValue columns={1} rows={[
              { label: 'Rendered', value: slip.pdf_generated_at ? datetime(slip.pdf_generated_at) : 'not yet rendered' },
              { label: 'SHA-256', value: slip.pdf_hash ? String(slip.pdf_hash).slice(0, 16) + '…' : '—' },
              { label: 'Email', value: slip.email_status, render: (v) => (v ? <StatusChip value={v} /> : 'not sent') },
              { label: 'Released', value: slip.released_at ? datetime(slip.released_at) : '—' },
              { label: 'Downloads', value: `${num(slip.download_count)} · last ${slip.last_download_at ? date(slip.last_download_at) : 'never'}` },
            ]} />
            {mayArrear && slip.status === 'PAID' && (
              <div className="mt-3 border-t border-line pt-3">
                <p className="label">Correction</p>
                <p className="mt-1 text-xs text-slate-500">A paid slip is never edited. Raise an arrear slip for the difference instead — it keeps the original intact.</p>
                <button className="btn-ghost btn-sm mt-2" onClick={() => setArrear({ amount: '', reason: '' })}>Raise arrear</button>
              </div>
            )}
          </Panel>

          <Panel title="Version history" pad={false}>
            <ul className="divide-y divide-line/70 text-sm">
              {history.slice(0, 8).map((h) => (
                <li key={h.id || h.document_version} className="flex items-center gap-2 px-4 py-2">
                  <span className="chip border-line bg-ink-800 text-slate-300">v{num(h.document_version ?? h.version)}</span>
                  <span className="text-slate-400">{h.reason || h.action || 'change'}</span>
                  <span className="ml-auto text-xs text-slate-500">{datetime(h.created_at)}</span>
                </li>
              ))}
              {!history.length && <li className="px-4 py-3 text-sm text-slate-500">Only version 1 exists.</li>}
            </ul>
          </Panel>

          <Panel title="Download audit" pad={false}>
            <ul className="divide-y divide-line/70 text-sm">
              {downloads.slice(0, 6).map((d) => (
                <li key={d.id} className="flex items-center gap-2 px-4 py-2 text-xs">
                  <span className="text-slate-300">{d.by || d.actor || 'employee'}</span>
                  <span className="text-slate-500">{datetime(d.downloaded_at || d.created_at)}</span>
                  <span className="ml-auto text-slate-500">v{num(d.document_version)}</span>
                </li>
              ))}
              {!downloads.length && <li className="px-4 py-3 text-sm text-slate-500">Nobody has downloaded it.</li>}
            </ul>
          </Panel>
        </div>
        )}
      </div>

      <Modal open={!!adjust} onClose={() => setAdjust(null)} width="max-w-md" title="Add a manual line"
             subtitle="One-off bonus, loan recovery, arrears — recorded with a reason and versioned."
             footer={<><button className="btn-ghost" onClick={() => setAdjust(null)}>Cancel</button>
                      <button className="btn-primary" disabled={!!busy || !!adjProblem} onClick={saveAdjust}>{busy === 'adj' ? 'Saving…' : 'Add line'}</button></>}>
        {adjust && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Kind"><select className="input" value={adjust.kind} onChange={(e) => setAdjust({ ...adjust, kind: e.target.value })}>
              <option value="EARNING">Earning</option><option value="DEDUCTION">Deduction</option><option value="ADJUSTMENT">Adjustment</option></select></Field>
            <Field label="Amount" required error={moneyProblem(adjust.amount)} hint="Whole rupees and paise, up to ₹99,99,999.">
              <Input type="number" inputMode="decimal" step="0.01" min={0} max={MAX_MONEY} suffix="₹" placeholder="1500"
                     value={adjust.amount} onChange={(v) => setAdjust({ ...adjust, amount: v })} />
            </Field>
            <Field label="Name"><Input maxLength={80} value={adjust.name} onChange={(v) => setAdjust({ ...adjust, name: v })} placeholder="Festival advance recovery" /></Field>
            <Field label="Rule code" hint="Optional — lets a report group it."><Input maxLength={30} value={adjust.rule_code} onChange={(v) => setAdjust({ ...adjust, rule_code: v })} placeholder="FEST_ADV" /></Field>
            <Field label="Reason" required error={adjust.reason?.trim() ? null : 'Say why this line exists'} className="sm:col-span-2"
                   hint="Stored with the line, and shown to the employee as what this was.">
              <Textarea rows={2} maxLength={400} value={adjust.reason} onChange={(v) => setAdjust({ ...adjust, reason: v })} placeholder="Recovered from the June advance, part 1 of 2" />
            </Field>
          </div>
        )}
      </Modal>

      <Modal open={!!arrear} onClose={() => setArrear(null)} width="max-w-md" title="Raise an arrear slip"
             subtitle="Positive pays the difference now; negative recovers it."
             footer={<><button className="btn-ghost" onClick={() => setArrear(null)}>Cancel</button>
                      <button className="btn-danger" disabled={!!busy || !!arrProblem} onClick={raiseArrear}>{busy === 'arr' ? 'Raising…' : 'Raise arrear'}</button></>}>
        {arrear && (
          <div className="flex flex-col gap-3">
            <Field label="Amount" required error={moneyProblem(arrear.amount, { negative: true })}
                   hint="Positive pays the difference now; negative recovers it. Up to ₹99,99,999.">
              <Input type="number" inputMode="decimal" step="0.01" min={-MAX_MONEY} max={MAX_MONEY} suffix="₹" placeholder="-2400"
                     value={arrear.amount} onChange={(v) => setArrear({ ...arrear, amount: v })} />
            </Field>
            <Field label="Reason" required error={arrear.reason?.trim() ? null : 'A reason is required'} hint="Printed on the arrear slip and mailed with it.">
              <Textarea rows={2} maxLength={300} value={arrear.reason} onChange={(v) => setArrear({ ...arrear, reason: v })} placeholder="HRA was 10% light for July and August" />
            </Field>
          </div>
        )}
      </Modal>
    </>
  );
}

/**
 * A payslip is one rule after another, in `sequence` order, each writing a line; the totals are then the
 * sum of those lines. This lists the handful of decisions that actually moved money on this slip, in that
 * same order, so nobody has to read the rule table to understand a number. docs/13 explains the whole
 * calculation with a worked example.
 */
/**
 * The manual inputs a rule reads while computing — sales target, attainment, LOP days, a transport
 * allowance override. POST /payslips/:id/inputs existed on the server and in api/endpoints.js with no
 * screen calling it, which is how "the rule warned me it had no input" became a dead end: there was
 * nowhere to type it. Amount is rupees and may be negative (a recovery); the API clamps the range.
 */
function InputsPanel({ slip, id, onSaved }) {
  const toast = useToast();
  const { run, busy } = useAction();
  const existing = (slip.inputs || slip.payslip_inputs || []).map((x) => ({
    code: x.code || x.input_code || '', name: x.name || x.input_name || '', amount: x.amount ?? x.amount_value ?? '', reason: x.reason || '',
  }));
  const [rows, setRows] = useState(existing);
  const [removed, setRemoved] = useState([]);
  const set = (i, key, v) => setRows((r) => r.map((x, ix) => (ix === i ? { ...x, [key]: v } : x)));
  const blank = rows.find((r) => !String(r.code).trim());
  const badAmount = rows.find((r) => String(r.amount).trim() !== '' && !Number.isFinite(Number(r.amount)));
  const problem = blank ? 'Every input row needs a code (the rule reads it by code)'
    : badAmount ? 'Amount has to be a number of rupees — negative is allowed for a recovery'
    : null;
  async function save() {
    const body = { rows: rows.filter((r) => String(r.code).trim()).map((r) => ({ code: String(r.code).trim().toUpperCase(), name: r.name || r.code,
      amount: Number(r.amount || 0), ...(r.reason ? { reason: r.reason } : {}) })), ...(removed.length ? { remove: removed } : {}) };
    await run('in', () => payroll.payslips.inputs(id, body))
      .then(() => { setRemoved([]); onSaved?.(); toast.success('Inputs saved — recompute this slip to apply them'); })
      .catch((e) => toast.error(e.message));
  }
  return (
    <Panel title="Manual inputs" subtitle="values a rule reads that do not come from attendance or time off">
      <div className="space-y-2">
        {rows.map((r, i) => (
          <div key={i} className="grid items-center gap-2 sm:grid-cols-[7rem_minmax(0,1fr)_7rem_minmax(0,1fr)_2rem]">
            <Input value={r.code} onChange={(v) => set(i, 'code', v.toUpperCase().replace(/[^A-Z0-9_]/g, '').slice(0, 30))} placeholder="SALES_TARGET" inputMode="text" />
            <Input value={r.name} onChange={(v) => set(i, 'name', v)} placeholder="Label on the slip" />
            <Input value={r.amount} onChange={(v) => set(i, 'amount', v)} inputMode="decimal" placeholder="300000" suffix="₹" />
            <Input value={r.reason} onChange={(v) => set(i, 'reason', v)} placeholder="Why (optional, printed in the audit trail)" />
            <button className="btn-ghost btn-sm" title="Remove this input" onClick={() => { setRows((x) => x.filter((_, ix) => ix !== i)); if (r.code) setRemoved((x) => [...x, r.code]); }}>×</button>
          </div>
        ))}
        {!rows.length && <p className="text-sm text-slate-500">No inputs on this slip yet. A rule that reads one (see Rules → “input”) needs a row here before it can compute.</p>}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button className="btn-ghost btn-sm" onClick={() => setRows((r) => [...r, { code: '', name: '', amount: '', reason: '' }])}>+ Add input</button>
        <button className="btn-primary btn-sm" disabled={!!busy || !!problem || (!rows.length && !removed.length)} onClick={save}>{busy === 'in' ? 'Saving…' : 'Save inputs'}</button>
        {problem && <span className="text-xs text-amber-300">{problem}</span>}
        {removed.length ? <span className="text-xs text-slate-500">{removed.length} removed on save</span> : null}
      </div>
    </Panel>
  );
}

function explainSlip(slip) {
  const sum = slip.computation_summary || {};
  const lines = toRows(slip.lines || slip.payslip_lines);
  const out = [];
  const half = { 1: 'first half', 2: 'second half' }[Number(slip.half || sum.half || 0)];
  out.push(`Period: ${date(slip.period_start)} to ${date(slip.period_end)}${half ? `, the ${half} of the month` : ''}.`);
  if (sum.expectedMonthDays || sum.expectedSliceDays) {
    out.push(`The month has ${num(sum.expectedMonthDays)} days to pay for and this slice has ${num(sum.expectedSliceDays)} — that is what a per-day amount is divided by.`);
  }
  if (sum.factor != null && Number(sum.factor) !== 1) {
    out.push(`This person did not work the whole month, so a pro-rata line is multiplied by ${Number(sum.factor).toFixed(4)} (the ratio above), and the slip says so on each line.`);
  } else out.push(`The full month was paid, so no line needed a pro-rata factor.`);
  const earned = lines.filter((l) => l.line_kind === 'EARNING');
  const ded = lines.filter((l) => l.line_kind === 'DEDUCTION');
  const adj = lines.filter((l) => l.line_kind === 'ADJUSTMENT');
  out.push(`${earned.length} earning lines add to gross ${inr(slip.gross_amount)}. ${ded.length ? `${ded.length} deduction ${ded.length === 1 ? 'line' : 'lines'} (${ded.map((l) => l.rule_name || l.rule_code).join(', ')}) take away ${inr(slip.total_deductions)}.` : 'No deductions applied.'}${adj.length ? ` ${inr(slip.total_adjustments)} came from adjustments such as advances or rounding.` : ''}`);
  if (sum.proratedLines) out.push(`${sum.proratedLines} ${sum.proratedLines === 1 ? 'line was' : 'lines were'} scaled by the day ratio; the rest are monthly amounts that do not scale.`);
  if (sum.skippedLines) out.push(`${sum.skippedLines} ${sum.skippedLines === 1 ? 'rule was' : 'rules were'} skipped because their “apply only when” condition was false — the line still shows, at zero, with the reason.`);
  if (Number(sum.divisorDays) > 0) out.push(`Day basis: ${String(sum.dayBasis || '').replace(/_/g, ' ').toLowerCase() || 'company default'}, so one unpaid day costs 1/${num(sum.divisorDays)} of the monthly amount it applies to.`);
  out.push(`Gross ${inr(slip.gross_amount)} − deductions ${inr(slip.total_deductions)} + adjustments ${inr(slip.total_adjustments)} = net ${inr(slip.net_amount)}. The GROSS and NET rows on the slip only repeat these totals; they add nothing.`);
  const hidden = lines.filter((l) => l.is_hidden).length;
  if (hidden) out.push(`${hidden} line${hidden === 1 ? ' is' : 's are'} kept off the printed slip (a component that forms part of a total but is not shown on its own).`);
  return out;
}

function LineTable({ title, rows, tone, action }) {
  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <p className="label">{title}</p>{action}
      </div>
      <p className="mb-1 text-[11px] text-slate-500">Every amount is followed by the sentence the engine wrote while it worked that line out.</p>
      <table className="w-full text-sm">
        <tbody>
          {rows.map((l, i) => (
            <tr key={l.id || i} className="border-b border-line/60 last:border-0">
              <td className="py-1.5 pr-2">
                <p className="text-slate-200">{l.rule_name || l.name || l.rule_code}</p>
                {l.computation_log
                  ? <p className="mt-0.5 max-w-md text-xs leading-snug text-slate-400"><span className="text-slate-600">↳ </span>{l.computation_log}</p>
                  : null}
              </td>
              <td className={'py-1.5 text-right tabular-nums ' + (tone === 'emerald' ? 'text-emerald-300' : 'text-red-300')}>{inr(l.amount)}</td>
            </tr>
          ))}
          {!rows.length && <tr><td className="py-2 text-xs text-slate-500">None in this period.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}
function Total({ label, value }) {
  return <div><p className="label">{label}</p><p className="mt-0.5 tabular-nums text-slate-100">{value}</p></div>;
}
