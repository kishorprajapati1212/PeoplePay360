import { useCallback, useMemo, useState } from 'react';
import { org, employees } from '../../api/endpoints.js';
import { CrudPage } from '../../components/crud/CrudPage.jsx';
import { useApi } from '../../hooks/useApi.js';
import { StatusChip } from '../../components/ui/StatusChip.jsx';
import { inr, num } from '../../utils/format.js';

/** Departments from the mockup's org section: list + create/edit + safe delete (the API refuses if people are assigned). */
export function DepartmentsPage() {
  const people = useApi(useCallback(() => employees.list({ page: 1, page_size: 200 }), []), []);
  const options = useMemo(() => (people.data?.rows || []).map((e) => ({ value: e.id, label: e.name + ' · ' + e.employee_code })), [people.data]);

  return (
    <CrudPage
      title="Departments"
      subtitle="Who reports where. A department can have a parent and a manager — both are used by the org chart and by approval routing."
      api={org.departments}
      readPerm="department:read" writePerm="department:write" deletePerm="department:write"
      searchPlaceholder="Department name or code…"
      columns={[
        { key: 'name', label: 'Department' },
        { key: 'code', label: 'Code' },
        { key: 'parent', label: 'Parent', render: (r) => r.parent?.name || r.parent_name || '—' },
        { key: 'manager', label: 'Manager', render: (r) => r.manager?.name || r.manager_name || '—' },
        { key: 'employee_count', label: 'People', align: 'right', render: (r) => num(r.employee_count ?? r.headcount ?? 0) },
        { key: 'monthly_cost', label: 'Wage cost', align: 'right', render: (r) => (r.monthly_cost ? inr(r.monthly_cost) : '—') },
        { key: 'is_active', label: 'Status', render: (r) => <StatusChip value={r.is_active === false ? 'INACTIVE' : 'ACTIVE'} /> },
      ]}
      fields={[
        { key: 'name', label: 'Name', required: true },
        { key: 'code', label: 'Code', hint: 'Short, upper case. Optional.' },
        { key: 'parent_id', label: 'Parent department', type: 'select', options: [], hint: 'Leave empty for a top-level department.' },
        { key: 'manager_id', label: 'Manager', type: 'select', options: options, placeholder: 'No manager' },
      ]}
    />
  );
}
