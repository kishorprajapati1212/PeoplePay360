import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { timeOff, employees } from '../../api/endpoints.js';
import { useApi, useAction } from '../../hooks/useApi.js';
import { useTable } from '../../hooks/useTable.js';
import { CrudPage } from '../../components/crud/CrudPage.jsx';
import { PageHeader } from '../../layout/PageHeader.jsx';
import { Panel } from '../../components/ui/Panel.jsx';
import { Field, Input, Select } from '../../components/ui/controls.jsx';
import { Notice } from '../../components/ui/Feedback.jsx';
import { useToast } from '../../components/ui/Toast.jsx';
import { useCan } from '../../rbac/Can.jsx';
import { num } from '../../utils/format.js';
import { toRows, totalOf } from '../../utils/query.js';


/**
 * The screen a manager actually wants on day one of a new year: give 12 days of Annual Leave to
 * everybody, or only to the twelve people in Operations. One call to POST /time-off/allocations/bulk,
 * which is transactional — either every grant is written or none is — and reports what it skipped
 * instead of failing the batch on the one person who already has a balance.
 */
function AssignBalancePanel({ typeId, onTypeId, types = [], people = [], onDone }) {
  const toast = useToast();
  const { run, busy } = useAction();
  const year = new Date().getFullYear();
  const [open, setOpen] = useState(!!typeId);
  const [term, setTerm] = useState('');
  const [sel, setSel] = useState(() => new Set());
  const [form, setForm] = useState({ allocated_days: '12', valid_from: `${year}-01-01`, valid_until: `${year}-12-31`,
                                      on_existing: 'skip', description: '' });
  useEffect(() => { if (typeId) setOpen(true); }, [typeId]);

  const shown = useMemo(() => {
    const t = term.trim().toLowerCase();
    return t ? people.filter((p) => `${p.name} ${p.employee_code} ${p.department || ''}`.toLowerCase().includes(t)) : people;
  }, [people, term]);
  const problem = !typeId ? 'Choose which leave type to grant'
    : !sel.size ? 'Pick at least one employee'
    : !(Number(form.allocated_days) > 0 && Number(form.allocated_days) <= 400) ? 'Days granted must be between 0.5 and 400'
    : !/^\d{4}-\d{2}-\d{2}$/.test(form.valid_from) || !/^\d{4}-\d{2}-\d{2}$/.test(form.valid_until) ? 'Both dates are needed'
    : form.valid_until < form.valid_from ? '“Valid until” is before “valid from”'
    : null;

  async function assign() {
    await run('assign', () => timeOff.allocations.bulk({ time_off_type_id: typeId, employee_ids: [...sel], allocated_days: Number(form.allocated_days),
      valid_from: form.valid_from, valid_until: form.valid_until, on_existing: form.on_existing, description: form.description || undefined }))
      .then((out) => {
        setSel(new Set()); onDone?.();
        toast.success(`${out.applied} employee(s) granted ${out.days} day(s) of ${out.type}`
          + (out.skipped_count ? ` · ${out.skipped_count} already had one and were left alone` : '')
          + (out.not_found ? ` · ${out.not_found} not found` : ''));
      })
      .catch((e) => toast.error(e.message));
  }

  return (
    <Panel title="Assign balance to many" subtitle="One grant per person per type — this is the button the “HR will assign it” note refers to." className="mb-4"
           actions={open ? <button className="btn-ghost btn-sm" onClick={() => { setOpen(false); onTypeId(''); }}>Close</button>
                         : <button className="btn-primary btn-sm" onClick={() => setOpen(true)}>+ Assign balance</button>}>
      {!open ? (
        <p className="text-sm text-slate-400">
          Balances are not created by an employee request. Pick a leave type and a set of people, and they get one allocation row each —
          {people.length ? ' the picker below reads the same list the Requests screen filters on.' : ' add employees first.'}
        </p>
      ) : (
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div className="flex flex-col gap-3">
            <Field label="Leave type" required hint="Only types marked “requires a leave allocation” appear.">
              <Select value={typeId} onChange={onTypeId} options={types} placeholder={types.length ? 'Choose a type…' : undefined}
                      emptyText={types.length ? undefined : 'No leave type needs a balance yet — tick “Requires a leave allocation” under Time Off → Types.'} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Days granted" required>
                <Input type="number" inputMode="decimal" min={0} max={400} step="0.5" suffix="days" placeholder="12"
                       value={form.allocated_days} onChange={(v) => setForm({ ...form, allocated_days: v })} />
              </Field>
              <Field label="If they already have one" hint="Skip keeps the existing grant exactly as it is.">
                <Select value={form.on_existing} onChange={(v) => setForm({ ...form, on_existing: v })} placeholder="Skip it (safe)"
                        options={[{ value: 'skip', label: 'Skip it' }, { value: 'add', label: 'Add these days on top' }, { value: 'replace', label: 'Replace the grant' }]} />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Valid from" required><Input type="date" value={form.valid_from} onChange={(v) => setForm({ ...form, valid_from: v })} /></Field>
              <Field label="Valid until" required><Input type="date" value={form.valid_until} onChange={(v) => setForm({ ...form, valid_until: v })} /></Field>
            </div>
            <Field label="Reason" hint="Written on the allocation row — annual grant, correction, medical…">
              <Input value={form.description} onChange={(v) => setForm({ ...form, description: v })} placeholder={`Annual grant ${year}`} />
            </Field>
          </div>

          <div className="rounded-lg border border-line bg-ink-850/50 p-2">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <span className="text-xs text-slate-400">{sel.size} of {people.length} selected</span>
              <button className="btn-ghost btn-sm" onClick={() => setSel(new Set(shown.map((p) => p.id)))}>All in view</button>
              <button className="btn-ghost btn-sm" onClick={() => setSel(new Set())}>None</button>
              <input className="input ml-auto h-8 w-40 text-sm" placeholder="Filter by name, code, department…" value={term} onChange={(e) => setTerm(e.target.value)} />
            </div>
            <div className="max-h-64 space-y-0.5 overflow-y-auto pr-1">
              {shown.map((p) => (
                <label key={p.id} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-sm hover:bg-ink-800">
                  <input type="checkbox" className="h-4 w-4 accent-brand-600" checked={sel.has(p.id)}
                         onChange={() => { const next = new Set(sel); next.has(p.id) ? next.delete(p.id) : next.add(p.id); setSel(next); }} />
                  <span className="text-slate-200">{p.name}</span>
                  <span className="text-xs text-slate-500">{p.employee_code}{p.department ? ` · ${p.department}` : ''}</span>
                </label>
              ))}
              {!shown.length && <p className="px-2 py-3 text-sm text-slate-500">Nobody matches “{term}”.</p>}
            </div>
            <div className="mt-2 flex items-center gap-3 border-t border-line/70 pt-2">
              <button className="btn-primary btn-sm" disabled={!!busy || !!problem} onClick={assign}>{busy === 'assign' ? 'Assigning…' : `Assign to ${sel.size || '…'}`}</button>
              {problem && <span className="text-xs text-amber-300">{problem}</span>}
            </div>
          </div>
        </div>
      )}
    </Panel>
  );
}

/** Grants and adjustments: the balances the requests are counted against. Carry-forward lives here too. */
export function AllocationsPage() {
  const toast = useToast();
  // ?assign=<type id> arrives from the "Assign balance" button on the Time-off types screen.
  const [params, setParams] = useSearchParams();
  const [assignFor, setAssignFor] = useState(params.get('assign') || '');
  const mayWrite = useCan('timeoff:allocation_write');
  const [carry, setCarry] = useState({ from_year: new Date().getFullYear(), to_year: new Date().getFullYear() + 1, cap: 5, type_id: '' });
  const [tick, setTick] = useState(0);   // bumped after a carry-forward so the table below refetches
  const { run, busy } = useAction();
  const people = useApi(useCallback(() => employees.list({ page: 1, page_size: 300 }), []), []);
  const types = useApi(useCallback(() => timeOff.types.list({}), []), []);
  const employeeOptions = useMemo(() => toRows(people.data).map((e) => ({ value: e.id, label: e.name + ' · ' + e.employee_code })), [people.data]);
  const typeOptions = useMemo(() => toRows(types.data).filter((t) => t.requires_allocation).map((t) => ({ value: t.id, label: t.name })), [types.data]);
  // ?assign=<id> arrives from another screen. If that type has been deleted since, the box would simply be
  // empty and the page would look broken — so it is named, with a button that takes the link off the URL.
  const assignUnknown = !!assignFor && !types.loading && !typeOptions.some((o) => String(o.value) === String(assignFor));
  // Only types that both grant days per year and allow carrying can be pushed forward — offering the rest
  // would just produce "Annual Leave does not carry forward".
  const carryOptions = useMemo(() => toRows(types.data).filter((t) => t.requires_allocation && t.carry_forward)
    .map((t) => ({ value: t.id, label: t.name })), [types.data]);

  /* The four boxes below are the whole ask of POST /api/time-off/carry-forward (see carryBody in
     backend/src/validators/hr.schema.js): a type, two years, and an optional cap in days. A blank cap means
     "no cap", so it is left out of the body rather than sent as 0 — 0 would carry nobody anything. */
  const yearOk = (v) => Number.isInteger(Number(v)) && Number(v) >= 2000 && Number(v) <= 2100;
  const carryProblem = !carry.type_id ? 'Choose a leave type first'
    : !yearOk(carry.from_year) || !yearOk(carry.to_year) ? 'Both years are needed, between 2000 and 2100'
    : Number(carry.to_year) <= Number(carry.from_year) ? 'The year you carry into has to be the later one'
    : (carry.cap !== '' && !(Number(carry.cap) >= 0 && Number(carry.cap) <= 400)) ? 'The cap is in days, 0 to 400'
    : null;

  async function carryForward() {
    const body = { type_id: carry.type_id, from_year: Number(carry.from_year), to_year: Number(carry.to_year),
                   ...(carry.cap === '' ? {} : { cap: Number(carry.cap) }) };
    await run('carry', () => timeOff.carryForward(body))
      .then((out) => { toast.success(`${out.employees} employee(s) moved, ${out.days} day(s) carried into ${out.toYear}`); setTick((n) => n + 1); })
      .catch((e) => toast.error(e.message));
  }

  useEffect(() => {
    const wanted = params.get('assign');
    if (wanted) { setAssignFor(wanted); params.delete('assign'); setParams(params, { replace: true }); }
  }, [params, setParams]);

  return (
    <>
      {assignUnknown && (
        <Notice tone="warn" title="That link named a leave type that is not in the list">
          <p>Type <code className="text-slate-300">{assignFor}</code> does not grant days per year, so there is nothing to assign — it was probably deleted or switched off after the link was made. Pick one below instead.</p>
          <button className="btn-ghost btn-sm mt-2" onClick={() => setAssignFor('')}>Ignore that link</button>
        </Notice>
      )}
      {mayWrite && (
        <AssignBalancePanel typeId={assignFor} onTypeId={setAssignFor} types={typeOptions} people={toRows(people.data)}
                           onDone={() => setTick((n) => n + 1)} />
      )}
      {mayWrite && (
        <Panel title="Carry forward" subtitle="Move last year's unused balance into the new year, capped per type." className="mb-4">
          <div className="grid items-end gap-3 sm:grid-cols-4">
            <Field label="Leave type" required>
              <Select value={carry.type_id} onChange={(v) => setCarry({ ...carry, type_id: v })} options={carryOptions} placeholder="Choose a type…" />
            </Field>
            <Field label="From year" hint="The year whose unused days move out.">
              <Input type="number" inputMode="numeric" min={2000} max={2100} maxLength={4} placeholder="2025"
                     value={carry.from_year} onChange={(v) => setCarry({ ...carry, from_year: v })} />
            </Field>
            <Field label="To year" hint="The allocation is created in this year.">
              <Input type="number" inputMode="numeric" min={2000} max={2100} maxLength={4} placeholder="2026"
                     value={carry.to_year} onChange={(v) => setCarry({ ...carry, to_year: v })} />
            </Field>
            <Field label="Cap" error={carry.cap !== '' && carryProblem?.startsWith('The cap') ? carryProblem : null} hint="Days per person — blank means no cap.">
              <Input type="number" inputMode="decimal" min={0} max={400} step="0.5" suffix="days" placeholder="5"
                     value={carry.cap} onChange={(v) => setCarry({ ...carry, cap: v })} />
            </Field>
            <div className="sm:col-span-4 flex items-center gap-3">
              <button className="btn-primary btn-sm" disabled={!!busy || !!carryProblem} onClick={carryForward}>{busy === 'carry' ? 'Running…' : 'Run carry-forward'}</button>
              {carryProblem && <span className="text-xs text-amber-300">{carryProblem}</span>}
            </div>
          </div>
        </Panel>
      )}
      <CrudPage
        title="Allocations"
        subtitle="Days granted per person per type. Requests are only approved when the remaining balance covers them."
        api={timeOff.allocations}
        readPerm="timeoff:allocation_read" writePerm="timeoff:allocation_write"
        search={false}
        reloadOn={tick}
        canDelete={() => false}
        columns={[
          { key: 'employee', label: 'Employee', render: (r) => (<div><p className="text-slate-100">{r.employee}</p><p className="text-xs text-slate-500">{r.employee_code}</p></div>) },
          { key: 'type', label: 'Type' },
          { key: 'allocated_days', label: 'Granted', align: 'right', render: (r) => num(r.allocated_days) },
          { key: 'taken_days', label: 'Taken', align: 'right', render: (r) => num(r.taken_days) },
          { key: 'pending_days', label: 'Pending', align: 'right', render: (r) => num(r.pending_days) },
          { key: 'remaining_days', label: 'Left', align: 'right', render: (r) => <span className={Number(r.remaining_days) < 0 ? 'text-red-300' : 'text-emerald-300'}>{num(r.remaining_days)}</span> },
          { key: 'valid_from', label: 'Valid from' },
          { key: 'valid_until', label: 'Valid until' },
          { key: 'status', label: 'Status' },
        ]}
        fields={[
          { key: 'employee_id', label: 'Employee', type: 'select', required: true, options: employeeOptions, placeholder: 'Choose an employee' },
          { key: 'time_off_type_id', label: 'Leave type', type: 'select', required: true, options: typeOptions, placeholder: 'Choose a type',
            emptyText: 'No leave type needs a balance yet — tick “Requires a leave allocation” on a type first.' },
          { key: 'allocated_days', label: 'Days granted', type: 'number', required: true, min: 0, max: 400, step: 0.5, unit: 'days', placeholder: '12', hint: 'Half days are allowed. 0 to 400 — a bigger grant belongs on a new row.' },
          { key: 'valid_from', label: 'Valid from', type: 'date', required: true },
          { key: 'valid_until', label: 'Valid until', type: 'date', required: true },
          { key: 'description', label: 'Reason', type: 'textarea', rows: 2, hint: 'Annual grant, manual adjustment, medical…' },
        ]}
      />
    </>
  );
}
