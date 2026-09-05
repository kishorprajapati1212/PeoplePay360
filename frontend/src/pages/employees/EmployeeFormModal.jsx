import { useMemo, useState } from 'react';
import { employees } from '../../api/endpoints.js';
import { Modal } from '../../components/ui/Modal.jsx';
import { SchemaForm, emptyValues } from '../../components/crud/schemaForm.jsx';
import { Tabs } from '../../components/ui/Tabs.jsx';
import { Checkbox } from '../../components/ui/controls.jsx';
import { today } from '../../utils/format.js';

/**
 * Creating a person here creates the payroll record too: employee + running contract (+ login) in one
 * POST, because the API accepts all three in a single body and refuses a half-made employee.
 */
const PERSONAL = [
  { key: 'name', label: 'Full name', required: true },
  { key: 'work_email', label: 'Work email', required: true, placeholder: 'name@company.com' },
  { key: 'phone', label: 'Phone' },
  { key: 'date_of_birth', label: 'Date of birth', type: 'date' },
  { key: 'gender', label: 'Gender', type: 'select', options: ['MALE', 'FEMALE', 'OTHER'].map((v) => ({ value: v, label: v })) },
  { key: 'employee_code', label: 'Employee code', hint: 'Left blank, the next EMP00xx is used.' },
  { key: 'address', label: 'Address', type: 'textarea', rows: 2 },
  { key: 'city', label: 'City' },
  { key: 'state', label: 'State' },
  { key: 'pincode', label: 'Pincode' },
];
const JOB = [
  { key: 'date_of_joining', label: 'Date of joining', type: 'date', required: true },
  { key: 'job_position', label: 'Job position' },
  { key: 'department_id', label: 'Department', type: 'select', options: [] },
  { key: 'employee_type', label: 'Employment type', type: 'select', options: ['FULL_TIME', 'PART_TIME', 'CONTRACT', 'INTERN'].map((v) => ({ value: v, label: v.replace('_', ' ') })) },
  { key: 'work_location', label: 'Work location' },
  { key: 'working_schedule_id', label: 'Working schedule', type: 'select', options: [] },
  { key: 'status', label: 'Status', type: 'select', options: ['ACTIVE', 'ON_LEAVE', 'SUSPENDED'].map((v) => ({ value: v, label: v.replace('_', ' ') })) },
];
const SALARY = [
  { key: 'basic_salary', label: 'Basic salary (monthly)', type: 'money', required: true, hint: 'Contract wage starts here; allowances come from the salary structure.' },
  { key: 'contract.start_date', label: 'Contract starts', type: 'date' },
  { key: 'contract.end_date', label: 'Contract ends', type: 'date', hint: 'Leave blank for an open-ended contract.' },
  { key: 'salary_structure_id', label: 'Salary structure', type: 'select', options: [] },
  { key: 'bank_account_number', label: 'Bank account' },
  { key: 'bank_ifsc', label: 'IFSC' },
  { key: 'bank_name', label: 'Bank name' },
  { key: 'pan_number', label: 'PAN' },
  { key: 'uan_number', label: 'UAN (PF)' },
  { key: 'esi_number', label: 'ESIPF number' },
];

export function EmployeeFormModal({ open, onClose, onSaved, departments = [], schedules = [], structures = [] }) {
  const [tab, setTab] = useState('personal');
  const [values, setValues] = useState(null);
  const [withLogin, setWithLogin] = useState(true);
  const [password, setPassword] = useState('Password@123');
  const [role, setRole] = useState('EMPLOYEE');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const fields = useMemo(() => {
    const byTab = { personal: PERSONAL, job: JOB, salary: SALARY }[tab];
    return byTab.map((f) => (f.key === 'department_id' ? { ...f, options: departments }
      : f.key === 'working_schedule_id' ? { ...f, options: schedules }
      : f.key === 'salary_structure_id' ? { ...f, options: structures } : f));
  }, [tab, departments, schedules, structures]);

  const current = values || emptyValues([...PERSONAL, ...JOB, ...SALARY], { date_of_joining: today(), employee_type: 'FULL_TIME', status: 'ACTIVE', 'contract.start_date': today() });
  const setValue = (key, value) => setValues({ ...current, [key]: value });

  async function save() {
    setSaving(true); setError(null);
    const contract = { wage: Number(current.basic_salary || 0), start_date: current['contract.start_date'] || current.date_of_joining };
    if (current['contract.end_date']) contract.end_date = current['contract.end_date'];
    if (current.salary_structure_id) contract.salary_structure_id = current.salary_structure_id;
    const body = {
      name: current.name, work_email: current.work_email, phone: current.phone || undefined, gender: current.gender || undefined,
      date_of_birth: current.date_of_birth || undefined, address: current.address || undefined, city: current.city || undefined,
      state: current.state || undefined, pincode: current.pincode || undefined, work_location: current.work_location || undefined,
      department_id: current.department_id || undefined, job_position: current.job_position || undefined,
      employee_type: current.employee_type || 'FULL_TIME', working_schedule_id: current.working_schedule_id || undefined,
      date_of_joining: current.date_of_joining, status: current.status || 'ACTIVE',
      basic_salary: Number(current.basic_salary || 0),
      bank_account_number: current.bank_account_number || undefined, bank_ifsc: current.bank_ifsc || undefined,
      bank_name: current.bank_name || undefined, pan_number: current.pan_number || undefined,
      uan_number: current.uan_number || undefined, esi_number: current.esi_number || undefined,
      employee_code: current.employee_code || undefined,
      contract,
      ...(withLogin ? { user: { password, roles: [role] } } : {}),
    };
    try { await employees.create(body); onSaved?.(); }
    catch (e) { setError(e.message); }
    finally { setSaving(false); }
  }

  return (
    <Modal open={open} onClose={() => { setValues(null); onClose(); }} width="max-w-3xl"
           title="New employee" subtitle="Three steps on one card: who they are, where they work, what they are paid."
           footer={<>
             {tab !== 'salary' ? <button className="btn-ghost" onClick={() => setTab(tab === 'personal' ? 'job' : 'salary')}>Next: {tab === 'personal' ? 'job' : 'salary'} →</button> : null}
             <button className="btn-ghost" onClick={() => { setValues(null); onClose(); }}>Cancel</button>
             <button className="btn-primary" onClick={save} disabled={saving}>{saving ? 'Creating…' : 'Create employee'}</button>
           </>}>
      <Tabs tabs={[{ key: 'personal', label: '1 · Personal' }, { key: 'job', label: '2 · Job & schedule' }, { key: 'salary', label: '3 · Salary, contract, bank' }]}
            active={tab} onChange={setTab} />
      <div className="mt-4">
        <SchemaForm fields={fields} values={current} onChange={setValue} />
      </div>
      {tab === 'salary' && (
        <div className="mt-4 rounded-lg border border-line bg-ink-850/60 p-3">
          <Checkbox checked={withLogin} onChange={setWithLogin} label="Also create a portal login"
                    hint="The employee can sign in with this work email straight away." />
          {withLogin && (
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <label><span className="label">Starting password</span><input className="input mt-1" value={password} onChange={(e) => setPassword(e.target.value)} /></label>
              <label><span className="label">Role</span>
                <select className="input mt-1" value={role} onChange={(e) => setRole(e.target.value)}>
                  {['EMPLOYEE', 'HR_MANAGER', 'HR_PAYROLL_USER', 'HR_PAYROLL_MANAGER', 'ADMIN'].map((r) => <option key={r}>{r}</option>)}
                </select>
              </label>
            </div>
          )}
        </div>
      )}
      {error && <p className="mt-3 rounded-lg border border-bad/40 bg-red-950/40 px-3 py-2 text-sm text-red-200">{error}</p>}
    </Modal>
  );
}
