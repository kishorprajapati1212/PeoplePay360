import { useCallback, useState } from 'react';
import { timeOff, employees } from '../../api/endpoints.js';
import { useApi, useAction } from '../../hooks/useApi.js';
import { useTable } from '../../hooks/useTable.js';
import { PageHeader } from '../../layout/PageHeader.jsx';
import { Panel } from '../../components/ui/Panel.jsx';
import { DataTable } from '../../components/data/DataTable.jsx';
import { Modal } from '../../components/ui/Modal.jsx';
import { Field, Select, Textarea, Input } from '../../components/ui/controls.jsx';
import { SearchInput } from '../../components/ui/controls.jsx';
import { StatusChip } from '../../components/ui/StatusChip.jsx';
import { EmptyState } from '../../components/ui/Feedback.jsx';
import { useToast } from '../../components/ui/Toast.jsx';
import { useCan } from '../../rbac/Can.jsx';
import { date, num, today } from '../../utils/format.js';
import { toRows, totalOf } from '../../utils/query.js';

/** The single approval flow from the mockup: approve or refuse, optionally with a remark. */
export function LeaveRequestsPage() {
  const toast = useToast();
  const mayApprove = useCan('timeoff:approve');
  const table = useTable({});
  const [decision, setDecision] = useState(null);
  const [remark, setRemark] = useState('');
  const [raise, setRaise] = useState(null);
  const { run, busy } = useAction();

  const list = useApi(useCallback(() => timeOff.requests.list(table.params), [table.params]), [table.params]);
  const lookups = useApi(useCallback(() => Promise.all([employees.list({ page: 1, page_size: 300 }), timeOff.types.list({})]), []), []);
  const [people, types] = lookups.data || [[], []];

  async function decide() {
    const { row, action } = decision;
    const call = action === 'approve' ? () => timeOff.requests.approve(row.id, { remark })
      : action === 'refuse' ? () => timeOff.requests.refuse(row.id, { reason: remark || 'Refused by approver' })
      : () => timeOff.requests.cancel(row.id, {});
    await run(action + row.id, call).then(() => { setDecision(null); setRemark(''); list.reload(); toast.success('Request ' + action + 'd'); })
      .catch((e) => toast.error(e.message));
  }

  async function raiseNow() {
    await run('raise', () => timeOff.requests.create({ ...raise, start_date: raise.start_date, end_date: raise.end_date || raise.start_date }))
      .then(() => { setRaise(null); list.reload(); toast.success('Request raised'); })
      .catch((e) => toast.error(e.message));
  }

  return (
    <>
      <PageHeader title="Time off requests" subtitle="Approving books the days against the allocation; refusing leaves the balance alone."
                  actions={<button className="btn-primary btn-sm" onClick={() => setRaise({ employee_id: '', time_off_type_id: '', start_date: today(), end_date: '', reason: '' })}>+ Raise for someone</button>} />
      <Panel pad={false}>
        <DataTable loading={list.loading} rows={toRows(list.data)} error={list.error} onRetry={list.reload}
          toolbar={<>
            <SearchInput className="w-56" value={table.term} onChange={table.onSearch} placeholder="Employee…" />
            <Select className="w-40" value={table.query.status || ''} onChange={(v) => table.onFilter('status', v)}
                    options={[{ value: 'PENDING', label: 'Pending' }, { value: 'APPROVED', label: 'Approved' }, { value: 'REFUSED', label: 'Refused' }, { value: 'CANCELLED', label: 'Cancelled' }]} placeholder="Any status" />
          </>}
          columns={[
            { key: 'employee', label: 'Employee', render: (r) => (<div><p className="text-slate-100">{r.employee}</p><p className="text-xs text-slate-500">{r.employee_code} · {r.department_id ? '' : ''}{r.type}</p></div>) },
            { key: 'start_date', label: 'From', render: (r) => date(r.start_date) },
            { key: 'end_date', label: 'To', render: (r) => date(r.end_date) },
            { key: 'duration', label: 'Days', align: 'right', render: (r) => num(r.approved_days ?? r.duration) },
            { key: 'half_day_period', label: 'Part', render: (r) => r.half_day_period || '—' },
            { key: 'reason', label: 'Reason', render: (r) => <span className="text-slate-400">{r.reason || '—'}</span> },
            { key: 'is_unpaid', label: 'Pay', render: (r) => (r.is_unpaid ? <span className="chip border-red-500/30 bg-red-500/10 text-red-300">unpaid</span> : <span className="text-xs text-slate-500">paid</span>) },
            { key: 'status', label: 'Status', render: (r) => <StatusChip value={r.status} /> },
            { key: '_a', label: '', render: (r) => mayApprove && r.status === 'PENDING' && (
              <span className="flex gap-1.5">
                <button className="btn-primary btn-sm" onClick={() => setDecision({ row: r, action: 'approve' })}>Approve</button>
                <button className="btn-danger btn-sm" onClick={() => setDecision({ row: r, action: 'refuse' })}>Refuse</button>
              </span>) },
          ]}
          pagination={{ page: table.page, size: table.size, total: totalOf(list.data, toRows(list.data).length), onPage: table.setPage, onSize: table.setSize }}
          empty={<EmptyState title="No requests" hint="Employees raise leave from their portal; you can also raise one here." />} />
      </Panel>

      <Modal open={!!decision} onClose={() => setDecision(null)} width="max-w-md"
             title={decision?.action === 'approve' ? 'Approve this leave' : 'Refuse this leave'}
             subtitle={decision ? `${decision.row.employee} · ${date(decision.row.start_date)} → ${date(decision.row.end_date)} · ${num(decision.row.duration)} days` : ''}
             footer={<><button className="btn-ghost" onClick={() => setDecision(null)}>Cancel</button>
                      <button className={decision?.action === 'approve' ? 'btn-primary' : 'btn-danger'} disabled={!!busy} onClick={decide}>
                        {busy ? 'Working…' : decision?.action === 'approve' ? 'Approve' : 'Refuse'}</button></>}>
        <Field label="Remark" hint="Stored on the request and shown to the employee."><Textarea value={remark} onChange={setRemark} rows={2} /></Field>
      </Modal>

      <Modal open={!!raise} onClose={() => setRaise(null)} width="max-w-lg" title="Raise a request on behalf of an employee"
             footer={<><button className="btn-ghost" onClick={() => setRaise(null)}>Cancel</button>
                      <button className="btn-primary" disabled={!!busy} onClick={raiseNow}>{busy === 'raise' ? 'Saving…' : 'Create request'}</button></>}>
        {raise && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Employee" required className="sm:col-span-2">
              <Select value={raise.employee_id} onChange={(v) => setRaise({ ...raise, employee_id: v })} placeholder="Choose…"
                      options={people.map((p) => ({ value: p.id, label: p.name + ' · ' + p.employee_code }))} />
            </Field>
            <Field label="Leave type" required>
              <Select value={raise.time_off_type_id} onChange={(v) => setRaise({ ...raise, time_off_type_id: v })} placeholder="Choose…"
                      options={types.map((t) => ({ value: t.id, label: t.name }))} />
            </Field>
            <Field label="Days" hint="End date defaults to the start date.">
              <div className="flex gap-2">
                <Input type="date" value={raise.start_date} onChange={(v) => setRaise({ ...raise, start_date: v })} />
                <Input type="date" value={raise.end_date} onChange={(v) => setRaise({ ...raise, end_date: v })} />
              </div>
            </Field>
            <Field label="Reason" className="sm:col-span-2"><Textarea value={raise.reason} onChange={(v) => setRaise({ ...raise, reason: v })} rows={2} /></Field>
          </div>
        )}
      </Modal>
    </>
  );
}

