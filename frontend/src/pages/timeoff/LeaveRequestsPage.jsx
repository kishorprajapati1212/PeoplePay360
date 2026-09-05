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
import { EmptyState, Notice } from '../../components/ui/Feedback.jsx';
import { useToast } from '../../components/ui/Toast.jsx';
import { useCan } from '../../rbac/Can.jsx';
import { date, num, today } from '../../utils/format.js';
import { toRows, totalOf } from '../../utils/query.js';
import { guard, missingSentence } from '../../utils/form.js';
import { payoffOf } from '../../utils/leave.js';

/** The single approval flow from the mockup: approve or refuse, optionally with a remark. */
export function LeaveRequestsPage() {
  const toast = useToast();
  const mayApprove = useCan('timeoff:approve');
  const table = useTable({});
  const [decision, setDecision] = useState(null);
  // The row being decided on, and what its days cost — both are read by the dialog below.
  const decisionRow = decision?.row || null;
  const decisionPayoff = payoffOf({ is_unpaid: decisionRow?.is_unpaid, category: decisionRow?.category,
    requires_allocation: decisionRow?.requires_allocation });
  const [remark, setRemark] = useState('');
  // Approving fewer days than were asked for is an ordinary HR act ("take 1 of the 2"), and the API has always
  // accepted it through `approved_days`; the dialog is what was missing.
  const [approvedDays, setApprovedDays] = useState('');
  const [tried, setTried] = useState(false);
  const [raise, setRaise] = useState(null);
  const [raiseTried, setRaiseTried] = useState(false);
  // `timeOffRequestBody` needs a person, a type and a first day; the star on each box says the same thing.
  const raiseCheck = guard(raise || {}, [['employee_id', 'The employee'], ['time_off_type_id', 'The leave type'], ['start_date', 'The first day']]);
  const { run, busy } = useAction();

  const list = useApi(useCallback(() => timeOff.requests.list(table.params), [table.params]), [table.params]);
  const lookups = useApi(useCallback(() => Promise.all([employees.list({ page: 1, page_size: 300 }), timeOff.types.list({})]), []), []);
  const [people, types] = lookups.data || [[], []];

  function openDecision(row, action) {
    setDecision({ row, action });
    setRemark(row.decision_remark || '');
    setApprovedDays(String(row.duration ?? ''));
    setTried(false);
  }

  /** What this dialog will not send without. Refusing needs a reason — the server says so, so the box says so. */
  const needed = decision?.action === 'refuse' ? [['remark', 'The reason']] : [];
  const check = guard({ remark }, needed);
  const askedDays = Number(decision?.row?.duration || 0);
  const days = Number(approvedDays || askedDays);
  const daysProblem = decision?.action !== 'approve' ? null
    : !(days > 0) ? 'Approving nothing is a refusal — write the reason instead.'
    : days > askedDays ? `At most ${num(askedDays)} day(s) were asked for.` : null;

  async function decide() {
    const { row, action } = decision;
    setTried(true);
    if (!check.ok || daysProblem) { toast.error(missingSentence(check.missing) || daysProblem); return; }
    // One field for both decisions (`remark`), because that is what an approver is actually writing. The server
    // keeps the older `refuse_reason` column in step so nothing that reads it goes blind.
    const note = remark.trim();
    const body = action === 'refuse' ? { remark: note }
      : action === 'approve' ? { remark: note || undefined, ...(days === askedDays ? {} : { approved_days: days }) }
      : {};
    const call = () => (action === 'approve' ? timeOff.requests.approve(row.id, body)
      : action === 'refuse' ? timeOff.requests.refuse(row.id, body)
      : timeOff.requests.cancel(row.id, {}));
    await run(action + row.id, call)
      .then(() => {
        setDecision(null); setRemark(''); list.reload();
        toast.success(action === 'approve' ? `Approved · ${num(days)} day(s) recorded`
                    : action === 'refuse' ? 'Refused · the employee sees your reason' : 'Cancelled');
      })
      .catch((e) => toast.error(e.message));
  }

  async function raiseNow() {
    setRaiseTried(true);
    if (!raiseCheck.ok) { toast.error(missingSentence(raiseCheck.missing)); return; }
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
            <SearchInput value={table.term} onChange={table.onSearch} placeholder="Employee…" />
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
                <button className="btn-primary btn-sm" onClick={() => openDecision(r, 'approve')}>Approve</button>
                <button className="btn-danger btn-sm" onClick={() => openDecision(r, 'refuse')}>Refuse</button>
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
        {/* Approving is a payroll act, so what the days cost is written inside the box instead of being
            something the approver has to remember from a different screen. The wording comes from the leave
            type itself (utils/leave.js), and the list query carries those fields along with the request. */}
        {decisionRow && (
          <p className={'mb-3 rounded-lg border px-3 py-2 text-xs '
                        + (decisionPayoff?.tone === 'warn' ? 'border-warn/40 bg-amber-950/30 text-amber-100' : 'border-good/40 bg-emerald-950/30 text-emerald-100')}>
            <span className="font-semibold text-slate-100">{decisionRow.type || 'This leave'}</span>
            {' · '}{decisionPayoff?.text}
            {' · '}{decision?.action === 'approve' ? `${num(days)} day(s) will be recorded against the balance`
                       : 'the balance stays as it is'}
          </p>
        )}
        {decision?.action === 'approve' && (
          <Field label="Days to approve" required
                 error={tried ? daysProblem : null}
                 hint={askedDays ? `They asked for ${num(askedDays)}. Lower this only to approve part of the request — the rest is recorded as it was raised, not as leave.` : undefined}>
            <Input type="number" min="0.5" max={askedDays || 400} step="0.5" value={approvedDays} onChange={setApprovedDays} />
          </Field>
        )}
        <Field label={decision?.action === 'refuse' ? 'Reason for refusing' : 'Note for the employee'}
               required={decision?.action === 'refuse'}
               error={tried && !check.ok ? check.missing[0] + ' is needed' : null}
               hint={decision?.action === 'refuse'
                 ? 'Needed. This is the sentence the employee reads next to “Refused”, so write it as you would say it.'
                 : 'Optional. Stored with the decision and shown to the employee beside the status.'}>
          <Textarea value={remark} onChange={setRemark} rows={2}
                    placeholder={decision?.action === 'refuse' ? 'Two of these days fall in the freeze period…' : 'Approved — carry the remaining day into next month.'} />
        </Field>
        {decisionRow?.decision_remark && (
          <p className="text-xs text-slate-500">A note is already stored here: “{decisionRow.decision_remark}”. Saving replaces it.</p>
        )}
      </Modal>

      <Modal open={!!raise} onClose={() => setRaise(null)} width="max-w-lg" title="Raise a request on behalf of an employee"
             footer={<><button className="btn-ghost" onClick={() => setRaise(null)}>Cancel</button>
                      <button className="btn-primary" disabled={!!busy} onClick={raiseNow}>{busy === 'raise' ? 'Saving…' : 'Create request'}</button></>}>
        {raise && raiseTried && !raiseCheck.ok && (
          <Notice tone="warn" title={missingSentence(raiseCheck.missing)}><p>Nothing was sent — the boxes named above are the ones the API asks for.</p></Notice>
        )}
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
            <Field label="Days" required hint="First day is needed; the last day defaults to it, so one box can mean a single day.">
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

