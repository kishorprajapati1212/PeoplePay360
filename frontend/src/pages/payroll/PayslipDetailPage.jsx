import { useCallback, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { payroll, auth } from '../../api/endpoints.js';
import { useApi, useAction } from '../../hooks/useApi.js';
import { PageHeader } from '../../layout/PageHeader.jsx';
import { Panel } from '../../components/ui/Panel.jsx';
import { StatusChip } from '../../components/ui/StatusChip.jsx';
import { KeyValue, ErrorPanel } from '../../components/ui/Feedback.jsx';
import { Modal } from '../../components/ui/Modal.jsx';
import { Field, Input, Textarea } from '../../components/ui/controls.jsx';
import { useToast } from '../../components/ui/Toast.jsx';
import { useCan } from '../../rbac/Can.jsx';
import { download } from '../../utils/download.js';
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
  const [arrear, setArrear] = useState({ amount: '', reason: '' });

  const mayEdit = useCan('payslip:edit_lines');
  const mayArrear = useCan('payslip:arrear');
  const mayCompute = useCan('payroll:compute');
  const mayPdf = useCan('payroll:pdf');

  const load = useCallback(() => Promise.all([payroll.payslips.one(id), payroll.payslips.history(id).catch(() => []), payroll.payslips.downloads(id).catch(() => [])]), [id]);
  const { data, loading, error, reload } = useApi(load, [id]);
  const [slip = {}, h = [], d = []] = data || [];
  const history = toRows(h); const downloads = toRows(d);
  const lines = toRows(slip.lines || slip.payslip_lines);
  const earnings = lines.filter((l) => l.line_kind === 'EARNING');
  const deductions = lines.filter((l) => l.line_kind === 'DEDUCTION' || l.line_kind === 'ADJUSTMENT');

  async function saveAdjust() {
    const body = { replace: false, lines: [{ rule_code: adjust.rule_code || 'MANUAL', rule_name: adjust.name || 'Manual adjustment', amount: Number(adjust.amount), line_kind: adjust.kind, computation_log: adjust.reason || 'Entered by payroll' }] };
    await run('adj', () => payroll.payslips.lines(id, body)).then(() => { setAdjust(null); reload(); toast.success('Line added — recompute to refresh the totals'); }).catch((e) => toast.error(e.message));
  }
  async function raiseArrear() {
    await run('arr', () => payroll.payslips.arrear(id, { amount: Number(arrear.amount), reason: arrear.reason }))
      .then(() => { setArrear({ amount: '', reason: '' }); reload(); toast.success('Arrear slip raised'); }).catch((e) => toast.error(e.message));
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
          <button className="btn-primary btn-sm" disabled={!!busy} onClick={() => run('dl', () => download(`/payslips/${id}/pdf`, `payslip-${slip.employee_code}-${slip.period_key}.pdf`)).catch((e) => toast.error(e.message))}>
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

        <div className="space-y-4">
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
      </div>

      <Modal open={!!adjust} onClose={() => setAdjust(null)} width="max-w-md" title="Add a manual line"
             subtitle="One-off bonus, loan recovery, arrears — recorded with a reason and versioned."
             footer={<><button className="btn-ghost" onClick={() => setAdjust(null)}>Cancel</button>
                      <button className="btn-primary" disabled={!!busy} onClick={saveAdjust}>{busy === 'adj' ? 'Saving…' : 'Add line'}</button></>}>
        {adjust && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Kind"><select className="input" value={adjust.kind} onChange={(e) => setAdjust({ ...adjust, kind: e.target.value })}>
              <option value="EARNING">Earning</option><option value="DEDUCTION">Deduction</option><option value="ADJUSTMENT">Adjustment</option></select></Field>
            <Field label="Amount" required><Input type="number" step="0.01" value={adjust.amount} onChange={(v) => setAdjust({ ...adjust, amount: v })} /></Field>
            <Field label="Name"><Input value={adjust.name} onChange={(v) => setAdjust({ ...adjust, name: v })} placeholder="Festival advance recovery" /></Field>
            <Field label="Rule code" hint="Optional — lets a report group it."><Input value={adjust.rule_code} onChange={(v) => setAdjust({ ...adjust, rule_code: v })} placeholder="FEST_ADV" /></Field>
            <Field label="Reason" className="sm:col-span-2"><Textarea rows={2} value={adjust.reason} onChange={(v) => setAdjust({ ...adjust, reason: v })} /></Field>
          </div>
        )}
      </Modal>

      <Modal open={!!arrear} onClose={() => setArrear(null)} width="max-w-md" title="Raise an arrear slip"
             subtitle="Positive pays the difference now; negative recovers it."
             footer={<><button className="btn-ghost" onClick={() => setArrear(null)}>Cancel</button>
                      <button className="btn-danger" disabled={!!busy} onClick={raiseArrear}>{busy === 'arr' ? 'Raising…' : 'Raise arrear'}</button></>}>
        <div className="flex flex-col gap-3">
          <Field label="Amount" required><Input type="number" step="0.01" value={arrear.amount} onChange={(v) => setArrear({ ...arrear, amount: v })} /></Field>
          <Field label="Reason" required><Textarea rows={2} value={arrear.reason} onChange={(v) => setArrear({ ...arrear, reason: v })} /></Field>
        </div>
      </Modal>
    </>
  );
}

function LineTable({ title, rows, tone, action }) {
  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <p className="label">{title}</p>{action}
      </div>
      <table className="w-full text-sm">
        <tbody>
          {rows.map((l, i) => (
            <tr key={l.id || i} className="border-b border-line/60 last:border-0">
              <td className="py-1.5 pr-2">
                <p className="text-slate-200">{l.rule_name || l.name || l.rule_code}</p>
                {l.computation_log ? <p className="text-[11px] text-slate-500">{l.computation_log}</p> : null}
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
