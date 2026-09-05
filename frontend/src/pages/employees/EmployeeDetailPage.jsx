import { useCallback, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { employees } from '../../api/endpoints.js';
import { useApi, useAction } from '../../hooks/useApi.js';
import { PageHeader } from '../../layout/PageHeader.jsx';
import { Panel } from '../../components/ui/Panel.jsx';
import { Tabs } from '../../components/ui/Tabs.jsx';
import { StatusChip } from '../../components/ui/StatusChip.jsx';
import { KeyValue, ErrorPanel } from '../../components/ui/Feedback.jsx';
import { Modal } from '../../components/ui/Modal.jsx';
import { Field, Input, Textarea } from '../../components/ui/controls.jsx';
import { SchemaForm, valuesFromRow } from '../../components/crud/schemaForm.jsx';
import { DataTable } from '../../components/data/DataTable.jsx';
import { useToast } from '../../components/ui/Toast.jsx';
import { useCan } from '../../rbac/Can.jsx';
import { inr, num, date, datetime, periodLabel, today } from '../../utils/format.js';
import { toRows, totalOf } from '../../utils/query.js';

/** The employee record from the mockup: smart buttons on top, then tabs for each part of the file. */
export function EmployeeDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const mayEdit = useCan('employee:write');
  const mayTerminate = useCan('employee:terminate');
  const [tab, setTab] = useState('profile');
  const [editOpen, setEditOpen] = useState(false);
  const [exitOpen, setExitOpen] = useState(false);
  const [exit, setExit] = useState({ date_of_exit: today(), reason: '' });

  const { data: emp, loading, error, reload } = useApi(useCallback(() => employees.one(id), [id]), [id]);
  const { data: counts } = useApi(useCallback(() => employees.summary(id), [id]), [id]);
  const { run, busy } = useAction();
  const [values, setValues] = useState({});

  if (loading) return <Panel><p className="text-sm text-slate-400">Loading the record…</p></Panel>;
  if (error) return <ErrorPanel error={error} onRetry={reload} />;
  if (!emp) return <Panel><p className="text-sm text-slate-400">This employee no longer exists.</p></Panel>;

  const buttons = [
    { label: 'Contracts', key: 'contracts', count: counts?.contracts },
    { label: 'Attendance', key: 'attendance', count: counts?.attendance },
    { label: 'Time off', key: 'timeoff', count: counts?.time_off },
    { label: 'Payslips', key: 'payslips', count: counts?.payslips },
  ];

  async function saveEdit() {
    await run('edit', async () => {
      const body = { name: values.name, work_email: values.work_email, phone: values.phone, job_position: values.job_position,
                     department_id: values.department_id || undefined, employee_type: values.employee_type, status: values.status,
                     date_of_joining: values.date_of_joining, work_location: values.work_location,
                     bank_account_number: values.bank_account_number, bank_ifsc: values.bank_ifsc, bank_name: values.bank_name,
                     pan_number: values.pan_number, uan_number: values.uan_number, esi_number: values.esi_number,
                     basic_salary: Number(values.basic_salary || 0) };
      await employees.update(id, body);
      setEditOpen(false); reload(); toast.success('Employee updated');
    }).catch((e) => toast.error(e.message));
  }

  async function terminate() {
    await run('exit', () => employees.terminate(id, exit)).then(() => { setExitOpen(false); reload(); toast.success('Employee terminated'); })
      .catch((e) => toast.error(e.message));
  }

  return (
    <>
      <PageHeader
        title={emp.name}
        subtitle={`${emp.employee_code} · ${emp.job_position || 'no role set'} · ${emp.department || 'no department'} · joined ${date(emp.date_of_joining)}`}
        actions={<>
          <Link className="btn-ghost btn-sm" to="/employees">All employees</Link>
          {mayEdit && <button className="btn-ghost btn-sm" onClick={() => { setValues(valuesFromRow(EDIT_FIELDS, emp)); setEditOpen(true); }}>Edit</button>}
          {mayTerminate && emp.status !== 'TERMINATED' && <button className="btn-danger btn-sm" onClick={() => setExitOpen(true)}>Terminate</button>}
        </>}
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {buttons.map((b) => (
          <button key={b.key} onClick={() => setTab(b.key)}
                  className={'panel px-4 py-3 text-left transition-colors hover:bg-ink-850 ' + (tab === b.key ? 'ring-1 ring-brand-500/50' : '')}>
            <p className="label">{b.label}</p>
            <p className="mt-1 text-xl font-semibold text-slate-100">{num(b.count || 0)}</p>
            <p className="mt-0.5 text-[11px] text-slate-500">{hintFor(b.key, counts)}</p>
          </button>
        ))}
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-3">
        <Panel className="xl:col-span-2" pad={false}>
          <div className="px-4 pt-3"><Tabs tabs={[
            { key: 'profile', label: 'Profile' }, { key: 'contracts', label: 'Contracts' }, { key: 'attendance', label: 'Attendance' },
            { key: 'timeoff', label: 'Time off' }, { key: 'payslips', label: 'Payslips' }, { key: 'login', label: 'Portal login' },
          ]} active={tab} onChange={setTab} /></div>
          <div className="p-4">
            {tab === 'profile' && (
              <KeyValue columns={2} rows={[
                { label: 'Work email', value: emp.work_email }, { label: 'Phone', value: emp.phone },
                { label: 'Employee type', value: emp.employee_type, render: (v) => <StatusChip value={v} tone="info" /> },
                { label: 'Status', value: emp.status, render: (v) => <StatusChip value={v} /> },
                { label: 'Date of joining', value: date(emp.date_of_joining) }, { label: 'Date of exit', value: date(emp.date_of_exit) },
                { label: 'Work location', value: emp.work_location }, { label: 'Working schedule', value: emp.working_schedule },
                { label: 'Weekly hours', value: emp.total_weekly_hours }, { label: 'Manager', value: emp.manager },
                { label: 'Basic salary', value: inr(emp.basic_salary) }, { label: 'Contract wage', value: inr(emp.contract_wage) },
                { label: 'Salary structure', value: emp.salary_structure }, { label: 'Bank account', value: emp.bank_account_number },
                { label: 'IFSC', value: emp.bank_ifsc }, { label: 'PAN', value: emp.pan_number },
                { label: 'UAN', value: emp.uan_number }, { label: 'ESIC', value: emp.esi_number },
              ]} />
            )}
            {tab === 'contracts' && <SubList loader={() => employees.contracts(id)} columns={[
              { key: 'wage', label: 'Wage', render: (r) => inr(r.wage) }, { key: 'start_date', label: 'From', render: (r) => date(r.start_date) },
              { key: 'end_date', label: 'To', render: (r) => date(r.end_date) }, { key: 'status', label: 'Status', render: (r) => <StatusChip value={r.status} /> },
              { key: 'salary_structure', label: 'Structure', render: (r) => r.salary_structure || '—' }, { key: 'notes', label: 'Notes' },
            ]} />}
            {tab === 'attendance' && <SubList loader={() => employees.attendance(id, { limit: 15 })} columns={[
              { key: 'day', label: 'Day', render: (r) => date(r.day) }, { key: 'check_in', label: 'In', render: (r) => String(r.check_in || '—').slice(11, 16) },
              { key: 'check_out', label: 'Out', render: (r) => String(r.check_out || '—').slice(11, 16) },
              { key: 'worked_hours', label: 'Worked', align: 'right', render: (r) => Number(r.worked_hours || 0).toFixed(2) },
              { key: 'overtime_hours', label: 'OT', align: 'right', render: (r) => num(r.overtime_hours) },
              { key: 'status', label: 'Status', render: (r) => <StatusChip value={r.status} /> },
            ]} />}
            {tab === 'timeoff' && <SubList loader={() => employees.timeOff(id, { limit: 15 })} columns={[
              { key: 'type', label: 'Type', render: (r) => r.type || r.leave_type }, { key: 'start_date', label: 'From', render: (r) => date(r.start_date) },
              { key: 'end_date', label: 'To', render: (r) => date(r.end_date) }, { key: 'approved_days', label: 'Days', align: 'right', render: (r) => num(r.approved_days ?? r.duration) },
              { key: 'status', label: 'Status', render: (r) => <StatusChip value={r.status} /> },
            ]} />}
            {tab === 'payslips' && <SubList loader={() => employees.payslips(id, { limit: 24 })} columns={[
              { key: 'period_key', label: 'Period', render: (r) => <Link className="link" to={'/payslips/' + r.id}>{periodLabel(r.period_key)}</Link> },
              { key: 'payslip_kind', label: 'Kind' }, { key: 'gross_amount', label: 'Gross', align: 'right', render: (r) => inr(r.gross_amount) },
              { key: 'total_deductions', label: 'Deductions', align: 'right', render: (r) => inr(r.total_deductions) },
              { key: 'net_amount', label: 'Net', align: 'right', render: (r) => inr(r.net_amount) },
              { key: 'status', label: 'Status', render: (r) => <StatusChip value={r.status} /> },
            ]} />}
            {tab === 'login' && (
              <div className="text-sm text-slate-300">
                {emp.user_id ? (
                  <>
                    <p>Portal login: <span className="text-slate-100">{emp.work_email}</span> · role {emp.user_role || '—'} <StatusChip value={emp.user_active ? 'ACTIVE' : 'INACTIVE'} /></p>
                    <p className="mt-2 text-xs text-slate-500">Managed on the User Access screen — password resets happen there, never here.</p>
                    <Link to="/users" className="btn-ghost btn-sm mt-3 inline-flex">Open User Access</Link>
                  </>
                ) : <p className="text-slate-400">No login is linked to this employee. Create one from User Access, or edit the employee and tick “also create a portal login”.</p>}
              </div>
            )}
          </div>
        </Panel>

        <div className="space-y-4">
          <Panel title="This month" subtitle="what payroll will see if a run is created now">
            <KeyValue columns={1} rows={[
              { label: 'Attendance days', value: num(counts?.attendance_this_month ?? emp?.attendance_this_month ?? 0) },
              { label: 'Leave balance (days)', value: num(counts?.leave_balance ?? 0) },
              { label: 'Payslips paid', value: num(counts?.payslips_paid) },
              { label: 'Payslips current', value: num(counts?.payslips_current) },
              { label: 'Pending requests', value: num(counts?.time_off_pending) },
            ]} />
            {toRows(counts?.balances).length > 0 && (
              <div className="mt-3 space-y-1.5">
                <p className="label">Leave balances</p>
                {toRows(counts.balances).map((b) => (
                  <div key={b.type} className="flex items-center justify-between rounded-lg bg-ink-850/70 px-2.5 py-1.5 text-xs">
                    <span className="text-slate-300">{b.type}</span>
                    <span className="text-slate-400">{b.taken} taken · <span className="text-slate-100">{b.remaining} left</span> of {b.allocated}</span>
                  </div>
                ))}
              </div>
            )}
          </Panel>
          <Panel title="Contract in force">
            <KeyValue columns={1} rows={[
              { label: 'Wage', value: inr(emp.contract_wage) }, { label: 'Structure', value: emp.salary_structure },
              { label: 'Starts', value: date(emp.contract_start) }, { label: 'Ends', value: date(emp.contract_end) },
              { label: 'Status', value: emp.contract_status, render: (v) => <StatusChip value={v} /> },
            ]} />
          </Panel>
        </div>
      </div>

      <Modal open={editOpen} onClose={() => setEditOpen(false)} title={'Edit ' + emp.name} width="max-w-3xl"
             footer={<><button className="btn-ghost" onClick={() => setEditOpen(false)}>Cancel</button>
                      <button className="btn-primary" onClick={saveEdit} disabled={!!busy}>{busy === 'edit' ? 'Saving…' : 'Save changes'}</button></>}>
        <SchemaForm fields={EDIT_FIELDS} values={values} onChange={(k, v) => setValues((s) => ({ ...s, [k]: v }))} />
      </Modal>

      <Modal open={exitOpen} onClose={() => setExitOpen(false)} title="Terminate employment" width="max-w-md"
             subtitle="History is kept: payslips, attendance and leave all stay queryable. This is not a delete."
             footer={<><button className="btn-ghost" onClick={() => setExitOpen(false)}>Cancel</button>
                      <button className="btn-danger" onClick={terminate} disabled={!!busy}>{busy === 'exit' ? 'Working…' : 'Terminate'}</button></>}>
        <div className="flex flex-col gap-3">
          <Field label="Last working day" required><Input type="date" value={exit.date_of_exit} onChange={(v) => setExit((s) => ({ ...s, date_of_exit: v }))} /></Field>
          <Field label="Reason" hint="Goes on the employee record and the audit log."><Textarea value={exit.reason} onChange={(v) => setExit((s) => ({ ...s, reason: v }))} /></Field>
        </div>
      </Modal>
    </>
  );
}

const EDIT_FIELDS = [
  { key: 'name', label: 'Full name', required: true },
  { key: 'work_email', label: 'Work email', required: true },
  { key: 'phone', label: 'Phone' },
  { key: 'job_position', label: 'Job position' },
  { key: 'department_id', label: 'Department id', hint: 'Paste the id, or use the employee list action for a picker.' },
  { key: 'employee_type', label: 'Employment type', type: 'select', options: ['FULL_TIME', 'PART_TIME', 'CONTRACT', 'INTERN'].map((v) => ({ value: v, label: v.replace('_', ' ') })) },
  { key: 'status', label: 'Status', type: 'select', options: ['ACTIVE', 'ON_LEAVE', 'SUSPENDED', 'TERMINATED'].map((v) => ({ value: v, label: v.replace('_', ' ') })) },
  { key: 'date_of_joining', label: 'Date of joining', type: 'date' },
  { key: 'work_location', label: 'Work location' },
  { key: 'basic_salary', label: 'Basic salary', type: 'money' },
  { key: 'bank_account_number', label: 'Bank account' },
  { key: 'bank_ifsc', label: 'IFSC' },
  { key: 'bank_name', label: 'Bank name' },
  { key: 'pan_number', label: 'PAN' },
  { key: 'uan_number', label: 'UAN' },
  { key: 'esi_number', label: 'ESIC number' },
];

function hintFor(key, counts) {
  if (key === 'contracts') return (counts?.running_contracts || 0) + ' running';
  if (key === 'attendance') return 'this month';
  if (key === 'timeoff') return (counts?.time_off_pending || 0) + ' awaiting action';
  return (counts?.payslips_paid || 0) + ' paid';
}

/** A tab that loads its own rows — keeps the detail page one request per tab, not one giant payload. */
function SubList({ loader, columns }) {
  const { data, loading, error, reload } = useApi(loader, []);
  const rows = Array.isArray(data) ? data : data?.rows || [];
  if (loading) return <p className="py-6 text-sm text-slate-500">Loading…</p>;
  if (error) return <ErrorPanel error={error} onRetry={reload} />;
  return <DataTable columns={columns} rows={rows} empty={<p className="py-6 text-sm text-slate-500">Nothing recorded yet.</p>} />;
}
