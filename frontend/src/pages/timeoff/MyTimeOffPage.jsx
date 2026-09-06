import { useCallback, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { portal, timeOff } from '../../api/endpoints.js';
import { useCan } from '../../rbac/Can.jsx';
import { useApi, useAction } from '../../hooks/useApi.js';
import { PageHeader } from '../../layout/PageHeader.jsx';
import { Panel } from '../../components/ui/Panel.jsx';
import { DataTable } from '../../components/data/DataTable.jsx';
import { Modal } from '../../components/ui/Modal.jsx';
import { Field, Select, Textarea, Input } from '../../components/ui/controls.jsx';
import { StatusChip } from '../../components/ui/StatusChip.jsx';
import { EmptyState, Notice } from '../../components/ui/Feedback.jsx';
import { useToast } from '../../components/ui/Toast.jsx';
import { date, num, today } from '../../utils/format.js';
import { toRows, totalOf } from '../../utils/query.js';
import { payoffOf } from '../../utils/leave.js';
import { guard, missingSentence } from '../../utils/form.js';

/** The employee's own view of leave: balances, history, and a two-field request form. */
export function MyTimeOffPage() {
  const toast = useToast();
  const [open, setOpen] = useState(null);
  // set the first time Apply is pressed while something is still missing — until then the form is quiet
  const [tried, setTried] = useState(false);
  const { run, busy } = useAction();
  const me = useApi(useCallback(() => portal.timeOff({ page: 1, page_size: 30 }), []), []);
  const balances = useApi(useCallback(() => portal.balances(), []), []);
  const types = useApi(useCallback(() => timeOff.types.list({}), []), []);
  const navigate = useNavigate();
  const mayGrant = useCan('timeoff:allocation_write');
  const typeList = useMemo(() => toRows(types.data), [types.data]);

  // The two boxes the API cannot do without. The button used to go grey until they were filled, which is its
  // own dead end: pressed and nothing happens, no sentence anywhere. Now it says what it needs.
  const NEEDED = [['time_off_type_id', 'The leave type'], ['start_date', 'The first day']];
  const check = guard(open || {}, NEEDED);

  async function submit() {
    setTried(true);
    if (!check.ok) { toast.error(missingSentence(check.missing)); return; }
    await run('new', () => portal.request({ ...open, end_date: open.end_date || open.start_date }))
      .then(() => { setOpen(null); me.reload(); balances.reload(); toast.success('Request sent for approval'); })
      .catch((e) => toast.error(e.message));
  }
  async function cancel(row) {
    await run('c' + row.id, () => portal.cancelRequest(row.id)).then(() => { me.reload(); balances.reload(); toast.success('Cancelled'); }).catch((e) => toast.error(e.message));
  }

  const rows = me.data?.rows || me.data || [];
  // /portal/balances answers { rows: […] } (see misc.routes) — the old `.balances` key matched nothing,
  // so the screen said "No balances have been assigned to you yet" for everyone.
  const cards = Array.isArray(balances.data) ? balances.data : balances.data?.rows || balances.data?.balances || [];
  // Balance for the type being asked for, so "you have 2 left" is said before the request, not after
  // the refusal. The portal returns the type name; a uuid match is the allocation rows' job.
  const chosenType = typeList.find((t) => String(t.id) === String(open?.time_off_type_id));
  // What this type costs, from the shared sentence in utils/leave.js.
  const payoff = payoffOf(chosenType);
  const chosenBalance = chosenType ? cards.find((b) => b.type === chosenType.name || b.name === chosenType.name || String(b.type_id) === String(chosenType.id)) : null;
  const remaining = chosenBalance ? Number(chosenBalance.remaining ?? chosenBalance.remaining_days ?? 0) : null;
  const shortBy = remaining !== null && remaining < 0 ? Math.abs(remaining) : 0;

  return (
    <>
      <PageHeader title="My time off" subtitle="Your balances are updated the moment a request is approved."
                  actions={<button className="btn-primary btn-sm" onClick={() => { setTried(false); setOpen({ time_off_type_id: '', start_date: today(), end_date: '', reason: '' }); }}>+ Request leave</button>} />

      <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map((b) => (
          <div key={b.type_id || b.type || b.code} className="panel panel-pad">
            <p className="label">{b.type || b.name}</p>
            <p className="num mt-1.5 text-2xl font-semibold tracking-tight text-slate-50">{num(b.remaining ?? b.remaining_days)} <span className="text-sm font-normal text-slate-500">left</span></p>
            <p className="text-xs text-slate-500">{num(b.taken ?? b.taken_days)} taken of {num(b.allocated ?? b.allocated_days)}{b.pending ? ` · ${num(b.pending)} pending` : ''}</p>
            {Number(b.windows) > 1 && <p className="mt-1 text-[11px] text-slate-600">across {b.windows} grants</p>}
          </div>
        ))}
        {!cards.length && (
          <div className="panel panel-pad text-sm">
            <p className="text-slate-300">No balances have been assigned to you yet.</p>
            <p className="mt-1 text-xs text-slate-500">
              {mayGrant
                ? <>Use <Link className="link" to="/time-off/allocations">Time Off → Allocations → Assign balance to many</Link> to grant a year of leave in one go.</>
                : 'HR grants them under Time Off → Allocations; the numbers here update the moment they do.'}
            </p>
          </div>
        )}
      </div>

      <Panel title="My requests" pad={false}>
        <DataTable rows={Array.isArray(rows) ? rows : []} loading={me.loading} error={me.error} onRetry={me.reload}
          columns={[
            { key: 'type', label: 'Type', render: (r) => r.type || r.leave_type },
            { key: 'start_date', label: 'From', render: (r) => date(r.start_date) },
            { key: 'end_date', label: 'To', render: (r) => date(r.end_date) },
            { key: 'duration', label: 'Days', align: 'right', render: (r) => num(r.duration) },
            { key: 'reason', label: 'Reason', render: (r) => (
              <div className="min-w-0">
                <p className="truncate text-slate-400">{r.reason || '—'}</p>
                {/* what the approver wrote back, if anything — a decision with a note is not a mystery */}
                {r.decision_remark && <p className="truncate text-xs text-slate-500">Note from HR: {r.decision_remark}</p>}
              </div>) },
            { key: 'status', label: 'Status', render: (r) => <StatusChip value={r.status} /> },
            { key: 'approver', label: 'Decided by', render: (r) => r.approved_by_name || r.approver || '—' },
            { key: '_a', label: '', render: (r) => r.status === 'TO_APPROVE' && <button className="btn-ghost btn-sm" onClick={() => cancel(r)} disabled={busy === 'c' + r.id}>Cancel</button> },
          ]}
          empty={<EmptyState title="No leave taken yet" hint="Request a day off and it appears here with its approval status." />} />
      </Panel>

      <Modal open={!!open} onClose={() => setOpen(null)} width="max-w-md" title="Request leave"
             subtitle="The API counts working days for you — holidays in between are not charged."
             footer={<><button className="btn-ghost" onClick={() => setOpen(null)}>Cancel</button>
                      <button className="btn-primary" disabled={!!busy} onClick={submit}>{busy === 'new' ? 'Sending…' : 'Send request'}</button></>}>
        {open && tried && !check.ok && (
          <Notice tone="warn" title={missingSentence(check.missing)}>
            <p>Nothing was sent. Both boxes are on the form below — the type decides whether these days are paid.</p>
          </Notice>
        )}
        {open && (
          <div className="flex flex-col gap-3">
            <Field label="Leave type" required
                   hint={typeList.length ? 'Only types HR has switched on are listed. The line under this box says whether the days come off a balance or out of pay.' : undefined}
                   error={types.error ? 'Could not load your leave types: ' + types.error.message : null}>
              <Select value={open.time_off_type_id} onChange={(v) => setOpen({ ...open, time_off_type_id: v })} placeholder="Choose a leave type"
                      ariaLabel="Leave type" loading={types.loading} error={types.error?.message}
                      emptyText={types.loading ? undefined : 'No leave types are available to you'}
                      options={typeList.map((t) => ({ value: t.id, label: t.name + (t.is_unpaid ? ' (unpaid)' : ''),
                        hint: t.requires_allocation ? null : 'no balance needed' }))} />
            </Field>
            {!types.loading && !typeList.length && (
              <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
                Nobody has switched on a leave type yet, so there is nothing to ask for. {mayGrant
                  ? <>Start at <button className="link" onClick={() => { setOpen(null); navigate('/time-off/types'); }}>Time Off → Types</button>.</>
                  : <>Ask HR to create them under Time Off → Types.</>}
              </p>
            )}
            {chosenType && (
              <p className="text-xs text-slate-500">
                <span className={payoff?.tone === 'warn' ? 'text-amber-300' : 'text-emerald-300'}>{payoff?.text}</span>
                <br />
                {chosenType.name}: {chosenType.unit === 'HOURS' ? 'counted in hours' : 'counted in working days'}
                {chosenType.requires_allocation
                  ? (remaining === null ? ' · your balance for it is not loaded yet'
                    : ` · ${remaining} left of ${num(chosenBalance.allocated ?? chosenBalance.allocated_days ?? 0)} granted${chosenBalance.pending ? ` · ${num(chosenBalance.pending)} pending` : ''}`)
                  : ' · needs no balance'}
                {chosenType.min_notice_days ? ` · ${num(chosenType.min_notice_days)} day(s) notice required` : ''}
              </p>
            )}
            {chosenType?.requires_allocation && remaining === 0 && (
              <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
                Your balance for {chosenType.name} is 0, so this will be refused unless it is a type that allows going negative.
                {mayGrant
                  ? <> Assign it: <button className="link" onClick={() => { setOpen(null); navigate('/time-off/allocations?assign=' + chosenType.id); }}>Time Off → Allocations → Assign balance to many</button>.</>
                  : ' HR assigns balances under Time Off → Allocations.'}
              </p>
            )}
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
