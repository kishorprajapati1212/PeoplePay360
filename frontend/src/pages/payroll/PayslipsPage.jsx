import { useCallback, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { payroll } from '../../api/endpoints.js';
import { useApi, useAction } from '../../hooks/useApi.js';
import { useTable } from '../../hooks/useTable.js';
import { PageHeader } from '../../layout/PageHeader.jsx';
import { Panel } from '../../components/ui/Panel.jsx';
import { DataTable } from '../../components/data/DataTable.jsx';
import { StatusChip } from '../../components/ui/StatusChip.jsx';
import { SearchInput, Select, Field, Input, Checkbox } from '../../components/ui/controls.jsx';
import { Modal } from '../../components/ui/Modal.jsx';
import { EmptyState } from '../../components/ui/Feedback.jsx';
import { useToast } from '../../components/ui/Toast.jsx';
import { inr, num, date, periodLabel } from '../../utils/format.js';
import { useCan } from '../../rbac/Can.jsx';
import { toRows, totalOf } from '../../utils/query.js';

/**
 * Payslip register: one row per person per period, with the state of its PDF and its email.
 * The toolbar's bulk action posts the *selection* (or everything still unsent in a period) to the
 * worker in one go — releasing 40 slips should not need 40 clicks on 40 detail pages.
 */
export function PayslipsPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const mayReadAll = useCan('payslip:read_all');
  const maySend = useCan('payroll:send_bulk');
  const { run, busy } = useAction();
  const [bulk, setBulk] = useState(null);
  const table = useTable({});
  const list = useApi(useCallback(() => payroll.payslips.list(table.params), [table.params]), [table.params]);
  // The payrun filter used to be a select with no options at all — a dropdown that only ever said
  // "Any payrun". Load the runs, keep the label honest.
  const runs = useApi(useCallback(() => payroll.payruns.list({ page: 1, page_size: 100 }), []), []);
  const runOptions = useMemo(() => toRows(runs.data).map((r) => ({ value: r.id, label: `${r.name} · ${periodLabel(r.period_key)}` })), [runs.data]);

  async function sendBulk() {
    const body = { ...(bulk.payrun_id ? { payrun_id: bulk.payrun_id } : {}), ...(bulk.period_key ? { period_key: bulk.period_key } : {}),
                   only_missing: !bulk.again, cc_hr: !!bulk.ccHr };
    if (!body.payrun_id && !body.period_key) { toast.error('Pick a payrun or a period first'); return; }
    await run('bulk', () => payroll.payslips.bulkSend(body)).then((out) => {
      setBulk(null);
      list.reload();
      const bits = [`${out.queued} queued`];
      if (out.skipped_missing_pdf) bits.push(`${out.skipped_missing_pdf} without a PDF`);
      if (out.skipped_missing_email) bits.push(`${out.skipped_missing_email} with no work email`);
      if (out.already_sent) bits.push(`${out.already_sent} already delivered`);
      (out.queued ? toast.success : toast.error)(`Payslip mail: ${bits.join(' · ')}. ${out.queued ? out.how_it_is_delivered : 'Nothing was queued — generate the PDFs on the payrun first.'}`);
    }).catch((e) => toast.error(e.message));
  }
  async function sendOne(row) {
    await run('s' + row.id, () => payroll.payslips.bulkSend({ payslip_ids: [row.id], only_missing: false }))
      .then((out) => { list.reload(); out.queued ? toast.success(`E-mail queued for ${row.employee}`)
        : toast.error(out.skipped.missing_pdf.length ? 'No PDF for this slip yet — generate it from the payrun (PDFs) or the slip page.'
          : out.skipped.missing_email.length ? 'This employee has no work email on file.' : 'Already delivered.'); })
      .catch((e) => toast.error(e.message));
  }

  return (
    <>
      <PageHeader title="Payslips" subtitle={mayReadAll ? 'Every slip in the system. Click one to see the rule-by-rule working.' : 'Only your own slips are listed here — the portal download is the employee path.'} />
      <Panel pad={false}>
        <DataTable rows={toRows(list.data)} loading={list.loading} error={list.error} onRetry={list.reload} onRowClick={(r) => navigate('/payslips/' + r.id)}
          toolbar={<>
            <SearchInput className="w-56" value={table.term} onChange={table.onSearch} placeholder="Employee or code…" />
            <Select className="w-40" value={table.query.status || ''} onChange={(v) => table.onFilter('status', v)}
                    options={['DRAFT', 'COMPUTED', 'VALIDATED', 'PAID', 'VOID'].map((v) => ({ value: v, label: v.charAt(0) + v.slice(1).toLowerCase() }))} placeholder="Any status" />
            <Select className="w-52" value={table.query.payrun_id || ''} onChange={(v) => table.onFilter('payrun_id', v)} options={runOptions}
                    placeholder={runs.loading ? 'Loading payruns…' : 'Any payrun'}
                    emptyText={runOptions.length ? undefined : 'No payruns yet — payslips are created by a run.'} />
            <Select className="w-40" value={table.query.missing_bank ? 'missing' : ''} onChange={(v) => table.onFilter('missing_bank', v === 'missing' ? 'true' : '')}
                    options={[{ value: 'missing', label: 'Bank details missing' }]} placeholder="Any bank status" />
            {maySend && <button className="btn-ghost btn-sm ml-auto" onClick={() => setBulk({ payrun_id: table.query.payrun_id || '', period_key: table.query.month || '', again: false, ccHr: false })}>✉ E-mail payslips…</button>}
            <span className={maySend ? 'text-xs text-slate-500' : 'ml-auto text-xs text-slate-500'}>{num(list.data?.total || 0)} slips</span>
          </>}
          columns={[
            { key: 'employee', label: 'Employee', render: (r) => (<div><p className="text-slate-100">{r.employee}</p><p className="text-xs text-slate-500">{r.employee_code} · {r.department}</p></div>) },
            { key: 'period_key', label: 'Period', render: (r) => (<div><p>{periodLabel(r.period_key)}</p><p className="text-xs text-slate-500">{r.payslip_kind ? r.payslip_kind.replace('_', ' ').toLowerCase() : 'monthly'}</p></div>) },
            { key: 'gross_amount', label: 'Gross', align: 'right', render: (r) => inr(r.gross_amount) },
            { key: 'total_deductions', label: 'Deductions', align: 'right', render: (r) => inr(r.total_deductions) },
            { key: 'net_amount', label: 'Net', align: 'right', render: (r) => <span className="font-medium text-emerald-300">{inr(r.net_amount)}</span> },
            { key: 'worked_days', label: 'Days', align: 'right', render: (r) => `${num(r.worked_days)} / ${num(r.expected_working_days)}` },
            { key: 'status', label: 'Status', render: (r) => <StatusChip value={r.status} /> },
            { key: 'document_version', label: 'Ver', align: 'right', render: (r) => 'v' + num(r.document_version || 1) },
            { key: 'pdf_generated_at', label: 'PDF', render: (r) => (r.pdf_hash ? <span className="text-xs text-emerald-300">{date(r.pdf_generated_at)}</span> : <span className="text-xs text-slate-600">—</span>) },
            { key: 'email_status', label: 'Email', render: (r) => (r.email_status ? <StatusChip value={r.email_status} /> : <span className="text-xs text-slate-600">—</span>) },
            { key: '_a', label: '', render: (r) => (maySend && ['PAID', 'VALIDATED'].includes(r.status)
                ? <button className="btn-ghost btn-sm" disabled={busy === 's' + r.id} onClick={(ev) => { ev.stopPropagation(); sendOne(r); }}>E-mail</button>
                : <span className="text-xs text-slate-600" title="Only a validated or paid slip may be released">locked</span>) },
          ]}
          pagination={{ page: table.page, size: table.size, total: totalOf(list.data, toRows(list.data).length), onPage: table.setPage, onSize: table.setSize }}
          empty={<EmptyState title="No payslips" hint="They appear as soon as a payrun is computed." />} />
      </Panel>

      <Modal open={!!bulk} onClose={() => setBulk(null)} width="max-w-md" title="E-mail payslips in bulk"
             subtitle="One worker job per person, PDF attached, capped by the daily mail limit in Company settings."
             footer={<><button className="btn-ghost" onClick={() => setBulk(null)}>Cancel</button>
                      <button className="btn-primary" disabled={!!busy} onClick={sendBulk}>{busy === 'bulk' ? 'Queueing…' : 'Queue the send'}</button></>}>
        {bulk && (
          <div className="flex flex-col gap-3">
            <Field label="Payrun" hint="Leave both blank to use the filters you already applied — the pickers below are easier than clicking 40 rows.">
              <Select value={bulk.payrun_id} onChange={(v) => setBulk({ ...bulk, payrun_id: v })} options={runOptions} placeholder="Whole payrun…" />
            </Field>
            <Field label="or period" hint="Everyone with a paid slip in this month, across runs.">
              <Input type="month" value={bulk.period_key} onChange={(v) => setBulk({ ...bulk, period_key: v })} />
            </Field>
            <Checkbox checked={bulk.again} onChange={(v) => setBulk({ ...bulk, again: v })} label="Send again even where it was already delivered"
                      hint="For a correction: the newer document version is what goes out." />
            <Checkbox checked={bulk.ccHr} onChange={(v) => setBulk({ ...bulk, ccHr: v })} label="Copy the HR mailbox" />
            <p className="text-xs text-slate-500">Only PAID and VALIDATED slips are picked up. Anything without a generated PDF or a work email is reported back instead of failing the whole batch.</p>
          </div>
        )}
      </Modal>
    </>
  );
}
