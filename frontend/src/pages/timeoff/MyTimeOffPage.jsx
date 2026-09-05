import { useCallback, useState } from 'react';
import { portal, timeOff } from '../../api/endpoints.js';
import { useApi, useAction } from '../../hooks/useApi.js';
import { PageHeader } from '../../layout/PageHeader.jsx';
import { Panel } from '../../components/ui/Panel.jsx';
import { DataTable } from '../../components/data/DataTable.jsx';
import { Modal } from '../../components/ui/Modal.jsx';
import { Field, Select, Textarea, Input } from '../../components/ui/controls.jsx';
import { StatusChip } from '../../components/ui/StatusChip.jsx';
import { EmptyState } from '../../components/ui/Feedback.jsx';
import { useToast } from '../../components/ui/Toast.jsx';
import { date, num, today } from '../../utils/format.js';

/** The employee's own view of leave: balances, history, and a two-field request form. */
export function MyTimeOffPage() {
  const toast = useToast();
  const [open, setOpen] = useState(null);
  const { run, busy } = useAction();
  const me = useApi(useCallback(() => portal.timeOff({ page: 1, page_size: 30 }), []), []);
  const balances = useApi(useCallback(() => portal.balances(), []), []);
  const types = useApi(useCallback(() => timeOff.types.list({}), []), []);

  async function submit() {
    await run('new', () => portal.request({ ...open, end_date: open.end_date || open.start_date }))
      .then(() => { setOpen(null); me.reload(); balances.reload(); toast.success('Request sent for approval'); })
      .catch((e) => toast.error(e.message));
  }
  async function cancel(row) {
    await run('c' + row.id, () => portal.cancelRequest(row.id)).then(() => { me.reload(); balances.reload(); toast.success('Cancelled'); }).catch((e) => toast.error(e.message));
  }

  const rows = me.data?.rows || me.data || [];
  const cards = Array.isArray(balances.data) ? balances.data : balances.data?.balances || [];

  return (
    <>
      <PageHeader title="My time off" subtitle="Your balances are updated the moment a request is approved."
                  actions={<button className="btn-primary btn-sm" onClick={() => setOpen({ time_off_type_id: '', start_date: today(), end_date: '', reason: '' })}>+ Request leave</button>} />

      <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map((b) => (
          <div key={b.type || b.type_id} className="panel panel-pad">
            <p className="label">{b.type || b.name}</p>
            <p className="mt-1.5 text-2xl font-semibold text-slate-50">{num(b.remaining ?? b.remaining_days)} <span className="text-sm font-normal text-slate-500">left</span></p>
            <p className="text-xs text-slate-500">{num(b.taken ?? b.taken_days)} taken of {num(b.allocated ?? b.allocated_days)}{b.pending ? ` · ${num(b.pending)} pending` : ''}</p>
          </div>
        ))}
        {!cards.length && <div className="panel panel-pad text-sm text-slate-400">No balances allocated yet — ask HR for an annual grant.</div>}
      </div>

      <Panel title="My requests" pad={false}>
        <DataTable rows={Array.isArray(rows) ? rows : []} loading={me.loading} error={me.error} onRetry={me.reload}
          columns={[
            { key: 'type', label: 'Type', render: (r) => r.type || r.leave_type },
            { key: 'start_date', label: 'From', render: (r) => date(r.start_date) },
            { key: 'end_date', label: 'To', render: (r) => date(r.end_date) },
            { key: 'duration', label: 'Days', align: 'right', render: (r) => num(r.duration) },
            { key: 'reason', label: 'Reason', render: (r) => <span className="text-slate-400">{r.reason || '—'}</span> },
            { key: 'status', label: 'Status', render: (r) => <StatusChip value={r.status} /> },
            { key: 'approver', label: 'Decided by', render: (r) => r.approved_by_name || r.approver || '—' },
            { key: '_a', label: '', render: (r) => r.status === 'PENDING' && <button className="btn-ghost btn-sm" onClick={() => cancel(r)} disabled={busy === 'c' + r.id}>Cancel</button> },
          ]}
          empty={<EmptyState title="No leave taken yet" hint="Request a day off and it appears here with its approval status." />} />
      </Panel>

      <Modal open={!!open} onClose={() => setOpen(null)} width="max-w-md" title="Request leave"
             subtitle="The API counts working days for you — holidays in between are not charged."
             footer={<><button className="btn-ghost" onClick={() => setOpen(null)}>Cancel</button>
                      <button className="btn-primary" disabled={!!busy} onClick={submit}>{busy === 'new' ? 'Sending…' : 'Send request'}</button></>}>
        {open && (
          <div className="flex flex-col gap-3">
            <Field label="Leave type" required>
              <Select value={open.time_off_type_id} onChange={(v) => setOpen({ ...open, time_off_type_id: v })} placeholder="Choose…"
                      options={(types.data || []).map((t) => ({ value: t.id, label: t.name + (t.is_unpaid ? ' (unpaid)' : '') }))} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="From" required><Input type="date" value={open.start_date} onChange={(v) => setOpen({ ...open, start_date: v })} /></Field>
              <Field label="To" hint="Blank = one day"><Input type="date" value={open.end_date} onChange={(v) => setOpen({ ...open, end_date: v })} /></Field>
            </div>
            <Field label="Reason"><Textarea value={open.reason} onChange={(v) => setOpen({ ...open, reason: v })} rows={2} /></Field>
          </div>
        )}
      </Modal>
    </>
  );
}
