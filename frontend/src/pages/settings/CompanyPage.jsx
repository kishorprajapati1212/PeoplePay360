import { useCallback, useState } from 'react';
import { company } from '../../api/endpoints.js';
import { useApi, useAction } from '../../hooks/useApi.js';
import { PageHeader } from '../../layout/PageHeader.jsx';
import { Panel } from '../../components/ui/Panel.jsx';
import { Field, Input, Select, Textarea, Checkbox } from '../../components/ui/controls.jsx';
import { ErrorPanel } from '../../components/ui/Feedback.jsx';
import { useToast } from '../../components/ui/Toast.jsx';
import { useCan } from '../../rbac/Can.jsx';
import { inr } from '../../utils/format.js';

/**
 * Company settings — the switches that change how a payslip is computed for everyone.
 * These are deliberately boring form fields: this is the screen an auditor asks to see.
 */
export function CompanyPage() {
  const toast = useToast();
  const mayWrite = useCan('settings:write');
  const { data, loading, error, reload } = useApi(useCallback(() => company.get(), []), []);
  const [values, setValues] = useState(null);
  const { run, busy } = useAction();
  const form = values || data || {};

  async function save() {
    const body = Object.fromEntries(Object.entries(form).filter(([k]) => !['id', 'created_at', 'updated_at'].includes(k)));
    await run('save', () => company.update(body)).then(() => { setValues(null); toast.success('Settings saved — new computations pick them up immediately'); reload(); })
      .catch((e) => toast.error(e.message));
  }
  const set = (key, value) => setValues({ ...form, [key]: value });

  if (loading) return <Panel><p className="text-sm text-slate-400">Loading settings…</p></Panel>;
  if (error) return <ErrorPanel error={error} onRetry={reload} />;

  return (
    <>
      <PageHeader title="Company" subtitle="Identity, payroll conventions and statutory switches. One place, because every payslip inherits from here."
                  actions={mayWrite && <>
                    {values && <button className="btn-ghost btn-sm" onClick={() => setValues(null)}>Discard</button>}
                    <button className="btn-primary btn-sm" disabled={!values || !!busy} onClick={save}>{busy === 'save' ? 'Saving…' : 'Save settings'}</button>
                  </>} />

      <div className="grid gap-4 xl:grid-cols-2">
        <Panel title="Identity & payslip header">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Company name"><Input value={form.company_name} onChange={(v) => set('company_name', v)} /></Field>
            <Field label="Legal name"><Input value={form.legal_name} onChange={(v) => set('legal_name', v)} /></Field>
            <Field label="City"><Input value={form.city} onChange={(v) => set('city', v)} /></Field>
            <Field label="State"><Input value={form.state} onChange={(v) => set('state', v)} /></Field>
            <Field label="PIN code"><Input value={form.postal_code} onChange={(v) => set('postal_code', v)} /></Field>
            <Field label="Timezone"><Input value={form.timezone} onChange={(v) => set('timezone', v)} /></Field>
            <Field label="Address" className="sm:col-span-2"><Textarea rows={2} value={form.address} onChange={(v) => set('address', v)} /></Field>
            <Field label="Payslip footer" className="sm:col-span-2" hint="Printed at the bottom of every slip — usually the 'computer generated' line.">
              <Textarea rows={2} value={form.payslip_footer} onChange={(v) => set('payslip_footer', v)} />
            </Field>
            <Field label="Reply-to / sender mailbox" hint="Also where bounce notices land."><Input value={form.mail_from} onChange={(v) => set('mail_from', v)} /></Field>
            <Field label="Daily mail cap" hint="Keeps a bulk send under the provider limit (Gmail: 500/day)."><Input type="number" value={form.mail_daily_limit} onChange={(v) => set('mail_daily_limit', v)} /></Field>
          </div>
        </Panel>

        <Panel title="Payroll conventions">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Payroll day basis" hint="How a month is divided for pro-rata.">
              <Select value={form.payroll_day_basis} onChange={(v) => set('payroll_day_basis', v)}
                      options={[{ value: 'CALENDAR_DAYS', label: 'Calendar days' }, { value: 'WORKING_DAYS', label: 'Working days' }, { value: 'FIXED_26', label: 'Fixed 26 days' }, { value: 'FIXED_30', label: 'Fixed 30 days' }]} />
            </Field>
            <Field label="Hours per day"><Input type="number" step="0.5" value={form.default_hours_per_day} onChange={(v) => set('default_hours_per_day', v)} /></Field>
            <Field label="Overtime multiplier"><Input type="number" step="0.1" value={form.overtime_multiplier} onChange={(v) => set('overtime_multiplier', v)} /></Field>
            <Field label="Overtime round to" hint="e.g. 0.5 hour blocks"><Input type="number" step="0.25" value={form.overtime_round_to} onChange={(v) => set('overtime_round_to', v)} /></Field>
            <Field label="Minimum OT hours" hint="Shorter bits are not paid as OT"><Input type="number" step="0.25" value={form.overtime_min_hours} onChange={(v) => set('overtime_min_hours', v)} /></Field>
            <Field label="Fiscal year starts"><Select value={String(form.fiscal_year_start_month || '4')} onChange={(v) => set('fiscal_year_start_month', Number(v))}
                      options={Array.from({ length: 12 }, (_, i) => ({ value: String(i + 1), label: ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][i] }))} /></Field>
            <div className="sm:col-span-2 space-y-2">
              <Checkbox checked={!!form.round_net_to_rupee} onChange={(v) => set('round_net_to_rupee', v)} label="Round net pay to the whole rupee" />
              <Checkbox checked={!!form.sandwich_rule} onChange={(v) => set('sandwich_rule', v)} label="Apply the sandwich rule to leave" hint="Leave bridged by a holiday counts as full leave." />
              <Checkbox checked={!!form.allow_negative_net} onChange={(v) => set('allow_negative_net', v)} label="Allow a negative net (recovery exceeds pay)" hint="Off is safer: the slip then clamps at zero and the balance carries." />
              <Checkbox checked={!!form.pt_enabled} onChange={(v) => set('pt_enabled', v)} label="Professional tax enabled" />
            </div>
            <Field label="PT flat monthly" hint="Slabs override this where the state has them."><Input type="number" step="1" value={form.pt_monthly} onChange={(v) => set('pt_monthly', v)} /></Field>
            <Field label="PT annual cap"><Input type="number" step="1" value={form.pt_annual_cap} onChange={(v) => set('pt_annual_cap', v)} /></Field>
          </div>
        </Panel>

        <Panel title="Statutory deductions">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="sm:col-span-3 flex items-center gap-6">
              <Checkbox checked={!!form.pf_enabled} onChange={(v) => set('pf_enabled', v)} label="Provident fund" />
              <Checkbox checked={!!form.esi_enabled} onChange={(v) => set('esi_enabled', v)} label="ESI" />
            </div>
            <Field label="PF employee %" hint={inr(form.pf_wage_ceiling || 15000) + ' wage ceiling'}><Input type="number" step="0.5" value={form.pf_employee_pct} onChange={(v) => set('pf_employee_pct', v)} /></Field>
            <Field label="PF employer %"><Input type="number" step="0.5" value={form.pf_employer_pct} onChange={(v) => set('pf_employer_pct', v)} /></Field>
            <Field label="PF wage ceiling"><Input type="number" step="1" value={form.pf_wage_ceiling} onChange={(v) => set('pf_wage_ceiling', v)} /></Field>
            <Field label="ESI employee %"><Input type="number" step="0.01" value={form.esi_employee_pct} onChange={(v) => set('esi_employee_pct', v)} /></Field>
            <Field label="ESI employer %"><Input type="number" step="0.01" value={form.esi_employer_pct} onChange={(v) => set('esi_employer_pct', v)} /></Field>
            <Field label="ESI wage limit"><Input type="number" step="1" value={form.esi_wage_limit} onChange={(v) => set('esi_wage_limit', v)} /></Field>
            <Field label="Half-month advance %" hint="1st-half pays this share of the monthly net; 2nd half trues it up.">
              <Input type="number" step="1" value={form.advance_percentage} onChange={(v) => set('advance_percentage', v)} />
            </Field>
            <Field label="Document retention (years)"><Input type="number" value={form.document_retention_years} onChange={(v) => set('document_retention_years', v)} /></Field>
          </div>
        </Panel>

        <Panel title="What these values touch">
          <ul className="space-y-2 text-sm text-slate-400">
            {[
              'Day basis decides the pro-rata divisor when someone joins or leaves mid-month.',
              'PF ceiling is why a ₹60,000 basic still contributes 12% of ₹15,000.',
              'PT annual cap stops December charging tax twice.',
              'Half-month advance % is what makes 1st-half + 2nd-half equal one monthly net.',
              'Overtime rounding is applied per day, after the approved OT hours are summed.',
            ].map((line) => <li key={line} className="flex gap-2"><span className="text-brand-300">›</span>{line}</li>)}
          </ul>
        </Panel>
      </div>
    </>
  );
}
