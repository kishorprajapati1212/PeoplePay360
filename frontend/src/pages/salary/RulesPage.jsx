import { useCallback, useMemo, useState } from 'react';
import { salary } from '../../api/endpoints.js';
import { CrudPage } from '../../components/crud/CrudPage.jsx';
import { useApi, useAction } from '../../hooks/useApi.js';
import { Panel } from '../../components/ui/Panel.jsx';
import { Modal } from '../../components/ui/Modal.jsx';
import { Field, Input } from '../../components/ui/controls.jsx';
import { StatusChip } from '../../components/ui/StatusChip.jsx';
import { useToast } from '../../components/ui/Toast.jsx';
import { useCan } from '../../rbac/Can.jsx';
import { inr } from '../../utils/format.js';
import { toRows, totalOf } from '../../utils/query.js';

/**
 * The salary rules library. A rule is one line on the payslip: what it is called, whether it is an
 * earning or a deduction, how it is computed (fixed / % of another line / formula) and where it shows.
 *
 * Formulas run in the sandboxed parser in backend/src/lib/formula — no eval, no function calls, only
 * the variables the engine exposes. The tester below calls the same code the payroll engine uses.
 */
export function RulesPage() {
  const toast = useToast();
  const mayWrite = useCan('salary:rule_write');
  const [structure, setStructure] = useState('');
  const [test, setTest] = useState({ formula: '', wage: 50000, days: 26 });
  const { run, busy } = useAction();
  const structures = useApi(useCallback(() => salary.structures.list({}), []), []);
  const options = useMemo(() => toRows(structures.data).map((s) => ({ value: s.id, label: s.name })), [structures.data]);

  async function validate() {
    await run('test', () => salary.rules.validate({ formula: test.formula, wage: Number(test.wage), days: Number(test.days) }))
      .then((out) => toast.success(out?.message || `Formula OK — result ${out?.value ?? out?.result ?? ''}`))
      .catch((e) => toast.error(e.message));
  }

  return (
    <>
      {mayWrite && (
        <Panel title="Formula tester" subtitle="Safe before you save: this runs the real evaluator with a sample wage." className="mb-4">
          <div className="grid items-end gap-3 sm:grid-cols-4">
            <Field label="Formula" required className="sm:col-span-2">
              <Input value={test.formula} onChange={(v) => setTest({ ...test, formula: v })} placeholder="BASIC * 0.45" />
            </Field>
            <Field label="Wage"><Input type="number" value={test.wage} onChange={(v) => setTest({ ...test, wage: v })} /></Field>
            <div className="flex items-end gap-2">
              <Field label="Days"><Input type="number" value={test.days} onChange={(v) => setTest({ ...test, days: v })} /></Field>
              <button className="btn-primary btn-sm mb-0.5" onClick={validate} disabled={!!busy || !test.formula}>{busy === 'test' ? '…' : 'Test'}</button>
            </div>
          </div>
        </Panel>
      )}

      <CrudPage
        title="Salary rules"
        subtitle="Fixed amounts, percentages of another line, or a formula. Sequence decides the order the engine evaluates in."
        api={salary.rules}
        readPerm="salary:rule_read" writePerm="salary:rule_write" deletePerm="salary:rule_write"
        search={false}
        filters={[{ key: 'structure_id', label: 'All structures', options: options }]}
        columns={[
          { key: 'sequence', label: '#', width: 'w-12' },
          { key: 'name', label: 'Rule', render: (r) => (<div><p className="text-slate-100">{r.name}</p><p className="text-xs text-slate-500">{r.code} · {r.structure || 'shared'}</p></div>) },
          { key: 'category', label: 'Category', render: (r) => <StatusChip value={r.category} /> },
          { key: 'line_kind', label: 'Line', render: (r) => (r.line_kind === 'EARNING' ? <span className="text-emerald-300">earning</span> : r.line_kind === 'DEDUCTION' ? <span className="text-red-300">deduction</span> : <span className="text-slate-400">{String(r.line_kind).toLowerCase()}</span>) },
          { key: 'computation_type', label: 'Computation', render: (r) => (r.computation_type === 'FIXED' ? `fixed ${inr(r.amount)}` : r.computation_type === 'PERCENTAGE' ? `${r.percentage}% of ${r.base_code || 'BASIC'}` : <code className="text-xs text-amber-200">{r.formula}</code>) },
          { key: 'evaluation_period', label: 'Period', render: (r) => String(r.evaluation_period || 'PERIOD').toLowerCase().replace('_', ' ') },
          { key: 'pro_rata', label: 'Pro-rata', render: (r) => (r.pro_rata ? 'yes' : 'no') },
          { key: 'appears_on_payslip', label: 'On slip', render: (r) => (r.appears_on_payslip ? 'yes' : '—') },
        ]}
        makeExtra={() => ({ salary_structure_id: structure })}
        actions={
          <select className="input w-48 py-1.5 text-xs" value={structure} onChange={(e) => setStructure(e.target.value)}>
            <option value="">Filter: all structures</option>
            {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        }
        fields={[
          { key: 'name', label: 'Rule name', required: true, placeholder: 'House Rent Allowance' },
          { key: 'code', label: 'Code', required: true, placeholder: 'HRA' },
          { key: 'salary_structure_id', label: 'Structure', type: 'select', options, required: true },
          { key: 'category', label: 'Category', type: 'select', required: true, options: ['BASIC', 'ALLOWANCE', 'REIMBURSEMENT', 'DEDUCTION', 'GROSS', 'NET'].map((v) => ({ value: v, label: v.charAt(0) + v.slice(1).toLowerCase() })) },
          { key: 'line_kind', label: 'Line kind', type: 'select', options: ['EARNING', 'DEDUCTION', 'ADJUSTMENT', 'REPORT'].map((v) => ({ value: v, label: v.charAt(0) + v.slice(1).toLowerCase() })) },
          { key: 'sequence', label: 'Sequence', type: 'number', hint: 'Lower is evaluated first. Totals (GROSS, NET) come last.' },
          { key: 'computation_type', label: 'Computation', type: 'select', options: [{ value: 'FIXED', label: 'Fixed amount' }, { value: 'PERCENTAGE', label: 'Percentage of a line' }, { value: 'FORMULA', label: 'Formula' }] },
          { key: 'amount', label: 'Amount', type: 'money', hint: 'Fixed rules only.' },
          { key: 'percentage', label: 'Percentage', type: 'number', hint: 'Percentage rules: 40 means 40%.' },
          { key: 'base_code', label: 'Base line code', placeholder: 'BASIC', hint: 'What the percentage or cap is measured against.' },
          { key: 'formula', label: 'Formula', type: 'textarea', rows: 2, placeholder: 'min(BASIC * 0.5, 5000)', hint: 'Variables: BASIC, GROSS, HRA, days, expected_days, wage, plus any rule code.' },
          { key: 'cap_amount', label: 'Cap per period', type: 'money', hint: 'e.g. PF employer capped at ₹1,500' },
          { key: 'annual_cap', label: 'Cap per year', type: 'money' },
          { key: 'condition_expr', label: 'Apply only when', placeholder: 'days >= 15', hint: 'Optional formula that must be true for the rule to fire.' },
          { key: 'evaluation_period', label: 'Evaluation window', type: 'select', options: ['PERIOD', 'MONTH', 'MONTH_ONCE', 'FISCAL_YEAR'].map((v) => ({ value: v, label: v.replace('_', ' ').toLowerCase() })),
            hint: 'Month / fiscal year is the window the caps below are measured against. "month once" charges the rule on the first slip of the calendar month only — what a half-month run needs so a monthly amount is not paid twice.' },
          { key: 'rounding_mode', label: 'Rounding', type: 'select', options: [{ value: 'half_up', label: 'Exact (paise, half up)' }, { value: 'down', label: 'Down to the rupee' }, { value: 'up', label: 'Up to the rupee' }],
            hint: 'Down/up floor or ceiling this line to a whole rupee; exact keeps every paisa and lets "Round net to rupee" in company settings do the rounding.' },
          { key: 'pro_rata', label: 'Pro-rata', type: 'checkbox', checkboxLabel: 'Scale by days worked in the period' },
          { key: 'is_taxable', label: 'Taxable', type: 'checkbox', checkboxLabel: 'Counted in taxable gross', hint: 'Turn off for reimbursements and exemptions — the payslip and its PDF then report a lower taxable gross.' },
          { key: 'statutory', label: 'Statutory', type: 'checkbox', checkboxLabel: 'PF / ESI / PT / LWF' },
          { key: 'appears_on_payslip', label: 'Print on payslip', type: 'checkbox' },
          { key: 'is_report_only', label: 'Report only', type: 'checkbox', checkboxLabel: 'Shown in registers, not on the slip' },
          { key: 'active_from', label: 'Active from', type: 'date' },
          { key: 'active_to', label: 'Active to', type: 'date' },
          { key: 'notes', label: 'Notes', type: 'textarea', rows: 2 },
        ]}
      />
    </>
  );
}
