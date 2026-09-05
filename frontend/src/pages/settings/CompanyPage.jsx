import { useCallback, useState } from 'react';
import { company } from '../../api/endpoints.js';
import { patternProblem } from '../../components/crud/schemaForm.jsx';
import { useApi, useAction } from '../../hooks/useApi.js';
import { PageHeader } from '../../layout/PageHeader.jsx';
import { Panel } from '../../components/ui/Panel.jsx';
import { Field, Input, Select, Textarea, Checkbox } from '../../components/ui/controls.jsx';
import { usePicklists, keepCurrentValue } from '../../utils/picklists.js';
import { ErrorPanel } from '../../components/ui/Feedback.jsx';
import { useToast } from '../../components/ui/Toast.jsx';
import { useCan } from '../../rbac/Can.jsx';

/**
 * Company settings — the switches that decide how every payslip in this company is computed.
 *
 * The list below is the whole screen: one row per setting, and each row says what the number is measured
 * in, what the API accepts, and what an example value means. `min`/`max`/`step` are the same numbers as
 * `companyBody` in backend/src/validators/payroll.schema.js, so a value this screen accepts is a value the
 * API accepts. If you add a setting here, add it there too — one line each side.
 */
const SETTINGS = {
  'Identity & payslip header': [
    { key: 'company_name', label: 'Company name', max: 120, placeholder: 'OXP Technologies' },
    { key: 'legal_name', label: 'Legal name', max: 120, placeholder: 'OXP Technologies Pvt Ltd' },
    { key: 'city', label: 'City', max: 80, placeholder: 'Ahmedabad' },
    { key: 'state', label: 'State', max: 80, type: 'select', placeholder: 'Choose a state' },
    { key: 'postal_code', label: 'PIN code', max: 20, pattern: 'pincode' },
    { key: 'country', label: 'Country', max: 60, placeholder: 'India' },
    { key: 'currency', label: 'Currency code', max: 10, placeholder: 'INR', hint: 'Written on the payslip header.' },
    { key: 'currency_symbol', label: 'Currency symbol', max: 6, placeholder: '₹' },
    { key: 'timezone', label: 'Timezone', max: 60, placeholder: 'Asia/Kolkata' },
    { key: 'address', label: 'Address', type: 'textarea', max: 300, full: true, placeholder: 'Street, building, city' },
    { key: 'payslip_footer', label: 'Payslip footer', type: 'textarea', max: 400, full: true, placeholder: 'This is a computer-generated payslip and needs no signature.', hint: 'Printed at the bottom of every slip.' },
    { key: 'mail_from', label: 'Reply-to / sender mailbox', max: 160, pattern: 'email', hint: 'Also where bounce notices land.' },
    { key: 'mail_daily_limit', label: 'Daily mail cap', unit: 'mails/day', type: 'number', min: 1, max: 100000, step: 1, integer: true, placeholder: '400', hint: 'Keeps a bulk send under the provider limit (Gmail: 500/day).' },
  ],
  'Payroll conventions': [
    { key: 'payroll_day_basis', label: 'Payroll day basis', type: 'select', full: true,
      options: [{ value: 'ACTUAL_WORKING_DAYS', label: 'Actual working days' }, { value: 'CALENDAR_DAYS', label: 'Calendar days' }, { value: 'FIXED_26', label: 'Fixed 26 days' }, { value: 'FIXED_30', label: 'Fixed 30 days' }],
      hint: 'How a month is divided when a salary is shared over the days — the divisor for pro-rata and for a day without pay.' },
    { key: 'fiscal_year_start_month', label: 'Fiscal year starts', type: 'select',
      options: Array.from({ length: 12 }, (_, i) => ({ value: String(i + 1), label: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][i] })) },
    { key: 'default_hours_per_day', label: 'Hours per day', unit: 'h', type: 'number', min: 1, max: 24, step: 0.5, placeholder: '8' },
    { key: 'overtime_multiplier', label: 'Overtime multiplier', unit: '× pay', type: 'number', min: 1, max: 4, step: 0.1, placeholder: '1.5' },
    { key: 'overtime_round_to', label: 'Overtime round to', unit: 'h', type: 'number', min: 0, max: 4, step: 0.25, placeholder: '0.5', hint: 'e.g. 0.5 → 12 minutes of OT pay nothing, 35 minutes pays half an hour.' },
    { key: 'overtime_min_hours', label: 'Minimum OT hours', unit: 'h', type: 'number', min: 0, max: 8, step: 0.25, placeholder: '0.5', hint: 'Shorter bits are not paid as OT.' },
    { key: 'round_net_to_rupee', label: 'Round net pay to the whole rupee', type: 'checkbox' },
    { key: 'sandwich_rule', label: 'Apply the sandwich rule to leave', type: 'checkbox', hint: 'Leave bridged by a holiday counts as full leave.' },
    { key: 'allow_negative_net', label: 'Allow a negative net (recovery exceeds pay)', type: 'checkbox', hint: 'Off is safer: the slip clamps at zero and the balance carries.' },
    { key: 'pt_enabled', label: 'Professional tax enabled', type: 'checkbox' },
    { key: 'pt_state', label: 'PT slab state', max: 60, type: 'select', placeholder: 'Same as the company state',
      hint: 'Which slab table to read; blank uses the company state. Only the states with a Professional Tax of their own are listed.' },
    { key: 'pt_charge_slice', label: 'Charge PT on', type: 'select', placeholder: 'The month (default)', options: [
      { value: 'MONTH', label: 'Once, on the monthly run' }, { value: 'HALF_FIRST', label: 'The 1st-half run only' }, { value: 'HALF_SECOND', label: 'The 2nd-half run only' }],
      hint: 'Half-month payroll otherwise charges the flat monthly PT twice.' },
    { key: 'pt_monthly', label: 'PT flat monthly', unit: '₹', type: 'number', min: 0, max: 9999999, step: 1, placeholder: '200', hint: 'Slabs override this where the state has them.' },
    { key: 'pt_annual_cap', label: 'PT annual cap', unit: '₹', type: 'number', min: 0, max: 9999999, step: 1, placeholder: '2500', hint: 'Stops December charging tax twice.' },
  ],
  'Statutory deductions': [
    { key: 'pf_enabled', label: 'Provident fund', type: 'checkbox' },
    { key: 'esi_enabled', label: 'ESI', type: 'checkbox' },
    { key: 'pf_employee_pct', label: 'PF employee', unit: '%', type: 'number', min: 0, max: 1000, step: 0.5, placeholder: '12' },
    { key: 'pf_employer_pct', label: 'PF employer', unit: '%', type: 'number', min: 0, max: 1000, step: 0.5, placeholder: '12' },
    { key: 'pf_wage_ceiling', label: 'PF wage ceiling', unit: '₹/month', type: 'number', min: 0, max: 9999999, step: 1, placeholder: '15000', hint: 'A ₹60,000 basic still contributes 12% of this.' },
    { key: 'esi_employee_pct', label: 'ESI employee', unit: '%', type: 'number', min: 0, max: 1000, step: 0.01, placeholder: '0.75' },
    { key: 'esi_employer_pct', label: 'ESI employer', unit: '%', type: 'number', min: 0, max: 1000, step: 0.01, placeholder: '3.25' },
    { key: 'esi_wage_limit', label: 'ESI wage limit', unit: '₹/month', type: 'number', min: 0, max: 9999999, step: 1, placeholder: '21000', hint: 'Above this wage, no ESI at all — the whole family is exempt.' },
    { key: 'advance_percentage', label: 'Half-month advance', unit: '% of monthly net', type: 'number', min: 1, max: 100, step: 1, placeholder: '50', hint: '1st half pays this share; 2nd half trues it up.' },
    { key: 'document_retention_years', label: 'Document retention', unit: 'years', type: 'number', min: 1, max: 40, step: 1, integer: true, placeholder: '7' },
  ],
};

const NUMERIC = new Set(Object.values(SETTINGS).flat().filter((f) => f.type === 'number').map((f) => f.key));

export function CompanyPage() {
  // States and the PT ones come from the API, so this dropdown and the validator cannot drift apart.
  const { states, ptStates, loading: statesLoading, error: statesError } = usePicklists();
  const toast = useToast();
  const mayWrite = useCan('settings:write');
  const { data, loading, error, reload } = useApi(useCallback(() => company.get(), []), []);
  const [values, setValues] = useState(null);
  const [problems, setProblems] = useState({});
  const { run, busy } = useAction();
  const form = values || data || {};

  const set = (key, value) => setValues({ ...form, [key]: value });

  /** One rule per number, checked before anything is sent. Returns { key: message }. */
  function check(f, raw) {
    // Formats first (PIN code, mailboxes): a value in the wrong shape is refused here rather than
    // landing back as a field error from the API.
    if (f.pattern) { const p = patternProblem(f.pattern, raw); if (p) return `${f.label}: ${p}`; }
    if (f.type !== 'number') return null;
    if (raw === '' || raw === null || raw === undefined) return null;   // blank means "leave the API's value alone"
    const n = Number(raw);
    if (!Number.isFinite(n)) return 'Enter a number';
    if (f.integer && !Number.isInteger(n)) return `Whole ${f.unit || 'numbers'} only`;
    if (n < f.min) return `${f.label} cannot be below ${f.min}${f.unit ? ' ' + f.unit : ''}`;
    if (n > f.max) return `${f.label} cannot be above ${f.max}${f.unit ? ' ' + f.unit : ''}`;
    return null;
  }

  async function save() {
    const found = {};
    for (const group of Object.values(SETTINGS)) for (const f of group) { const m = check(f, form[f.key]); if (m) found[f.key] = m; }
    setProblems(found);
    if (Object.keys(found).length) { toast.error('Fix the highlighted values first'); return; }
    // a blank box is not "set this to zero": empty values are dropped, so the API keeps what it has
    const body = Object.fromEntries(Object.entries(form)
      .filter(([k, v]) => !['id', 'created_at', 'updated_at'].includes(k))
      .filter(([, v]) => v !== '' && v !== null && v !== undefined));
    await run('save', () => company.update(body)).then(() => { setValues(null); toast.success('Settings saved — new computations pick them up immediately'); reload(); })
      .catch((e) => toast.error(e.message));
  }

  if (loading) return <Panel><p className="text-sm text-slate-400">Loading settings…</p></Panel>;
  if (error) return <ErrorPanel error={error} onRetry={reload} />;

  return (
    <>
      <PageHeader title="Company" subtitle="Identity, payroll conventions and statutory switches. One place, because every payslip inherits from here."
                  actions={mayWrite && <>
                    {values && <button className="btn-ghost btn-sm" onClick={() => { setValues(null); setProblems({}); }}>Discard</button>}
                    <button className="btn-primary btn-sm" disabled={!values || !!busy} onClick={save}>{busy === 'save' ? 'Saving…' : 'Save settings'}</button>
                  </>} />

      <div className="grid gap-4 xl:grid-cols-2">
        {Object.entries(SETTINGS).map(([title, fields]) => (
          <Panel key={title} title={title}>
            <div className="grid gap-3 sm:grid-cols-2">
              {fields.map((f) => f.type === 'checkbox' ? (
                <div key={f.key} className={f.full ? 'sm:col-span-2' : ''}>
                  <Checkbox checked={!!form[f.key]} onChange={(v) => set(f.key, v)} label={f.label} hint={f.hint} />
                </div>
              ) : (
                <Field key={f.key} label={f.label} hint={f.hint} error={problems[f.key]} className={f.full ? 'sm:col-span-2' : ''}>
                  {f.type === 'select'
                    ? <Select value={form[f.key] ?? ''} onChange={(v) => set(f.key, f.integer || f.key === 'fiscal_year_start_month' ? Number(v) : v)}
                              options={f.key === 'state' ? keepCurrentValue(states, form.state) : f.key === 'pt_state' ? ptStates : f.options}
                              loading={statesLoading} error={statesError} placeholder={f.placeholder || 'Not set'} />
                    : f.type === 'textarea'
                      ? <Textarea rows={2} value={form[f.key]} maxLength={f.max} onChange={(v) => set(f.key, v)} placeholder={f.placeholder} />
                      : (
                        <Input type={f.type === 'number' ? 'number' : 'text'} inputMode={f.type === 'number' ? 'decimal' : undefined}
                               value={form[f.key]} min={f.min} max={f.max} step={f.step} suffix={f.unit}
                               maxLength={f.type === 'number' ? 12 : f.max}
                               placeholder={f.placeholder} onChange={(v) => set(f.key, v)} />
                      )}
                </Field>
              ))}
            </div>
          </Panel>
        ))}

        <Panel title="What these values touch">
          <ul className="space-y-2 text-sm text-slate-400">
            {[
              'Day basis decides the pro-rata divisor when someone joins or leaves mid-month.',
              'PF ceiling is why a ₹60,000 basic still contributes 12% of ₹15,000.',
              'PT annual cap stops December charging tax twice.',
              'Half-month advance % is what makes 1st-half + 2nd-half equal one monthly net.',
              'Overtime rounding is applied per day, after the approved OT hours are summed.',
              'Every one of these is read at compute time, so a change affects the next run, never a paid one.',
            ].map((line) => <li key={line} className="flex gap-2"><span className="text-brand-300">›</span>{line}</li>)}
          </ul>
          <p className="mt-3 text-xs text-slate-500">
            Saved values are checked here and again by the API ({NUMERIC.size} numbers, each with the same
            range). A field left blank is left alone rather than zeroed.
          </p>
        </Panel>
      </div>
    </>
  );
}
