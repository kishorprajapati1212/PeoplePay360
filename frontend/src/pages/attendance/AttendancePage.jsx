import { useCallback, useState } from 'react';
import { attendance, employees, portal } from '../../api/endpoints.js';
import { useApi, useAction } from '../../hooks/useApi.js';
import { useTable } from '../../hooks/useTable.js';
import { PageHeader } from '../../layout/PageHeader.jsx';
import { Panel } from '../../components/ui/Panel.jsx';
import { PunchCard } from '../../components/attendance/PunchCard.jsx';
import { DataTable } from '../../components/data/DataTable.jsx';
import { Modal } from '../../components/ui/Modal.jsx';
import { Field, Input, Select, Textarea } from '../../components/ui/controls.jsx';
import { StatusChip } from '../../components/ui/StatusChip.jsx';
import { SearchInput } from '../../components/ui/controls.jsx';
import { EmptyState } from '../../components/ui/Feedback.jsx';
import { useToast } from '../../components/ui/Toast.jsx';
import { useCan } from '../../rbac/Can.jsx';
import { date, num, time, today } from '../../utils/format.js';
import { download } from '../../utils/download.js';
import { toRows, totalOf } from '../../utils/query.js';

/**
 * Attendance list + the "Attendance Entry" dialog from the mockup. Corrections are always recorded as
 * manual with a reason — that is what the API stores, and what the payslip's audit trail can point at.
 */
/**
 * One screen, two audiences. With `attendance:read` you get everyone's rows plus the exception panel and the
 * correction dialog; with only `attendance:read_own` (an employee) the same table fills from /api/portal/attendance,
 * which already contains only your own days — and the write buttons disappear, because the API refuses them anyway.
 */
export function AttendancePage() {
  const toast = useToast();
  const mayReadAll = useCan('attendance:read');
  const mayWrite = useCan('attendance:write');
  const mayApprove = useCan('attendance:approve_overtime');
  const mayClock = useCan('attendance:clock');
  const table = useTable({});
  const [entry, setEntry] = useState(null);
  const { run, busy } = useAction();
  const month = (table.query.month || new Date().toISOString().slice(0, 7));

  const list = useApi(useCallback(() => (mayReadAll ? attendance.list({ ...table.params, month }) : portal.attendance({ month })),
    [mayReadAll, table.params, month]), [mayReadAll, table.params, month]);
  const exceptions = useApi(useCallback(() => (mayReadAll ? attendance.exceptions({ month }) : Promise.resolve(null)),
    [mayReadAll, month]), [mayReadAll, month]);
  const people = useApi(useCallback(() => (mayReadAll ? employees.list({ page: 1, page_size: 300 }) : Promise.resolve(null)),
    [mayReadAll]), [mayReadAll]);
  // The employee's own day: what the punch card at the top of the screen reads.
  const mySummary = useApi(useCallback(() => (mayClock ? portal.summary() : Promise.resolve(null)), [mayClock]), [mayClock]);
  const reloadMine = useCallback(() => { mySummary.reload(); list.reload(); }, [mySummary, list]);

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
      <PageHeader title={mayReadAll ? 'Attendance' : 'My attendance'}
                  subtitle={mayReadAll
                    ? 'Marked hours per person per day. Missing punches and unapproved overtime are listed on the right, because that is what breaks a payslip.'
                    : 'Your own punches for the month. The payslip is computed from these hours, so a missing punch is worth reporting.'}
                  actions={<>
                    <label className="mr-1 flex items-center gap-2" title="Which month the table and export cover">
                      <span className="text-xs text-slate-500">Month</span>
                      <input type="month" className="input w-36" value={month} onChange={(e) => table.onFilter('month', e.target.value)} />
                    </label>
                    {mayReadAll && (
                      <button className="btn-ghost btn-sm" title="The month as the API sees it, with the same filters applied"
                              onClick={() => run('csv', () => download(`/attendance/export.csv?month=${month}${table.query.status ? `&status=${table.query.status}` : ''}`, `attendance-${month}.csv`)).catch((e) => toast.error(e.message))}
                              disabled={busy === 'csv'}>{busy === 'csv' ? 'Preparing…' : 'Export CSV'}</button>
                    )}
                    {mayWrite && <button className="btn-primary btn-sm" onClick={() => setEntry({ day: today(), employee_id: '', check_in: '09:30', check_out: '18:30', reason: '' })}>+ Mark entry</button>}
                  </>} />

      {/* An employee's own month starts with the punch card: the state, the hours, the next action. */}
      {mayClock && !mayReadAll && (
        <div className="mb-4">
          <PunchCard today={mySummary.data?.today_attendance} onDone={reloadMine} />
        </div>
      )}

      <div className="grid gap-4 xl:grid-cols-4">
        <Panel className="xl:col-span-3" pad={false}>
          <DataTable loading={list.loading} rows={rows} error={list.error} onRetry={list.reload}
            toolbar={<>
              {mayReadAll && <SearchInput value={table.term} onChange={table.onSearch} placeholder="Employee…" />}
              {mayReadAll && (
                <Select className="w-40" value={table.query.status || ''} onChange={(v) => table.onFilter('status', v)}
                        options={['PRESENT', 'ABSENT', 'HALF_DAY', 'ON_LEAVE', 'HOLIDAY', 'MISSING_CHECKOUT'].map((v) => ({ value: v, label: v.replace('_', ' ') }))} placeholder="Any status" />
              )}
              <span className="ml-auto text-xs text-slate-500">{num(rows.length)} rows · {totalHours.toFixed(1)} hours in view</span>
            </>}
            columns={[
              { key: 'day', label: 'Day', render: (r) => date(r.day) },
              { key: 'employee', label: 'Employee', render: (r) => (<div><p className="text-slate-100">{r.employee}</p><p className="text-xs text-slate-500">{r.employee_code} · {r.department}</p></div>) },
              { key: 'check_in', label: 'In', render: (r) => r.check_in ? <span className="num">{time(r.check_in)}</span> : '—' },
              { key: 'check_out', label: 'Out', render: (r) => r.check_out ? <span className="num">{time(r.check_out)}</span> : '—' },
              { key: 'break_minutes', label: 'Break', align: 'right', render: (r) => num(r.break_minutes) },
              { key: 'net_worked_hours', label: 'Worked', align: 'right', render: (r) => Number(r.net_worked_hours ?? r.worked_hours ?? 0).toFixed(2) },
              // Hours and their approval are two different facts, so they are two named columns now. "OT" for
              // both read like a duplicate that could be dropped, and it cannot: the hours are what payroll pays
              // only once the second one is ticked.
              { key: 'overtime_hours', label: 'Overtime (h)', align: 'right', title: 'Hours worked beyond the schedule\'s day, computed from the punches. Nothing is paid from this column alone — the next one has to say approved.',
                render: (r) => (Number(r.overtime_hours) ? <span className="text-amber-300">{Number(r.overtime_hours).toFixed(2)}</span> : <span className="text-slate-600">—</span>) },
              { key: 'status', label: 'Status', render: (r) => <StatusChip value={r.status} /> },
              { key: 'overtime_approved', label: 'Overtime approval',
                title: 'Overtime is paid once a manager approves it: the hours are computed from the punches, this column is the decision. Payroll reads only approved hours.',
                render: (r) => (Number(r.overtime_hours) > 0
                  ? (r.overtime_approved ? <span className="chip border-emerald-500/30 bg-emerald-500/10 text-emerald-300">approved</span>
                     : mayApprove ? <button className="btn-ghost btn-sm" onClick={() => approveOvertime(r)} disabled={busy === 'ot' + r.id}>Approve</button>
                     : <span className="chip border-amber-500/30 bg-amber-500/10 text-amber-300">pending</span>)
                  : <span className="text-slate-600">—</span>) },
              { key: '_a', label: '', render: (r) => mayWrite && <button className="btn-ghost btn-sm" onClick={() => setEntry({ id: r.id, employee_id: r.employee_id, employee: r.employee, day: String(r.day).slice(0, 10), check_in: r.check_in ? time(r.check_in) : '09:30', check_out: r.check_out ? time(r.check_out) : '18:30', reason: r.manual_reason || '' })}>Edit</button> },
            ]}
            pagination={{ page: table.page, size: table.size, total: totalOf(list.data, toRows(list.data).length), onPage: table.setPage, onSize: table.setSize }}
            empty={<EmptyState title="Nothing marked this month" hint="Punches land here from the kiosk, or use “Mark entry” to add a corrected day." />} />
        </Panel>

        {mayReadAll && (
        <Panel title="Needs attention" subtitle="exceptions the API found for this month">
          <ul className="space-y-2 text-sm">
            {toRows(exceptions.data).slice(0, 12).map((e) => (
              <li key={e.id || `${e.employee_id}-${e.day}`} className="flex items-center justify-between gap-2 rounded-lg bg-ink-850/70 px-2.5 py-2">
                <span className="min-w-0"><span className="block truncate text-slate-200">{e.employee}</span>
                  <span className="block text-xs text-slate-500">{date(e.day)} · {e.kind || e.status || 'issue'}</span></span>
                {mayWrite && <button className="btn-ghost btn-sm" onClick={() => setEntry({ employee_id: e.employee_id, day: String(e.day).slice(0, 10), check_in: '09:30', check_out: '18:30', reason: 'Missing punch corrected' })}>Fix</button>}
              </li>
            ))}
            {!toRows(exceptions.data).length && <li className="text-sm text-slate-500">No gaps. Clean month.</li>}
          </ul>
        </Panel>
        )}
      </div>

      <Modal open={!!entry} onClose={() => setEntry(null)} width="max-w-lg"
             title={entry?.id ? 'Correct attendance' : 'Attendance entry'} subtitle="Manual entries are always stamped with the reason and who made them."
             footer={<><button className="btn-ghost" onClick={() => setEntry(null)}>Cancel</button>
                      <button className="btn-primary" disabled={!!busy} onClick={saveEntry}>{busy === 'entry' ? 'Saving…' : 'Save entry'}</button></>}>
        {entry && (
          <div className="grid gap-3 sm:grid-cols-2">
            {/* A correction stays on the day it belongs to — the API ignores a changed employee/day, so the
                dialog shows them as facts instead of letting you type something that would be thrown away. */}
            {entry.id ? (
              <Field label="Employee" className="sm:col-span-2" hint="Correcting an existing day — the person and the date cannot change here.">
                <div className="rounded-lg border border-line bg-ink-850 px-3 py-2 text-sm text-slate-300">{entry.employee} · {entry.day}</div>
              </Field>
            ) : (
              <Field label="Employee" required className="sm:col-span-2">
                <Select value={entry.employee_id} onChange={(v) => setEntry({ ...entry, employee_id: v })} placeholder="Choose…"
                        options={toRows(people.data).map((p) => ({ value: p.id, label: p.name + ' · ' + p.employee_code }))} />
              </Field>
            )}
            {!entry.id && <Field label="Day" required><Input type="date" value={entry.day} onChange={(v) => setEntry({ ...entry, day: v })} /></Field>}
            <Field label="Reason"><Input value={entry.reason} onChange={(v) => setEntry({ ...entry, reason: v })} placeholder="Punch card lost" /></Field>
            <Field label="Check-in"><Input type="time" value={entry.check_in} onChange={(v) => setEntry({ ...entry, check_in: v })} /></Field>
            <Field label="Check-out"><Input type="time" value={entry.check_out} onChange={(v) => setEntry({ ...entry, check_out: v })} /></Field>
          </div>
        )}
      </Modal>
    </>
  );
}
