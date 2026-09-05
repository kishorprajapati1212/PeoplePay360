import { useCallback, useState } from 'react';
import { org } from '../../api/endpoints.js';
import { useApi, useAction } from '../../hooks/useApi.js';
import { PageHeader } from '../../layout/PageHeader.jsx';
import { Panel } from '../../components/ui/Panel.jsx';
import { DataTable } from '../../components/data/DataTable.jsx';
import { Modal } from '../../components/ui/Modal.jsx';
import { Field, Input, Select, Checkbox } from '../../components/ui/controls.jsx';
import { StatusChip } from '../../components/ui/StatusChip.jsx';
import { ErrorPanel, EmptyState } from '../../components/ui/Feedback.jsx';
import { useToast } from '../../components/ui/Toast.jsx';
import { useCan } from '../../rbac/Can.jsx';
import { num } from '../../utils/format.js';
import { toRows, totalOf } from '../../utils/query.js';

const DAYS = [
  { key: 'mon', label: 'Mon' }, { key: 'tue', label: 'Tue' }, { key: 'wed', label: 'Wed' },
  { key: 'thu', label: 'Thu' }, { key: 'fri', label: 'Fri' }, { key: 'sat', label: 'Sat' }, { key: 'sun', label: 'Sun' },
];

/**
 * "Working Schedule — List & Form View" from the mockup. The form is a weekly grid: which days are
 * worked, start, end, break. Payroll reads total_weekly_hours from here, so half a day off shows up in
 * pro-rata pay. Days are sent as { day, start, end, break, rest }.
 */
export function WorkingSchedulesPage() {
  const toast = useToast();
  const mayWrite = useCan('schedule:write');
  const reload = useApi(useCallback(() => org.schedules.list({}), []), []);
  const [editing, setEditing] = useState(null);
  const { run, busy } = useAction();
  const rows = toRows(reload.data);

  async function save() {
    const body = {
      name: editing.name, type: editing.type, timezone: editing.timezone || undefined, description: editing.description || undefined,
      is_active: editing.is_active ? 'ACTIVE' : 'INACTIVE',
      days: DAYS.map((d) => ({ day: d.key, ...editing.days[d.key] })),
    };
    await run('save', () => (editing.id ? org.schedules.update(editing.id, body) : org.schedules.create(body)))
      .then(() => { setEditing(null); toast.success('Schedule saved'); reload.reload(); })
      .catch((e) => toast.error(e.message));
  }

  return (
    <>
      <PageHeader title="Working schedules" subtitle="The weekly rhythm attendance is measured against — and the divisor payroll uses for a half-month."
                  actions={mayWrite && <button className="btn-primary btn-sm" onClick={() => setEditing(blank())}>+ New schedule</button>} />
      <Panel pad={false}>
        {reload.error && <div className="p-4"><ErrorPanel error={reload.error} onRetry={reload.reload} /></div>}
        <DataTable loading={reload.loading} rows={rows} error={reload.error} onRetry={reload.reload}
                   columns={[
                     { key: 'name', label: 'Schedule', render: (r) => (
                       <div><p className="text-slate-100">{r.name}</p><p className="text-xs text-slate-500">{r.description || 'no description'}</p></div>) },
                     { key: 'type', label: 'Type', render: (r) => <StatusChip value={r.type} tone="info" /> },
                     { key: 'days', label: 'Week', render: (r) => <WeekStrip days={r.days} /> },
                     { key: 'days_per_week', label: 'Days', align: 'right', render: (r) => num(r.days_per_week) },
                     { key: 'total_weekly_hours', label: 'Hours / week', align: 'right', render: (r) => Number(r.total_weekly_hours || 0).toFixed(1) },
                     { key: 'is_active', label: 'Status', render: (r) => <StatusChip value={String(r.is_active) === 'false' || r.is_active === false ? 'INACTIVE' : 'ACTIVE'} /> },
                     { key: '_a', label: '', render: (r) => mayWrite && <button className="btn-ghost btn-sm" onClick={() => setEditing(fromRow(r))}>Edit</button> },
                   ]}
                   empty={<EmptyState title="No schedules" hint="Create a 5-day, 40-hour schedule to start — payroll and attendance both fall back to it." />} />
      </Panel>

      <Modal open={!!editing} onClose={() => setEditing(null)} width="max-w-3xl"
             title={editing?.id ? 'Edit schedule' : 'New schedule'} subtitle="Uncheck a day to make it a weekly off."
             footer={<><button className="btn-ghost" onClick={() => setEditing(null)}>Cancel</button>
                      <button className="btn-primary" onClick={save} disabled={!!busy}>{busy === 'save' ? 'Saving…' : 'Save schedule'}</button></>}>
        {editing && (
          <div className="flex flex-col gap-4">
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Name" required><Input value={editing.name} onChange={(v) => setEditing({ ...editing, name: v })} /></Field>
              <Field label="Type"><Select value={editing.type} onChange={(v) => setEditing({ ...editing, type: v })}
                options={['FIXED', 'FLEXIBLE', 'SHIFT', 'PART_TIME'].map((v) => ({ value: v, label: v.replace('_', ' ') }))} /></Field>
              <Field label="Timezone"><Input value={editing.timezone} onChange={(v) => setEditing({ ...editing, timezone: v })} placeholder="Asia/Kolkata" /></Field>
            </div>
            <table className="w-full text-sm">
              <thead><tr><th className="th text-left">Worked</th><th className="th text-left">Day</th><th className="th text-left">Start</th><th className="th text-left">End</th><th className="th text-left" title="Minutes, 0 to 480">Break (min)</th></tr></thead>
              <tbody>
                {DAYS.map((d) => {
                  const day = editing.days[d.key];
                  return (
                    <tr key={d.key} className="row">
                      <td className="td"><input type="checkbox" className="h-4 w-4 accent-brand-600" checked={!day.rest}
                            onChange={(e) => setEditing(setDay(editing, d.key, { rest: !e.target.checked }))} /></td>
                      <td className="td text-slate-300">{d.label}</td>
                      <td className="td"><input className="input w-28" type="time" value={day.start} disabled={day.rest}
                            onChange={(e) => setEditing(setDay(editing, d.key, { start: e.target.value }))} /></td>
                      <td className="td"><input className="input w-28" type="time" value={day.end} disabled={day.rest}
                            onChange={(e) => setEditing(setDay(editing, d.key, { end: e.target.value }))} /></td>
                      <td className="td">
                        {/* minutes, not hours: the same number the API stores (0 to 480, i.e. a full day) */}
                        <input className="input w-28" type="number" inputMode="numeric" min="0" max="480" step="5" placeholder="60"
                               title="Break in minutes, 0 to 480" aria-label={d.label + ' break in minutes'} disabled={day.rest}
                               value={day.break} onChange={(e) => setEditing(setDay(editing, d.key, { break: Number(e.target.value) }))} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <Field label="Description"><Input value={editing.description} onChange={(v) => setEditing({ ...editing, description: v })} /></Field>
            <Checkbox checked={editing.is_active} onChange={(v) => setEditing({ ...editing, is_active: v })} label="Active" hint="Inactive schedules stay for history but cannot be assigned." />
          </div>
        )}
      </Modal>
    </>
  );
}

function WeekStrip({ days = [] }) {
  const worked = new Set(days.filter((d) => !d.rest && d.code !== 'REST').map((d) => String(d.day).slice(0, 3).toUpperCase()));
  const order = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];
  return (
    <div className="flex gap-1">
      {order.map((d) => (
        <span key={d} className={'rounded px-1.5 py-0.5 text-[10px] ' + (worked.has(d) || worked.has(d[0] + d[1] + d[2]) ? 'bg-emerald-500/15 text-emerald-300' : 'bg-ink-800 text-slate-600')}>{d}</span>
      ))}
    </div>
  );
}

function blank() {
  const days = {};
  for (const d of DAYS) days[d.key] = { start: d.key === 'sat' || d.key === 'sun' ? '' : '09:30', end: d.key === 'sat' || d.key === 'sun' ? '' : '18:30', break: 60, rest: d.key === 'sat' || d.key === 'sun' };
  return { name: '', type: 'FIXED', timezone: 'Asia/Kolkata', description: '', is_active: true, days };
}
function fromRow(r) {
  const days = {};
  const byKey = Object.fromEntries(toRows(r.days).map((d) => [String(d.day).toLowerCase().slice(0, 3), d]));
  for (const d of DAYS) {
    const src = byKey[d.key] || {};
    days[d.key] = { start: (src.start || '').slice(0, 5), end: (src.end || '').slice(0, 5), break: Number(src.break ?? 60), rest: !!src.rest || src.code === 'REST' };
  }
  return { id: r.id, name: r.name, type: r.type || 'FIXED', timezone: r.timezone || 'Asia/Kolkata', description: r.description || '', is_active: !(r.is_active === false || String(r.is_active) === 'false'), days };
}
const setDay = (editing, key, patch) => ({ ...editing, days: { ...editing.days, [key]: { ...editing.days[key], ...patch } } });
