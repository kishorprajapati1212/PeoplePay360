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
import { SearchInput, Select, Field, Input } from '../../components/ui/controls.jsx';
import { EmptyState, ErrorPanel } from '../../components/ui/Feedback.jsx';
import { useToast } from '../../components/ui/Toast.jsx';
import { useCan } from '../../rbac/Can.jsx';
import { inr, date, today } from '../../utils/format.js';
import { toRows, totalOf } from '../../utils/query.js';
import { guard, missingSentence } from '../../utils/form.js';

/**
 * One running contract per person per period — the mockup's rule "payroll uses the contract applied to
 * the selected payroll period" is enforced by the API; this screen is where you keep those dates right.
 */
const FIELDS = [
  { key: 'employee_id', label: 'Employee', type: 'select', required: true, options: [] },
  { key: 'wage', label: 'Monthly wage', type: 'money', required: true, min: 0, max: 99999999, step: '0.01', unit: '₹ / month', placeholder: '85000', hint: 'Basic wage. Allowances are added by the salary structure.' },
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
  const [ending, setEnding] = useState(null);   // the API needs the last working day, so ask for it
  const [values, setValues] = useState({});
  const [error, setError] = useState('');              // why the API refused this save, shown inside the dialog
  const [fieldErrors, setFieldErrors] = useState({});  // … and which box it belongs to
  const { run, busy } = useAction();

  const list = useApi(useCallback(() => contracts.list(table.params), [table.params]), [table.params]);
  const lookups = useApi(useCallback(() => Promise.all([
    employees.list({ page: 1, page_size: 300 }), org.departments.list({}), org.schedules.list({}), salary.structures.list({}),
  ]), []), []);
  const opts = lookups.data || [];
  const fields = FIELDS.map((f) => f.key === 'employee_id' ? { ...f, options: toRows(opts[0]).map((e) => ({ value: e.id, label: e.name + ' · ' + e.employee_code })) }
    : f.key === 'salary_structure_id' ? { ...f, options: toRows(opts[3]).map((s) => ({ value: s.id, label: s.name })) }
    : f.key === 'department_id' ? { ...f, options: toRows(opts[1]).map((d) => ({ value: d.id, label: d.name })) }
    : f.key === 'working_schedule_id' ? { ...f, options: toRows(opts[2]).map((s) => ({ value: s.id, label: s.name })) } : f);

  // What the API will refuse without it (`contractBody` in backend/src/validators/hr.schema.js), in the words
  // this screen uses for them. A blank box that only complains after the request is what a star is for.
  const NEEDED = FIELDS.filter((f) => f.required).map((f) => [f.key, f.label, true]);

  async function save() {
    setError(''); setFieldErrors({});
    const check = guard(values, NEEDED);
    if (!check.ok) { setError(missingSentence(check.missing)); return; }
    const body = { ...values, wage: Number(values.wage || 0) };
    for (const k of ['end_date', 'salary_structure_id', 'department_id', 'working_schedule_id', 'job_position', 'notes']) if (!body[k]) delete body[k];
    try {
      await run('save', () => (editing?.id ? contracts.update(editing.id, body) : contracts.create(body)));
      setEditing(null); list.reload(); toast.success('Contract saved');
    } catch (e) {
      // "This employee already has a contract covering these dates" is the answer you want to read while
      // the dialog is still open, not a toast that faded away — so it is written into the form.
      setError(e.message); setFieldErrors(e.fieldErrors || {});
    }
  }

  function openNew() { setError(''); setFieldErrors({}); setEditing({ id: null }); setValues({ start_date: today(), wage: '' }); }
  function openEdit(row) {
    setError(''); setFieldErrors({}); setEditing(row);
    setValues({ ...valuesFromRow(FIELDS, row), employee_id: row.employee_id, contract_number: row.contract_number });
  }

  async function act(row, what) {
    await run(what + row.id, () => contracts.renew(row.id, { start_date: today() }))
      .then(() => { list.reload(); toast.success('Contract renewed from today'); })
      .catch((e) => toast.error(e.message));
  }
  async function saveEnd() {
    await run('end' + ending.id, () => contracts.terminate(ending.id, { date_of_exit: ending.date_of_exit, reason: ending.reason }))
      .then(() => { setEnding(null); list.reload(); toast.success('Contract ended'); })
      .catch((e) => toast.error(e.message));
  }

  return (
    <>
      <PageHeader title="Contracts" subtitle="The wage and the dates that payroll is computed from. Overlapping periods are refused — that is deliberate."
                  actions={mayWrite && <button className="btn-primary btn-sm" onClick={openNew}>+ New contract</button>} />
      <Panel pad={false}>
        <DataTable loading={list.loading} rows={toRows(list.data)} error={list.error} onRetry={list.reload}
          toolbar={<>
            <SearchInput value={table.term} onChange={table.onSearch} placeholder="Employee name…" />
            <Select className="w-40" value={table.query.status || ''} onChange={(v) => table.onFilter('status', v)}
                    options={[{ value: 'RUNNING', label: 'Running' }, { value: 'DRAFT', label: 'Draft' }, { value: 'EXPIRED', label: 'Expired' }, { value: 'TERMINATED', label: 'Terminated' }]} placeholder="Any status" />
          </>}
          columns={[
            { key: 'contract_number', label: 'Contract no.', render: (r) => <span className="font-mono text-xs text-slate-300">{r.contract_number}</span> },
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
                {r.status === 'RUNNING' && <button className="btn-danger btn-sm" onClick={() => setEnding({ id: r.id, employee: r.employee, date_of_exit: today(), reason: '' })}>End</button>}
              </span>) },
          ]}
          pagination={{ page: table.page, size: table.size, total: totalOf(list.data, toRows(list.data).length), onPage: table.setPage, onSize: table.setSize }}
          empty={<EmptyState title="No contracts" hint="Create a contract or add an employee — the employee wizard can create the first contract with it." />} />
      </Panel>

      <Modal open={!!ending} onClose={() => setEnding(null)} width="max-w-md" title={'End the contract' + (ending?.employee ? ' · ' + ending.employee : '')}
             subtitle="Payroll stops paying from the day after this one — the final slip is pro-rated to it."
             footer={<><button className="btn-ghost" onClick={() => setEnding(null)}>Cancel</button>
                      <button className="btn-danger" disabled={!!busy || !ending?.date_of_exit} onClick={saveEnd}>{busy === 'end' + (ending?.id || '') ? 'Saving…' : 'End contract'}</button></>}>
        {ending && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Last working day" required><Input type="date" value={ending.date_of_exit} onChange={(v) => setEnding({ ...ending, date_of_exit: v })} /></Field>
            <Field label="Reason" hint="Shown on the audit trail."><Input value={ending.reason} onChange={(v) => setEnding({ ...ending, reason: v })} placeholder="Role closed" /></Field>
          </div>
        )}
      </Modal>

      <Modal open={!!editing} onClose={() => setEditing(null)} width="max-w-2xl"
             title={editing?.id ? 'Edit contract' : 'New contract'} subtitle="A contract sets the wage and the period it applies to; the structure decides how it is split."
             footer={<><button className="btn-ghost" onClick={() => setEditing(null)}>Cancel</button>
                      <button className="btn-primary" disabled={!!busy} onClick={save}>{busy === 'save' ? 'Saving…' : 'Save contract'}</button></>}>
        <SchemaForm fields={fields} values={values} onChange={(k, v) => setValues((s) => ({ ...s, [k]: v }))} errors={fieldErrors} />
        {editing?.id && (
          <p className="mt-4 text-xs text-slate-500">Contract number <span className="font-mono text-slate-300">{values.contract_number}</span> — it is given out when the contract is created and never changes.</p>
        )}
        {error && (
          <p className="mt-3 rounded-lg border border-bad/40 bg-red-950/40 px-3 py-2 text-sm text-red-200">{error}</p>
        )}
      </Modal>
    </>
  );
}
