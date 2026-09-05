import { useCallback, useMemo, useState } from 'react';
import { timeOff, employees } from '../../api/endpoints.js';
import { useApi, useAction } from '../../hooks/useApi.js';
import { useTable } from '../../hooks/useTable.js';
import { CrudPage } from '../../components/crud/CrudPage.jsx';
import { PageHeader } from '../../layout/PageHeader.jsx';
import { Panel } from '../../components/ui/Panel.jsx';
import { Field, Input } from '../../components/ui/controls.jsx';
import { useToast } from '../../components/ui/Toast.jsx';
import { useCan } from '../../rbac/Can.jsx';
import { num } from '../../utils/format.js';

/** Grants and adjustments: the balances the requests are counted against. Carry-forward lives here too. */
export function AllocationsPage() {
  const toast = useToast();
  const mayWrite = useCan('timeoff:allocation_write');
  const [carry, setCarry] = useState({ from_year: new Date().getFullYear(), to_year: new Date().getFullYear() + 1, cap: 5, type_id: '' });
  const { run, busy } = useAction();
  const people = useApi(useCallback(() => employees.list({ page: 1, page_size: 300 }), []), []);
  const types = useApi(useCallback(() => timeOff.types.list({}), []), []);
  const employeeOptions = useMemo(() => (people.data?.rows || []).map((e) => ({ value: e.id, label: e.name + ' · ' + e.employee_code })), [people.data]);
  const typeOptions = useMemo(() => (types.data || []).filter((t) => t.requires_allocation).map((t) => ({ value: t.id, label: t.name })), [types.data]);

  async function carryForward() {
    await run('carry', () => timeOff.carryForward(carry)).then(() => toast.success('Carry-forward applied')).catch((e) => toast.error(e.message));
  }

  return (
    <>
      {mayWrite && (
        <Panel title="Carry forward" subtitle="Move last year's unused balance into the new year, capped per type." className="mb-4">
          <div className="grid items-end gap-3 sm:grid-cols-4">
            <Field label="Leave type" required>
              <select className="input" value={carry.type_id} onChange={(e) => setCarry({ ...carry, type_id: e.target.value })}>
                <option value="">Choose…</option>
                {typeOptions.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </Field>
            <Field label="From year"><Input type="number" value={carry.from_year} onChange={(v) => setCarry({ ...carry, from_year: Number(v) })} /></Field>
            <Field label="To year"><Input type="number" value={carry.to_year} onChange={(v) => setCarry({ ...carry, to_year: Number(v) })} /></Field>
            <Field label="Cap (days)"><Input type="number" value={carry.cap} onChange={(v) => setCarry({ ...carry, cap: Number(v) })} /></Field>
            <div className="sm:col-span-4"><button className="btn-primary btn-sm" disabled={!!busy || !carry.type_id} onClick={carryForward}>{busy === 'carry' ? 'Running…' : 'Run carry-forward'}</button></div>
          </div>
        </Panel>
      )}
      <CrudPage
        title="Allocations"
        subtitle="Days granted per person per type. Requests are only approved when the remaining balance covers them."
        api={timeOff.allocations}
        readPerm="timeoff:allocation_read" writePerm="timeoff:allocation_write"
        search={false}
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
          { key: 'employee_id', label: 'Employee', type: 'select', required: true, options: employeeOptions },
          { key: 'time_off_type_id', label: 'Leave type', type: 'select', required: true, options: typeOptions },
          { key: 'allocated_days', label: 'Days granted', type: 'number', required: true },
          { key: 'valid_from', label: 'Valid from', type: 'date', required: true },
          { key: 'valid_until', label: 'Valid until', type: 'date', required: true },
          { key: 'description', label: 'Reason', type: 'textarea', rows: 2, hint: 'Annual grant, manual adjustment, medical…' },
        ]}
      />
    </>
  );
}
