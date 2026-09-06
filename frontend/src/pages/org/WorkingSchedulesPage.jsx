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
import { toRows } from '../../utils/query.js';
import { guard, missingSentence } from '../../utils/form.js';

/**
 * "Working Schedule — List & Form View" from the mockup: a weekly grid of worked days, start, end and break.
 *
 * Payroll reads `total_weekly_hours` off this row, so a half-day off shows up in pro-rata pay and a wrong
 * schedule quietly changes a payslip. Two things used to be broken in both directions, and they are now done
 * in exactly two small functions below:
 *   · the form posted day NAMES ('mon'), while the API wants ISO numbers (1 = Monday … 7 = Sunday), so a
 *     save was refused and the timings never arrived;
 *   · reading a saved schedule back keyed days by the same names, so an open dialog showed an empty week
 *     even when the row had hours — "the default timing is not set" was this.
 */
const DAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const DAY_LABELS = { mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat', sun: 'Sun' };

/** Form key → the number the API stores. */
const dayNumberOf = (key) => DAY_KEYS.indexOf(key) + 1;
/** Anything the API can send (a number, or an old text code) → the form key. */
function dayKeyOf(value) {
  const n = Number(value);
  if (Number.isInteger(n) && n >= 1 && n <= 7) return DAY_KEYS[n - 1];
  const text = String(value ?? '').toLowerCase().slice(0, 3);
  return DAY_KEYS.includes(text) ? text : null;
}

/** What a brand-new schedule is: the standard five-day week from the specification, 09:30–18:30, 60 min break. */
const WORKED_DEFAULT = { start: '09:30', end: '18:30', break: 60 };
const REST_DEFAULT = { start: '', end: '', break: 0 };

export function WorkingSchedulesPage() {
  const toast = useToast();
  const mayWrite = useCan('schedule:write');
  const reload = useApi(useCallback(() => org.schedules.list({}), []), []);
  const [editing, setEditing] = useState(null);
  const [tried, setTried] = useState(false);
  const { run, busy } = useAction();
  const rows = toRows(reload.data);

  // `scheduleBody` needs a name and the seven days; the days are always there now, so the name is the one
  // thing that can be missed — and it is the one thing this dialog used to send empty.
  const check = guard(editing || {}, [['name', 'The schedule name']]);

  async function save() {
    setTried(true);
    if (!check.ok) { toast.error(missingSentence(check.missing)); return; }
    await run('save', () => {
      const body = {
        name: editing.name, type: editing.type,
        timezone: editing.timezone || undefined, description: editing.description || undefined,
        is_active: editing.is_active ? 'ACTIVE' : 'INACTIVE',
        days: DAY_KEYS.map((key) => ({ day: dayNumberOf(key), ...editing.days[key] })),
      };
      return editing.id ? org.schedules.update(editing.id, body) : org.schedules.create(body);
    })
      .then(() => { setEditing(null); toast.success('Schedule saved'); reload.reload(); })
      .catch((e) => toast.error(e.message));
    }

  return (
    <>
      <PageHeader title="Working schedules" subtitle="The weekly rhythm attendance is measured against — and the divisor payroll uses for a half-month."
                  actions={mayWrite && <button className="btn-primary btn-sm" onClick={() => { setTried(false); setEditing(newSchedule()); }}>+ New schedule</button>} />
      <Panel pad={false}>
        {reload.error && <div className="p-4"><ErrorPanel error={reload.error} onRetry={reload.reload} /></div>}
        <DataTable loading={reload.loading} rows={rows} error={reload.error} onRetry={reload.reload}
                   columns={[
                     { key: 'name', label: 'Schedule', render: (r) => (
                       <div className="min-w-0"><p className="truncate text-slate-100">{r.name}</p><p className="truncate text-xs text-slate-500">{r.description || 'no description'}</p></div>) },
                     { key: 'type', label: 'Type', render: (r) => <StatusChip value={r.type} tone="info" /> },
                     { key: 'days', label: 'Week', render: (r) => <WeekStrip days={r.days} /> },
                     { key: 'days_per_week', label: 'Days', align: 'right', render: (r) => num(r.days_per_week) },
                     { key: 'total_weekly_hours', label: 'Hours / week', align: 'right', render: (r) => Number(r.total_weekly_hours || 0).toFixed(1) },
                     { key: 'is_active', label: 'Status', render: (r) => <StatusChip value={isActive(r) ? 'ACTIVE' : 'INACTIVE'} /> },
                     { key: '_a', label: '', render: (r) => mayWrite && <button className="btn-ghost btn-sm" onClick={() => setEditing(fromRow(r))}>Edit</button> },
                   ]}
                   empty={<EmptyState title="No schedules" hint="Create a 5-day, 40-hour schedule to start — payroll and attendance both fall back to it." />} />
      </Panel>

      <Modal open={!!editing} onClose={() => setEditing(null)} width="max-w-3xl"
             title={editing?.id ? 'Edit schedule' : 'New schedule'} subtitle="Uncheck a day to make it a weekly off."
             footer={<><button className="btn-ghost" onClick={() => setEditing(null)}>Cancel</button>
                      <button className="btn-ghost btn-sm" onClick={() => setEditing({ ...editing, ...standardWeek() })}>Fill the standard 5-day week</button>
                      <button className="btn-primary" onClick={save} disabled={!!busy}>{busy === 'save' ? 'Saving…' : 'Save schedule'}</button></>}>
        {editing && (
          <div className="flex flex-col gap-4">
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Name" required error={tried && !editing.name?.trim() ? 'The schedule needs a name — this is what appears on the employee record.' : null}>
              <Input value={editing.name} onChange={(v) => setEditing({ ...editing, name: v })} placeholder="OXP Standard — Mon to Fri" />
            </Field>
              <Field label="Type"><Select value={editing.type} onChange={(v) => setEditing({ ...editing, type: v })}
                options={['FIXED', 'FLEXIBLE', 'SHIFT', 'PART_TIME'].map((v) => ({ value: v, label: v.replace('_', ' ') }))} /></Field>
              <Field label="Timezone"><Input value={editing.timezone} onChange={(v) => setEditing({ ...editing, timezone: v })} placeholder="Asia/Kolkata" /></Field>
            </div>

            <ScheduleGrid editing={editing} onChange={(key, patch) => setEditing(setDay(editing, key, patch))} />

            <Field label="Description"><Input value={editing.description} onChange={(v) => setEditing({ ...editing, description: v })} /></Field>
            <Checkbox checked={editing.is_active} onChange={(v) => setEditing({ ...editing, is_active: v })} label="Active" hint="Inactive schedules stay for history but cannot be assigned." />
          </div>
        )}
      </Modal>
    </>
  );
}

/** One row per day: worked, start, end, break. Broken out so the page above reads as list + dialog. */
function ScheduleGrid({ editing, onChange }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead><tr>
          <th className="th text-left">Worked</th><th className="th text-left">Day</th>
          <th className="th text-left">Start</th><th className="th text-left">End</th>
          <th className="th text-left" title="Minutes, 0 to 480">Break (min)</th><th className="th text-right">Hours</th>
        </tr></thead>
        <tbody>
          {DAY_KEYS.map((key) => {
            const day = editing.days[key];
            return (
              <tr key={key} className="row">
                <td className="td"><input type="checkbox" className="h-4 w-4 accent-brand-600" checked={!day.rest}
                                          onChange={(e) => onChange(key, { rest: !e.target.checked })} /></td>
                <td className="td text-slate-300">{DAY_LABELS[key]}</td>
                <td className="td"><input className="input w-28" type="time" value={day.start} disabled={day.rest}
                                           aria-label={DAY_LABELS[key] + ' start time'}
                                           onChange={(e) => onChange(key, { start: e.target.value })} /></td>
                <td className="td"><input className="input w-28" type="time" value={day.end} disabled={day.rest}
                                           aria-label={DAY_LABELS[key] + ' end time'}
                                           onChange={(e) => onChange(key, { end: e.target.value })} /></td>
                <td className="td">
                  {/* minutes, not hours: the same number the API stores (0 to 480, i.e. a whole day) */}
                  <input className="input w-28" type="number" inputMode="numeric" min="0" max="480" step="5" placeholder="60"
                         title="Break in minutes, 0 to 480" aria-label={DAY_LABELS[key] + ' break in minutes'} disabled={day.rest}
                         value={day.break} onChange={(e) => onChange(key, { break: Number(e.target.value) })} />
                </td>
                <td className="td text-right text-slate-400">{day.rest ? '—' : hoursBetween(day) }</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** What the row adds up to, shown while you type so a 0 is spotted before it is saved. */
function hoursBetween(day) {
  if (!day?.start || !day?.end) return '—';
  const [sh, sm] = day.start.split(':').map(Number);
  const [eh, em] = day.end.split(':').map(Number);
  const mins = (eh * 60 + em) - (sh * 60 + sm) - Number(day.break || 0);
  return mins > 0 ? (mins / 60).toFixed(1) : '0.0';
}

const isActive = (r) => !(r.is_active === false || String(r.is_active) === 'false');

function standardWeek() {
  const days = {};
  for (const key of DAY_KEYS) {
    const worked = DAY_KEYS.indexOf(key) < 5;                  // Mon–Fri worked, Sat and Sun off
    days[key] = { ...(worked ? WORKED_DEFAULT : REST_DEFAULT), rest: !worked };
  }
  return { days };
}
function newSchedule() {
  return { name: '', type: 'FIXED', timezone: 'Asia/Kolkata', description: '', is_active: true, ...standardWeek() };
}
function fromRow(r) {
  const days = {};
  const byKey = {};
  for (const d of toRows(r.days)) {
    const key = dayKeyOf(d.day);
    if (key) byKey[key] = d;
  }
  for (const key of DAY_KEYS) {
    const src = byKey[key] || {};
    days[key] = {
      start: String(src.start || '').slice(0, 5),
      end: String(src.end || '').slice(0, 5),
      break: Number(src.break ?? (src.rest ? 0 : 60)),
      rest: !!src.rest || String(src.code || '').toUpperCase() === 'REST',
    };
  }
  return { id: r.id, name: r.name, type: r.type || 'FIXED', timezone: r.timezone || 'Asia/Kolkata',
           description: r.description || '', is_active: isActive(r), days };
}
const setDay = (editing, key, changes) => ({ ...editing, days: { ...editing.days, [key]: { ...editing.days[key], ...changes } } });

/** The seven little boxes in the list: which days this schedule works. */
function WeekStrip({ days = [] }) {
  const worked = new Set(days.filter((d) => !d.rest && String(d.code || '').toUpperCase() !== 'REST')
    .map((d) => dayKeyOf(d.day)).filter(Boolean));
  return (
    <div className="flex gap-1">
      {DAY_KEYS.map((key) => (
        <span key={key} className={'rounded px-1.5 py-0.5 text-[10px] '
          + (worked.has(key) ? 'bg-emerald-500/15 text-emerald-300' : 'bg-ink-800 text-slate-600')}>{DAY_LABELS[key]}</span>
      ))}
    </div>
  );
}
