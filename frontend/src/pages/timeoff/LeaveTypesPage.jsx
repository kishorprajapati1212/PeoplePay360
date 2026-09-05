import { timeOff } from '../../api/endpoints.js';
import { useNavigate } from 'react-router-dom';
import { CrudPage } from '../../components/crud/CrudPage.jsx';
import { StatusChip } from '../../components/ui/StatusChip.jsx';
import { num } from '../../utils/format.js';
import { usePicklists } from '../../utils/picklists.js';

/**
 * "Time Off Types" from the mockup — the configuration that drives everything else: whether a type
 * needs an allocation, whether it is paid, the approval route, the sandwich rule, and the payslip code
 * that appears as a deduction when leave is unpaid.
 */
export function LeaveTypesPage() {
  const navigate = useNavigate();
  const { leaveCategories, loading, error } = usePicklists();
  // The mockup's "payoff category" question, in two halves: which family a type belongs to (Casual, Sick,
  // Maternity…) and whether a day of it costs money. Both are also filters, because the question is nearly
  // always asked of a list — "show me the paid casual types".
  const categoryOptions = leaveCategories.map((c) => ({ value: c.value, label: c.label }));
  return (
    <CrudPage
      title="Time off types"
      subtitle="A type is a policy, not just a name: allocation requirement, pay effect, notice period and the payslip line it creates."
      api={timeOff.types}
      readPerm="timeoff:type_read" writePerm="timeoff:type_write" deletePerm="timeoff:type_write"
      search={false}
      // The API stores ACTIVE/INACTIVE here and accepts ?include_inactive=true on the list, so a
      // switched-off type stays reachable instead of vanishing forever.
      active={{ field: 'is_active', on: 'ACTIVE', off: 'INACTIVE', includeInactive: true }}
      rowActions={[{
        key: 'assign', label: 'Assign balance', perm: 'timeoff:allocation_write', title: 'Grant this type to many employees at once',
        show: (row) => !!row.requires_allocation,
        onClick: (row) => navigate('/time-off/allocations?assign=' + row.id),
      }]}
      filters={[
        { key: 'category', label: 'Any category', options: categoryOptions },
        { key: 'pay', label: 'Paid or unpaid', options: [{ value: 'PAID', label: 'Paid leave' }, { value: 'UNPAID', label: 'Unpaid (loss of pay)' }] },
      ]}
      columns={[
        { key: 'name', label: 'Type', render: (r) => (<span className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: r.display_color || '#6366f1' }} />
            <span className="text-slate-100">{r.name}</span></span>) },
        { key: 'category', label: 'Category', render: (r) => (r.category ? humanCat(r.category) : <span className="text-xs text-slate-500">not set</span>) },
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
        // GET /api/meta publishes this list, and it is the same array timeOffTypeBody validates against, so
        // a category offered here can never be one the API would refuse.
        { key: 'category', label: 'Leave category', type: 'select', options: categoryOptions, loading, error,
          placeholder: 'Choose a category', hint: 'Groups the type in reports and in the picker employees use.' },
        { key: 'pay_treatment', label: 'Payoff category', type: 'select', default: 'PAID',
          read: (row) => (row.is_unpaid ? 'UNPAID' : 'PAID'),
          options: [{ value: 'PAID', label: 'Paid — no payslip line' }, { value: 'UNPAID', label: 'Unpaid — loss of pay on the slip' }],
          placeholder: 'Paid', hint: 'Unpaid writes is_unpaid and defaults the deduction code to LOP. Those two columns are what the engine reads.' },
        { key: 'code', label: 'Code', required: true, pattern: 'code', hint: 'UPPERCASE, 2-21 characters — used by imports and payslip codes.' },
        // The API accepts DAYS or HOURS only (timeOffTypeBody in backend/src/validators/hr.schema.js).
        // A "HALF DAYS" option used to sit here and fail with a validation error on save; half days are
        // chosen per request instead (the Morning/Afternoon switch on the request form).
        { key: 'unit', label: 'Unit', type: 'select', options: ['DAYS', 'HOURS'].map((v) => ({ value: v, label: v.toLowerCase() })) },
        { key: 'max_days_per_year', label: 'Maximum days per year', type: 'number', min: 0, max: 400, step: 1, unit: 'days', placeholder: '12', hint: 'Empty = no cap. Whole days only.' },
        { key: 'min_notice_days', label: 'Minimum notice', type: 'number', min: 0, max: 120, step: 1, unit: 'days', placeholder: '3', hint: 'A request inside this window is refused before anyone approves it.' },
        // Same two lists the server enum allows (approval_route NONE|MANAGER|HR|PAYROLL_OFFICER and
        // work_entry_type is free text up to 60 chars) — an option the API rejects must not be offered.
        { key: 'approval_route', label: 'Approval route', type: 'select', options: ['NONE', 'MANAGER', 'HR', 'PAYROLL_OFFICER'].map((v) => ({ value: v, label: v.toLowerCase() })) },
        { key: 'work_entry_type', label: 'Work entry', placeholder: 'LEAVE', hint: 'Free text, up to 60 characters — matches the attendance import mapping.' },
        { key: 'payslip_code', label: 'Payslip deduction code', pattern: 'code', hint: 'e.g. LOP — must exist as a salary rule to be applied.' },
        { key: 'display_color', label: 'Colour', type: 'text', pattern: 'hex_color' },
        { key: 'description', label: 'Description', type: 'textarea', rows: 2 },
        { key: 'requires_allocation', label: 'Requires a leave allocation', type: 'checkbox', checkboxLabel: 'Employees can only take it if they have a balance' },
        { key: 'is_encashable', label: 'Encashable', type: 'checkbox' },
        { key: 'carry_forward', label: 'Carry forward', type: 'checkbox', checkboxLabel: 'Unused days roll into next year' },
        { key: 'sandwich_rule', label: 'Sandwich rule', type: 'checkbox', checkboxLabel: 'Leave bridged by a holiday counts as full leave' },
      ]}
    />
  );
}

const humanCat = (c) => String(c).toLowerCase().replace(/_/g, ' ').replace(/\b\w/g, (x) => x.toUpperCase());
