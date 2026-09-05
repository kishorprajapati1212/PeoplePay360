import { useMemo, useState } from 'react';
import { employees } from '../../api/endpoints.js';
import { Modal } from '../../components/ui/Modal.jsx';
import { SchemaForm, emptyValues, fieldProblems } from '../../components/crud/schemaForm.jsx';
import { usePicklists, keepCurrentValue } from '../../utils/picklists.js';
import { Tabs } from '../../components/ui/Tabs.jsx';
import { Checkbox } from '../../components/ui/controls.jsx';
import { today } from '../../utils/format.js';

/**
 * Creating a person here creates the payroll record too: employee + running contract (+ login) in one
 * POST, because the API accepts all three in a single body and refuses a half-made employee.
 */
const PERSONAL = [
  { key: 'name', label: 'Full name', required: true, placeholder: 'Aarav Mehta' },
  { key: 'work_email', label: 'Work email', required: true, pattern: 'email', hint: 'Also the sign-in name for the portal.' },
  { key: 'phone', label: 'Phone', type: 'phone', hint: '10 digits — no +91, no spaces.' },
  { key: 'date_of_birth', label: 'Date of birth', type: 'date' },
  { key: 'gender', label: 'Gender', type: 'select', placeholder: 'Choose…', options: ['MALE', 'FEMALE', 'OTHER'].map((v) => ({ value: v, label: v })) },
  { key: 'address', label: 'Address', type: 'textarea', rows: 2, placeholder: 'Flat, street, area' },
  { key: 'city', label: 'City', placeholder: 'Ahmedabad' },
  // A payroll app that lets you type "guj" and "Gujarat" gets two Professional Tax rules for one person,
  // so the state is chosen from the list the API publishes rather than typed.
  { key: 'state', label: 'State', type: 'select', placeholder: 'Choose a state' },
  { key: 'pincode', label: 'Pincode', pattern: 'pincode' },
];
const JOB = [
  { key: 'date_of_joining', label: 'Date of joining', type: 'date', required: true },
  { key: 'job_position', label: 'Job position', placeholder: 'Senior Backend Engineer' },
  { key: 'department_id', label: 'Department', type: 'select', options: [] },
  { key: 'employee_type', label: 'Employment type', type: 'select', options: ['FULL_TIME', 'PART_TIME', 'CONTRACT', 'INTERN'].map((v) => ({ value: v, label: v.replace('_', ' ') })) },
  { key: 'work_location', label: 'Work location', placeholder: 'Ahmedabad HQ' },
  { key: 'working_schedule_id', label: 'Working schedule', type: 'select', options: [] },
  { key: 'status', label: 'Status', type: 'select', options: ['ACTIVE', 'ON_LEAVE', 'SUSPENDED'].map((v) => ({ value: v, label: v.replace('_', ' ') })) },
];
const SALARY = [
  { key: 'basic_salary', label: 'Basic salary (monthly)', type: 'money', required: true, min: 0, max: 99999999, step: '0.01', unit: '₹', placeholder: '85000', hint: 'Contract wage starts here; allowances come from the salary structure.' },
  { key: 'contract.start_date', label: 'Contract starts', type: 'date' },
  { key: 'contract.end_date', label: 'Contract ends', type: 'date', hint: 'Leave blank for an open-ended contract.' },
  { key: 'salary_structure_id', label: 'Salary structure', type: 'select', options: [] },
  { key: 'bank_account_number', label: 'Bank account', pattern: 'bank_account', hint: 'Needed before a salary can be paid — the payslip shows it masked.' },
  { key: 'bank_ifsc', label: 'IFSC', pattern: 'ifsc' },
  { key: 'bank_name', label: 'Bank name', placeholder: 'HDFC Bank' },
  { key: 'pan_number', label: 'PAN', pattern: 'pan' },
  { key: 'uan_number', label: 'UAN (PF)', pattern: 'uan' },
  { key: 'esi_number', label: 'ESIC IP number', pattern: 'esic' },
];

export function EmployeeFormModal({ open, onClose, onSaved, departments = [], schedules = [], structures = [] }) {
  const [tab, setTab] = useState('personal');
  const [values, setValues] = useState(null);
  const [withLogin, setWithLogin] = useState(true);
  const [password, setPassword] = useState('Password@123');
  const [role, setRole] = useState('EMPLOYEE');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState({});
  const { states, loading: statesLoading, error: statesError } = usePicklists();

  const fields = useMemo(() => {
    const byTab = { personal: PERSONAL, job: JOB, salary: SALARY }[tab];
    return byTab.map((f) => (f.key === 'department_id' ? { ...f, options: departments }
      : f.key === 'working_schedule_id' ? { ...f, options: schedules }
      : f.key === 'salary_structure_id' ? { ...f, options: structures }
      // The state list is the server's; a value recorded before the dropdown existed stays visible and
      // is labelled as such instead of silently turning into "Choose a state".
      : f.key === 'state' ? { ...f, options: keepCurrentValue(states, values?.state), loading: statesLoading, error: statesError } : f));
  }, [tab, departments, schedules, structures, states, statesLoading, statesError, values]);

  const current = values || emptyValues([...PERSONAL, ...JOB, ...SALARY], { date_of_joining: today(), employee_type: 'FULL_TIME', status: 'ACTIVE', 'contract.start_date': today() });
  const setValue = (key, value) => setValues({ ...current, [key]: value });

  async function save() {
    const found = fieldProblems([...PERSONAL, ...JOB, ...SALARY], current);
    if (withLogin && String(password).length < 10) found.__pw = 'Use at least 10 characters — that is the rule the API enforces.';
    if (Object.keys(found).length) {
      setFieldErrors(found);
      const firstKey = Object.keys(found)[0];
      if (PERSONAL.some((f) => f.key === firstKey)) setTab('personal');
      else if (JOB.some((f) => f.key === firstKey)) setTab('job');
      setError(found.__pw || 'Fix the highlighted fields — the same rules the API applies, checked here first.');
      return;
    }
    setSaving(true); setError(''); setFieldErrors({});
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
      contract,
      ...(withLogin ? { user: { password, roles: [role] } } : {}),
    };
    try { await employees.create(body); onSaved?.(); }
    catch (e) { setError(e.message); setFieldErrors(e.fieldErrors || {}); }
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
      {/* The code is not asked for: employees, contracts and payslips are matched on it, so the database
          hands out the next free EMP00xx and this screen only shows it back afterwards. */}
      <p className="mt-3 text-xs text-slate-500">Employee code: the next free one (EMP00xx) is generated when you save.</p>
      <div className="mt-4">
        <SchemaForm fields={fields} values={current} onChange={setValue} errors={fieldErrors} />
      </div>
      {tab === 'salary' && (
        <div className="mt-4 rounded-lg border border-line bg-ink-850/60 p-3">
          <Checkbox checked={withLogin} onChange={setWithLogin} label="Also create a portal login"
                    hint="The employee can sign in with this work email straight away." />
          {withLogin && (
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <label><span className="label">Starting password</span>
                <input className="input mt-1" type="text" autoComplete="new-password" value={password} placeholder="10+ characters" onChange={(e) => setPassword(e.target.value)} />
                <span className={'mt-1 block text-xs ' + (String(password).length < 10 ? 'text-amber-300' : 'text-slate-500')}>
                  {String(password).length < 10 ? `${String(password).length}/10 characters — the API refuses anything shorter` : 'Give this to the employee out of band; they can change it after signing in.'}
                </span>
              </label>
              <label><span className="label">Role</span>
                <select className="input mt-1" value={role} onChange={(e) => setRole(e.target.value)}>
                  {['EMPLOYEE', 'HR_MANAGER', 'HR_PAYROLL_USER', 'HR_PAYROLL_MANAGER', 'ADMIN'].map((r) => <option key={r}>{r}</option>)}
                </select>
              </label>
            </div>
          )}
        </div>
      )}
      {error && (
        <p className="mt-3 rounded-lg border border-bad/40 bg-red-950/40 px-3 py-2 text-sm text-red-200">{error}</p>
      )}
    </Modal>
  );
}
