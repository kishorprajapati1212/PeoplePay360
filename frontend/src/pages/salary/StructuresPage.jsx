import { useCallback, useState } from 'react';
import { salary } from '../../api/endpoints.js';
import { CrudPage } from '../../components/crud/CrudPage.jsx';
import { useApi } from '../../hooks/useApi.js';
import { Modal } from '../../components/ui/Modal.jsx';
import { Panel } from '../../components/ui/Panel.jsx';
import { DataTable } from '../../components/data/DataTable.jsx';
import { StatusChip } from '../../components/ui/StatusChip.jsx';
import { useToast } from '../../components/ui/Toast.jsx';
import { useCan } from '../../rbac/Can.jsx';
import { inr, num } from '../../utils/format.js';

/**
 * A salary structure is the ordered set of rules that turns one wage into a payslip.
 * Click a row to see the rules in the order they are evaluated — that is what the mockup's
 * "Salary Structures / Regular Salary" screen shows, and what payroll actually follows.
 */
export function StructuresPage() {
  const toast = useToast();
  const mayWrite = useCan('salary:structure_write');
  const [open, setOpen] = useState(null);
  const detail = useApi(useCallback(() => (open ? salary.structures.one(open.id) : Promise.resolve(null)), [open]), [open]);
  const impact = useApi(useCallback(() => (open ? salary.structures.impact(open.id).catch(() => null) : Promise.resolve(null)), [open]), [open]);
  const rows = detail.data?.rules || detail.data?.structure?.rules || [];

  return (
    <>
      <CrudPage
        title="Salary structures"
        subtitle="Rules grouped into a template you can assign to a contract. GROSS and NET lines are totals, not inputs."
        api={salary.structures}
        readPerm="salary:structure_read" writePerm="salary:structure_write" deletePerm="salary:structure_write"
        search={false}
        actions={<span className="text-xs text-slate-500">click a row for its rules</span>}
        columns={[
          { key: 'name', label: 'Structure', render: (r) => (<div><p className="text-slate-100">{r.name}</p><p className="text-xs text-slate-500">{r.description || 'no description'}</p></div>) },
          { key: 'code', label: 'Code' },
          { key: 'rules', label: 'Rules', align: 'right', render: (r) => num(r.rules ?? r.rule_count) },
          { key: 'employees', label: 'Assigned', align: 'right', render: (r) => num(r.employees ?? r.employee_count) },
          { key: 'payruns', label: 'Used in runs', align: 'right', render: (r) => num(r.payruns ?? r.payrun_count) },
          { key: 'monthly_wage', label: 'Monthly wage', align: 'right', render: (r) => (r.monthly_wage ? inr(r.monthly_wage) : '—') },
          { key: 'is_active', label: 'Status', render: (r) => <StatusChip value={String(r.is_active) === 'false' || r.is_active === false ? 'INACTIVE' : 'ACTIVE'} /> },
        ]}
        fields={[
          { key: 'name', label: 'Name', required: true, placeholder: 'Regular Salary' },
          { key: 'code', label: 'Code', placeholder: 'REG' },
          { key: 'is_active', label: 'Status', type: 'select', options: [{ value: 'ACTIVE', label: 'Active' }, { value: 'INACTIVE', label: 'Inactive' }] },
          { key: 'description', label: 'Description', type: 'textarea', rows: 2 },
        ]}
        toBody={(v) => ({ name: v.name, code: v.code || undefined, description: v.description || undefined, is_active: v.is_active || 'ACTIVE' })}
      />

      <Modal open={!!open} onClose={() => setOpen(null)} width="max-w-4xl"
             title={open?.name} subtitle={impact.data ? `${num(impact.data.employees ?? impact.data.assigned ?? 0)} employees use this structure today` : 'Rules in evaluation order'}
             footer={<button className="btn-ghost" onClick={() => setOpen(null)}>Close</button>}>
        {detail.loading ? <p className="text-sm text-slate-400">Loading rules…</p> : (
          <>
            <DataTable rows={rows} columns={[
              { key: 'sequence', label: '#', width: 'w-12' },
              { key: 'name', label: 'Rule', render: (r) => (<div><p className="text-slate-100">{r.name}</p><p className="text-xs text-slate-500">{r.code}</p></div>) },
              { key: 'category', label: 'Category', render: (r) => <StatusChip value={r.category} tone={r.category === 'BASIC' ? 'info' : r.category === 'GROSS' || r.category === 'NET' ? 'warn' : undefined} /> },
              { key: 'line_kind', label: 'Line', render: (r) => (r.line_kind === 'EARNING' ? <span className="text-emerald-300">earning</span> : r.line_kind === 'DEDUCTION' ? <span className="text-red-300">deduction</span> : <span className="text-slate-400">{r.line_kind?.toLowerCase()}</span>) },
              { key: 'computation_type', label: 'How', render: (r) => (r.computation_type === 'FIXED' ? `fixed ${inr(r.amount)}` : r.computation_type === 'PERCENTAGE' ? `${r.percentage}% of ${r.base_code || 'basic'}` : <span title={r.formula}>formula</span>) },
              { key: 'pro_rata', label: 'Pro-rata', render: (r) => (r.pro_rata ? 'yes' : 'no') },
              { key: 'appears_on_payslip', label: 'On slip', render: (r) => (r.appears_on_payslip ? 'yes' : '—') },
              { key: 'statutory', label: 'Statutory', render: (r) => (r.statutory ? <span className="chip border-amber-500/30 bg-amber-500/10 text-amber-300">yes</span> : '—') },
            ]} empty={<p className="py-6 text-sm text-slate-500">No rules yet — add them on the Rules screen and point them at this structure.</p>} />
            <p className="mt-3 text-xs text-slate-500">
              {mayWrite ? 'Rule order and formulas are edited on ' : 'You can view but not change rules; they are edited on '}
              <span className="text-slate-300">Payroll › Rules</span>.
            </p>
          </>
        )}
      </Modal>
    </>
  );
}
