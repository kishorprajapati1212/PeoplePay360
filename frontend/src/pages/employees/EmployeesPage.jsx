import { useCallback, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { employees, org, salary } from '../../api/endpoints.js';
import { useApi, useAction } from '../../hooks/useApi.js';
import { useTable } from '../../hooks/useTable.js';
import { DataTable } from '../../components/data/DataTable.jsx';
import { Panel } from '../../components/ui/Panel.jsx';
import { PageHeader } from '../../layout/PageHeader.jsx';
import { StatusChip } from '../../components/ui/StatusChip.jsx';
import { EmptyState } from '../../components/ui/Feedback.jsx';
import { SearchInput, Select } from '../../components/ui/controls.jsx';
import { useToast } from '../../components/ui/Toast.jsx';
import { useCan } from '../../rbac/Can.jsx';
import { inr, num, date } from '../../utils/format.js';
import { EmployeeFormModal } from './EmployeeFormModal.jsx';
import { toRows, totalOf } from '../../utils/query.js';

/** Directory list from the mockup: search, two filters, a row per person, "+ New employee". */
export function EmployeesPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const mayCreate = useCan('employee:create');
  const mayEdit = useCan('employee:write');
  const [open, setOpen] = useState(false);
  const table = useTable({});

  const load = useCallback(() => employees.list(table.params), [table.params]);
  const { data, loading, error, reload } = useApi(load, [load]);
  const options = useApi(useCallback(() => Promise.all([org.departments.list({}), org.schedules.list({}), salary.structures.list({})]), []), []);

  const rows = toRows(data);
  const [deptOptions, scheduleOptions, structureOptions] = useMemo(() => {
    const [d = [], s = [], x = []] = options.data || [];
    const asOption = (o) => ({ value: o.id, label: o.name });
    return [toRows(d).map(asOption), toRows(s).map(asOption), toRows(x).map(asOption)];
  }, [options.data]);

  return (
    <>
      <PageHeader title="Employees" subtitle="Everyone on the roster. Click a row for the full record — profile, contract, attendance, leave and payslips."
                  actions={mayCreate && <button className="btn-primary btn-sm" onClick={() => setOpen(true)}>+ New employee</button>} />

      <Panel pad={false}>
        <DataTable
          rows={rows} loading={loading} error={error} onRetry={reload}
          onRowClick={(row) => navigate('/employees/' + row.id)}
          columns={[
            { key: 'employee_code', label: 'Code' },
            { key: 'name', label: 'Employee', render: (r) => (
                <div className="flex items-center gap-2">
                  <span className="grid h-7 w-7 place-items-center rounded-full bg-ink-700 text-[11px] font-semibold text-slate-200">{initialsOf(r.name)}</span>
                  <span>
                    <span className="block text-slate-100">{r.name}</span>
                    <span className="block text-xs text-slate-500">{r.work_email}</span>
                  </span>
                </div>) },
            { key: 'job_position', label: 'Job / department', render: (r) => (
                <span><span className="block">{r.job_position || '—'}</span><span className="block text-xs text-slate-500">{r.department || 'no department'}</span></span>) },
            { key: 'employee_type', label: 'Type', render: (r) => <StatusChip value={r.employee_type} tone="info" /> },
            { key: 'status', label: 'Status', render: (r) => <StatusChip value={r.status} /> },
            { key: 'date_of_joining', label: 'Joined', render: (r) => date(r.date_of_joining) },
            { key: 'contract_wage', label: 'Wage', align: 'right', render: (r) => inr(r.contract_wage ?? r.basic_salary) },
            { key: 'payslip_count', label: 'Slips', align: 'right', render: (r) => num(r.payslip_count) },
            { key: '_a', label: '', width: 'w-24', align: 'right', render: (r) => (mayEdit
                ? <Link className="btn-ghost btn-sm" to={'/employees/' + r.id + '?edit=1'} onClick={(e) => e.stopPropagation()}>Edit</Link>
                : null) },
            { key: 'flags', label: '', render: (r) => (r.missing_bank || r.missing_schedule
                ? <span className="chip border-amber-500/30 bg-amber-500/10 text-amber-300">{[r.missing_bank && 'no bank', r.missing_schedule && 'no schedule'].filter(Boolean).join(' · ')}</span> : null) },
          ]}
          toolbar={<>
            <SearchInput value={table.term} onChange={table.onSearch} placeholder="Name, code or email…" />
            <Select className="w-44" value={table.query.department_id || ''} onChange={(v) => table.onFilter('department_id', v)} options={deptOptions} placeholder="All departments" />
            <Select className="w-36" value={table.query.status || ''} onChange={(v) => table.onFilter('status', v)}
                    options={[{ value: 'ACTIVE', label: 'Active' }, { value: 'ON_LEAVE', label: 'On leave' }, { value: 'TERMINATED', label: 'Terminated' }, { value: 'SUSPENDED', label: 'Suspended' }]} placeholder="Any status" />
            <Select className="w-36" value={table.query.employee_type || ''} onChange={(v) => table.onFilter('employee_type', v)}
                    options={[{ value: 'FULL_TIME', label: 'Full time' }, { value: 'PART_TIME', label: 'Part time' }, { value: 'CONTRACT', label: 'Contract' }, { value: 'INTERN', label: 'Intern' }]} placeholder="Any type" />
            <span className="ml-auto text-xs text-slate-500">{num(data?.total || 0)} people</span>
          </>}
          pagination={{ page: table.page, size: table.size, total: totalOf(data, toRows(data).length), onPage: table.setPage, onSize: table.setSize }}
          empty={<EmptyState title="No employees match" hint="Clear the filters, or add the first employee. A new employee can get a login in the same dialog." />}
        />
      </Panel>

      <EmployeeFormModal open={open} onClose={() => setOpen(false)} onSaved={() => { setOpen(false); reload(); toast.success('Employee created'); }}
                         departments={deptOptions} schedules={scheduleOptions} structures={structureOptions} />
    </>
  );
}

function initialsOf(name) {
  return String(name || '?').split(' ').slice(0, 2).map((w) => w[0]).join('').toUpperCase();
}
