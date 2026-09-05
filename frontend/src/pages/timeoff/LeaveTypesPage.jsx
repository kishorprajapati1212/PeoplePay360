import { timeOff } from '../../api/endpoints.js';
import { CrudPage } from '../../components/crud/CrudPage.jsx';
import { StatusChip } from '../../components/ui/StatusChip.jsx';
import { num } from '../../utils/format.js';

/**
 * "Time Off Types" from the mockup — the configuration that drives everything else: whether a type
 * needs an allocation, whether it is paid, the approval route, the sandwich rule, and the payslip code
 * that appears as a deduction when leave is unpaid.
 */
export function LeaveTypesPage() {
  return (
    <CrudPage
      title="Time off types"
      subtitle="A type is a policy, not just a name: allocation requirement, pay effect, notice period and the payslip line it creates."
      api={timeOff.types}
      readPerm="timeoff:type_read" writePerm="timeoff:type_write" deletePerm="timeoff:type_write"
      search={false}
      columns={[
        { key: 'name', label: 'Type', render: (r) => (<span className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: r.display_color || '#6366f1' }} />
            <span className="text-slate-100">{r.name}</span></span>) },
        { key: 'code', label: 'Code' },
        { key: 'unit', label: 'Unit' },
        { key: 'max_days_per_year', label: 'Cap / yr', align: 'right', render: (r) => (r.max_days_per_year ? num(r.max_days_per_year) : '—') },
        { key: 'requires_allocation', label: 'Needs balance', render: (r) => (r.requires_allocation ? 'Yes' : 'No') },
        { key: 'is_unpaid', label: 'Pay effect', render: (r) => (r.is_unpaid ? <span className="chip border-red-500/30 bg-red-500/10 text-red-300">unpaid</span> : <span className="text-xs text-slate-400">paid</span>) },
        { key: 'payslip_code', label: 'Payslip line', render: (r) => r.payslip_code || '—' },
        { key: 'approval_route', label: 'Approval', render: (r) => r.approval_route || 'manager' },
        { key: 'days_used', label: 'Used', align: 'right', render: (r) => num(r.days_used) },
        { key: 'is_active', label: 'Status', render: (r) => <StatusChip value={String(r.is_active) === 'false' || r.is_active === false ? 'INACTIVE' : 'ACTIVE'} /> },
      ]}
      fields={[
        { key: 'name', label: 'Name', required: true, placeholder: 'Sick Leave' },
        { key: 'code', label: 'Code', required: true, placeholder: 'SICK' },
        { key: 'unit', label: 'Unit', type: 'select', options: ['DAYS', 'HALF_DAYS', 'HOURS'].map((v) => ({ value: v, label: v.replace('_', ' ') })) },
        { key: 'max_days_per_year', label: 'Maximum days per year', type: 'number', hint: 'Empty = no cap.' },
        { key: 'min_notice_days', label: 'Minimum notice (days)', type: 'number' },
        { key: 'approval_route', label: 'Approval route', type: 'select', options: ['MANAGER', 'HR', 'MANAGER_THEN_HR'].map((v) => ({ value: v, label: v.replace('_THEN_', ' then ').toLowerCase() })) },
        { key: 'work_entry_type', label: 'Work entry', type: 'select', options: ['NONE', 'ATTENDANCE_100', 'LEAVE_UNPAID'].map((v) => ({ value: v, label: v.replace('_', ' ').toLowerCase() })) },
        { key: 'payslip_code', label: 'Payslip deduction code', hint: 'e.g. LOP — must exist as a salary rule to be applied.' },
        { key: 'display_color', label: 'Colour', type: 'text', placeholder: '#f59e0b' },
        { key: 'description', label: 'Description', type: 'textarea', rows: 2 },
        { key: 'requires_allocation', label: 'Requires a leave allocation', type: 'checkbox', checkboxLabel: 'Employees can only take it if they have a balance' },
        { key: 'is_unpaid', label: 'Unpaid', type: 'checkbox', checkboxLabel: 'Deducted from pay' },
        { key: 'is_encashable', label: 'Encashable', type: 'checkbox' },
        { key: 'carry_forward', label: 'Carry forward', type: 'checkbox', checkboxLabel: 'Unused days roll into next year' },
        { key: 'sandwich_rule', label: 'Sandwich rule', type: 'checkbox', checkboxLabel: 'Leave bridged by a holiday counts as full leave' },
      ]}
    />
  );
}
