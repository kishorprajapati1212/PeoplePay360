import { useCallback, useState } from 'react';
import { contracts, employees, org, salary } from '../../api/endpoints.js';
import { useApi, useAction } from '../../hooks/useApi.js';
import { useTable } from '../../hooks/useTable.js';
import { PageHeader } from '../../layout/PageHeader.jsx';
import { Panel } from '../../components/ui/Panel.jsx';
import { DataTable } from '../../components/data/DataTable.jsx';
import { Modal } from '../../components/ui/Modal.jsx';
import { SchemaForm, valuesFromRow } from '../../components/crud/schemaForm.jsx';
import { StatusChip } from '../../components/ui/StatusChip.jsx';
import { SearchInput, Select } from '../../components/ui/controls.jsx';
import { EmptyState, ErrorPanel } from '../../components/ui/Feedback.jsx';
import { useToast } from '../../components/ui/Toast.jsx';
import { useCan } from '../../rbac/Can.jsx';
import { inr, date, today } from '../../utils/format.js';

/**
 * One running contract per person per period — the mockup's rule "payroll uses the contract applied to
 * the selected payroll period" is enforced by the API; this screen is where you keep those dates right.
 */
const FIELDS = [
  { key: 'employee_id', label: 'Employee', type: 'select', required: true, options: [] },
  { key: 'wage', label: 'Monthly wage', type: 'money', required: true, hint: 'Basic wage. Allowances are added by the salary structure.' },
  { key: 'start_date', label: 'Starts', type: 'date', required: true },
  { key: 'end_date', label: 'Ends', type: 'date', hint: 'Blank = open ended.' },
  { key: 'salary_structure_id', label: 'Salary structure', type: 'select', options: [] },
  { key: 'department_id', label: 'Department', type: 'select', options: [] },
  { key: 'working_schedule_id', label: 'Working schedule', type: 'select', options: [] },
  { key: 'job_position', label: 'Job position' },
  { key: 'notes', label: 'Notes', type: 'textarea', rows: 2 },
];

export function ContractsPage() {
  const toast = useToast();
  const mayWrite = useCan('contract:write');
  const table = useTable({});
  const [editing, setEditing] = useState(null);
  const [values, setValues] = useState({});
  const { run, busy } = useAction();

  const list = useApi(useCallback(() => contracts.list(table.params), [table.params]), [table.params]);
  const lookups = useApi(useCallback(() => Promise.all([
    employees.list({ page: 1, page_size: 300 }), org.departments.list({}), org.schedules.list({}), salary.structures.list({}),
  ]), []), []);
  const opts = lookups.data || [];
  const fields = FIELDS.map((f) => f.key === 'employee_id' ? { ...f, options: (opts[0]?.rows || []).map((e) => ({ value: e.id, label: e.name + ' · ' + e.employee_code })) }
    : f.key === 'salary_structure_id' ? { ...f, options: (opts[3] || []).map((s) => ({ value: s.id, label: s.name })) }
    : f.key === 'department_id' ? { ...f, options: (opts[1] || []).map((d) => ({ value: d.id, label: d.name })) }
    : f.key === 'working_schedule_id' ? { ...f, options: (opts[2] || []).map((s) => ({ value: s.id, label: s.name })) } : f);

  async function save() {
    const body = { ...values, wage: Number(values.wage || 0), employee_id: values.employee_id, start_date: values.start_date };
    for (const k of ['end_date', 'salary_structure_id', 'department_id', 'working_schedule_id', 'job_position', 'notes']) if (!body[k]) delete body[k];
    await run('save', () => (editing?.id ? contracts.update(editing.id, body) : contracts.create(body)))
      .then(() => { setEditing(null); list.reload(); toast.success('Contract saved'); })
      .catch((e) => toast.error(e.message));
  }

  function openNew() { setEditing({ id: null }); setValues({ start_date: today(), wage: '' }); }
  function openEdit(row) { setEditing(row); setValues(valuesFromRow(FIELDS, row)); }

  async function act(row, what) {
    await run(what + row.id, () => (what === 'terminate' ? contracts.terminate(row.id, {}) : contracts.renew(row.id, { start_date: today() })))
      .then(() => { list.reload(); toast.success(what === 'terminate' ? 'Contract terminated' : 'Contract renewed from today'); })
      .catch((e) => toast.error(e.message));
  }

  return (
    <>
      <PageHeader title="Contracts" subtitle="The wage and the dates that payroll is computed from. Overlapping periods are refused — that is deliberate."
                  actions={mayWrite && <button className="btn-primary btn-sm" onClick={openNew}>+ New contract</button>} />
      <Panel pad={false}>
        <DataTable loading={list.loading} rows={list.data?.rows || []} error={list.error} onRetry={list.reload}
          toolbar={<>
            <SearchInput className="w-56" value={table.term} onChange={table.onSearch} placeholder="Employee name…" />
            <Select className="w-40" value={table.query.status || ''} onChange={(v) => table.onFilter('status', v)}
                    options={[{ value: 'RUNNING', label: 'Running' }, { value: 'DRAFT', label: 'Draft' }, { value: 'EXPIRED', label: 'Expired' }, { value: 'TERMINATED', label: 'Terminated' }]} placeholder="Any status" />
          </>}
          columns={[
            { key: 'employee', label: 'Employee', render: (r) => (<div><p className="text-slate-100">{r.employee || r.employee_name}</p><p className="text-xs text-slate-500">{r.employee_code}</p></div>) },
            { key: 'wage', label: 'Wage', align: 'right', render: (r) => inr(r.wage) },
            { key: 'start_date', label: 'Starts', render: (r) => date(r.start_date) },
            { key: 'end_date', label: 'Ends', render: (r) => date(r.end_date) },
            { key: 'status', label: 'Status', render: (r) => <StatusChip value={r.status} /> },
            { key: 'salary_structure', label: 'Structure', render: (r) => r.salary_structure || '—' },
            { key: 'department', label: 'Department', render: (r) => r.department || '—' },
            { key: '_a', label: '', render: (r) => mayWrite && (
              <span className="flex gap-1.5">
                <button className="btn-ghost btn-sm" onClick={() => openEdit(r)}>Edit</button>
                {r.status === 'RUNNING' && <button className="btn-ghost btn-sm" onClick={() => act(r, 'renew')}>Renew</button>}
                {r.status === 'RUNNING' && <button className="btn-danger btn-sm" onClick={() => act(r, 'terminate')}>End</button>}
              </span>) },
          ]}
          pagination={{ page: table.page, size: table.size, total: list.data?.total || 0, onPage: table.setPage, onSize: table.setSize }}
          empty={<EmptyState title="No contracts" hint="Create a contract or add an employee — the employee wizard can create the first contract with it." />} />
      </Panel>

      <Modal open={!!editing} onClose={() => setEditing(null)} width="max-w-2xl"
             title={editing?.id ? 'Edit contract' : 'New contract'} subtitle="A contract sets the wage and the period it applies to; the structure decides how it is split."
             footer={<><button className="btn-ghost" onClick={() => setEditing(null)}>Cancel</button>
                      <button className="btn-primary" disabled={!!busy} onClick={save}>{busy === 'save' ? 'Saving…' : 'Save contract'}</button></>}>
        <SchemaForm fields={fields} values={values} onChange={(k, v) => setValues((s) => ({ ...s, [k]: v }))} />
      </Modal>
    </>
  );
}
