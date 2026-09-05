import { useCallback, useState } from 'react';
import { attendance, employees, org } from '../../api/endpoints.js';
import { useApi, useAction } from '../../hooks/useApi.js';
import { useTable } from '../../hooks/useTable.js';
import { PageHeader } from '../../layout/PageHeader.jsx';
import { Panel } from '../../components/ui/Panel.jsx';
import { DataTable } from '../../components/data/DataTable.jsx';
import { Modal } from '../../components/ui/Modal.jsx';
import { Field, Input, Select, Textarea } from '../../components/ui/controls.jsx';
import { StatusChip } from '../../components/ui/StatusChip.jsx';
import { SearchInput } from '../../components/ui/controls.jsx';
import { EmptyState } from '../../components/ui/Feedback.jsx';
import { useToast } from '../../components/ui/Toast.jsx';
import { useCan } from '../../rbac/Can.jsx';
import { date, num, today } from '../../utils/format.js';

/**
 * Attendance list + the "Attendance Entry" dialog from the mockup. Corrections are always recorded as
 * manual with a reason — that is what the API stores, and what the payslip's audit trail can point at.
 */
export function AttendancePage() {
  const toast = useToast();
  const mayWrite = useCan('attendance:write');
  const mayApprove = useCan('attendance:approve_overtime');
  const table = useTable({});
  const [entry, setEntry] = useState(null);
  const { run, busy } = useAction();
  const month = (table.query.month || new Date().toISOString().slice(0, 7));

  const list = useApi(useCallback(() => attendance.list({ ...table.params, month }), [table.params, month]), [table.params, month]);
  const exceptions = useApi(useCallback(() => attendance.exceptions({ month }), [month]), [month]);
  const people = useApi(useCallback(() => employees.list({ page: 1, page_size: 300 }), []), []);

  const rows = list.data?.rows || [];
  const totalHours = rows.reduce((sum, r) => sum + Number(r.net_worked_hours ?? r.worked_hours ?? 0), 0);

  async function saveEntry() {
    const body = { employee_id: entry.employee_id, day: entry.day, manual_reason: entry.reason || 'Corrected by HR',
                   ...(entry.check_in ? { check_in: entry.day + 'T' + entry.check_in } : {}),
                   ...(entry.check_out ? { check_out: entry.day + 'T' + entry.check_out } : {}) };
    await run('entry', () => (entry.id ? attendance.update(entry.id, body) : attendance.entry(body)))
      .then(() => { setEntry(null); list.reload(); toast.success('Attendance saved'); })
      .catch((e) => toast.error(e.message));
  }

  async function approveOvertime(row) {
    await run('ot' + row.id, () => attendance.overtime(row.id, { approved: true }))
      .then(() => { list.reload(); toast.success('Overtime approved — it will be paid in the next compute'); })
      .catch((e) => toast.error(e.message));
  }

  return (
    <>
      <PageHeader title="Attendance" subtitle="Marked hours per person per day. Missing punches and unapproved overtime are listed on the right, because that is what breaks a payslip."
                  actions={<>
                    <label className="mr-1 flex items-end gap-1">
                      <span className="label">Month</span>
                      <input type="month" className="input ml-2 w-40" value={month} onChange={(e) => table.onFilter('month', e.target.value)} />
                    </label>
                    {mayWrite && <button className="btn-primary btn-sm" onClick={() => setEntry({ day: today(), employee_id: '', check_in: '09:30', check_out: '18:30', reason: '' })}>+ Mark entry</button>}
                  </>} />

      <div className="grid gap-4 xl:grid-cols-4">
        <Panel className="xl:col-span-3" pad={false}>
          <DataTable loading={list.loading} rows={rows} error={list.error} onRetry={list.reload}
            toolbar={<>
              <SearchInput className="w-56" value={table.term} onChange={table.onSearch} placeholder="Employee…" />
              <Select className="w-40" value={table.query.status || ''} onChange={(v) => table.onFilter('status', v)}
                      options={['PRESENT', 'ABSENT', 'HALF_DAY', 'ON_LEAVE', 'HOLIDAY', 'MISSING_CHECKOUT'].map((v) => ({ value: v, label: v.replace('_', ' ') }))} placeholder="Any status" />
              <span className="ml-auto text-xs text-slate-500">{num(rows.length)} rows · {totalHours.toFixed(1)} hours in view</span>
            </>}
            columns={[
              { key: 'day', label: 'Day', render: (r) => date(r.day) },
              { key: 'employee', label: 'Employee', render: (r) => (<div><p className="text-slate-100">{r.employee}</p><p className="text-xs text-slate-500">{r.employee_code} · {r.department}</p></div>) },
              { key: 'check_in', label: 'In', render: (r) => String(r.check_in || '—').slice(11, 16) },
              { key: 'check_out', label: 'Out', render: (r) => String(r.check_out || '—').slice(11, 16) },
              { key: 'break_minutes', label: 'Break', align: 'right', render: (r) => num(r.break_minutes) },
              { key: 'net_worked_hours', label: 'Worked', align: 'right', render: (r) => Number(r.net_worked_hours ?? r.worked_hours ?? 0).toFixed(2) },
              { key: 'overtime_hours', label: 'OT', align: 'right', render: (r) => (Number(r.overtime_hours) ? <span className="text-amber-300">{Number(r.overtime_hours).toFixed(2)}</span> : '0') },
              { key: 'status', label: 'Status', render: (r) => <StatusChip value={r.status} /> },
              { key: 'overtime_approved', label: 'OT', render: (r) => (Number(r.overtime_hours) > 0
                  ? (r.overtime_approved ? <span className="chip border-emerald-500/30 bg-emerald-500/10 text-emerald-300">approved</span>
                     : mayApprove ? <button className="btn-ghost btn-sm" onClick={() => approveOvertime(r)} disabled={busy === 'ot' + r.id}>Approve</button>
                     : <span className="chip border-amber-500/30 bg-amber-500/10 text-amber-300">pending</span>)
                  : <span className="text-slate-600">—</span>) },
              { key: '_a', label: '', render: (r) => mayWrite && <button className="btn-ghost btn-sm" onClick={() => setEntry({ id: r.id, employee_id: r.employee_id, day: String(r.day).slice(0, 10), check_in: String(r.check_in || '').slice(11, 16) || '09:30', check_out: String(r.check_out || '').slice(11, 16) || '18:30', reason: r.manual_reason || '' })}>Fix</button> },
            ]}
            pagination={{ page: table.page, size: table.size, total: list.data?.total || 0, onPage: table.setPage, onSize: table.setSize }}
            empty={<EmptyState title="Nothing marked this month" hint="Punches land here from the kiosk, or use “Mark entry” to add a corrected day." />} />
        </Panel>

        <Panel title="Needs attention" subtitle="exceptions the API found for this month">
          <ul className="space-y-2 text-sm">
            {(exceptions.data?.rows || exceptions.data || []).slice(0, 12).map((e) => (
              <li key={e.id || `${e.employee_id}-${e.day}`} className="flex items-center justify-between gap-2 rounded-lg bg-ink-850/70 px-2.5 py-2">
                <span className="min-w-0"><span className="block truncate text-slate-200">{e.employee}</span>
                  <span className="block text-xs text-slate-500">{date(e.day)} · {e.kind || e.status || 'issue'}</span></span>
                {mayWrite && <button className="btn-ghost btn-sm" onClick={() => setEntry({ employee_id: e.employee_id, day: String(e.day).slice(0, 10), check_in: '09:30', check_out: '18:30', reason: 'Missing punch corrected' })}>Fix</button>}
              </li>
            ))}
            {!(exceptions.data?.rows || exceptions.data || []).length && <li className="text-sm text-slate-500">No gaps. Clean month.</li>}
          </ul>
        </Panel>
      </div>

      <Modal open={!!entry} onClose={() => setEntry(null)} width="max-w-lg"
             title={entry?.id ? 'Correct attendance' : 'Attendance entry'} subtitle="Manual entries are always stamped with the reason and who made them."
             footer={<><button className="btn-ghost" onClick={() => setEntry(null)}>Cancel</button>
                      <button className="btn-primary" disabled={!!busy} onClick={saveEntry}>{busy === 'entry' ? 'Saving…' : 'Save entry'}</button></>}>
        {entry && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Employee" required className="sm:col-span-2">
              <Select value={entry.employee_id} onChange={(v) => setEntry({ ...entry, employee_id: v })} placeholder="Choose…"
                      options={(people.data?.rows || []).map((p) => ({ value: p.id, label: p.name + ' · ' + p.employee_code }))} />
            </Field>
            <Field label="Day" required><Input type="date" value={entry.day} onChange={(v) => setEntry({ ...entry, day: v })} /></Field>
            <Field label="Reason"><Input value={entry.reason} onChange={(v) => setEntry({ ...entry, reason: v })} placeholder="Punch card lost" /></Field>
            <Field label="Check-in"><Input type="time" value={entry.check_in} onChange={(v) => setEntry({ ...entry, check_in: v })} /></Field>
            <Field label="Check-out"><Input type="time" value={entry.check_out} onChange={(v) => setEntry({ ...entry, check_out: v })} /></Field>
          </div>
        )}
      </Modal>
    </>
  );
}
