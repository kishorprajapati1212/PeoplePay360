import { useCallback, useMemo, useState } from 'react';
import { org, employees } from '../../api/endpoints.js';
import { CrudPage } from '../../components/crud/CrudPage.jsx';
import { useApi } from '../../hooks/useApi.js';
import { StatusChip } from '../../components/ui/StatusChip.jsx';
import { num } from '../../utils/format.js';
import { toRows, totalOf } from '../../utils/query.js';

/** Departments from the mockup's org section: list + create/edit + safe delete (the API refuses if people are assigned). */
export function DepartmentsPage() {
  const people = useApi(useCallback(() => employees.list({ page: 1, page_size: 200 }), []), []);
  const options = useMemo(() => toRows(people.data).map((e) => ({ value: e.id, label: e.name + ' · ' + e.employee_code })), [people.data]);
  // The parent picker reads the departments themselves — it used to have no options at all, so opening
  // it in the edit dialog showed an empty list that looked like broken data.
  const depts = useApi(useCallback(() => org.departments.list({ page: 1, page_size: 200 }), []), []);
  const parentOptions = useMemo(() => toRows(depts.data).map((d) => ({ value: d.id, label: d.name })), [depts.data]);

  return (
    <CrudPage
      title="Departments"
      subtitle="Who reports where. A department can have a parent and a manager — both are used by the org chart and by approval routing."
      api={org.departments}
      readPerm="department:read" writePerm="department:write" deletePerm="department:write"
      // A department you no longer use should be switched off, not deleted: history (employees, contracts,
      // attendance) points at it. is_active is a boolean here, so the button writes true/false.
      active={{ field: 'is_active' }}
      searchPlaceholder="Department name or code…"
      columns={[
        { key: 'name', label: 'Department' },
        { key: 'code', label: 'Code' },
        { key: 'manager', label: 'Manager', render: (r) => r.manager?.name || r.manager_name || '—' },
        { key: 'employee_count', label: 'People', align: 'right', render: (r) => num(r.employee_count ?? r.headcount ?? 0) },
        { key: 'is_active', label: 'Status', render: (r) => <StatusChip value={r.is_active === false ? 'INACTIVE' : 'ACTIVE'} /> },
      ]}
      fields={[
        { key: 'name', label: 'Name', required: true },
        { key: 'code', label: 'Code', hint: 'Short, upper case. Optional.' },
        { key: 'parent_id', label: 'Parent department', type: 'select', options: parentOptions, placeholder: 'Top level (no parent)',
    hint: 'Optional, and only used by approval routing. A department with no parent is top-level — the list does not show this column because almost everything is top-level.' },
        { key: 'manager_id', label: 'Manager', type: 'select', options: options, placeholder: 'No manager' },
      ]}
    />
  );
}
