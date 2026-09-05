import { useCallback, useState } from 'react';
import { users, employees } from '../../api/endpoints.js';
import { useApi, useAction } from '../../hooks/useApi.js';
import { useTable } from '../../hooks/useTable.js';
import { PageHeader } from '../../layout/PageHeader.jsx';
import { Panel } from '../../components/ui/Panel.jsx';
import { DataTable } from '../../components/data/DataTable.jsx';
import { Modal } from '../../components/ui/Modal.jsx';
import { Field, Input, Select, Checkbox, SearchInput } from '../../components/ui/controls.jsx';
import { StatusChip } from '../../components/ui/StatusChip.jsx';
import { EmptyState } from '../../components/ui/Feedback.jsx';
import { useToast } from '../../components/ui/Toast.jsx';
import { useCan } from '../../rbac/Can.jsx';
import { human, datetime, date } from '../../utils/format.js';
import { toRows, totalOf } from '../../utils/query.js';

/**
 * The mockup's "User Management" screen: the list on the left, "Create New User" on the right with a
 * checkbox per role. Access itself is not edited here — that lives in backend/src/lib/shared/permissions.js.
 */
const ROLES = ['EMPLOYEE', 'HR_MANAGER', 'HR_PAYROLL_USER', 'HR_PAYROLL_MANAGER', 'ADMIN'];

export function UsersPage() {
  const toast = useToast();
  const mayCreate = useCan('user:create');
  const mayWrite = useCan('user:write');
  const mayDeactivate = useCan('user:deactivate');
  const mayReset = useCan('user:reset_password');
  const table = useTable({});
  const [create, setCreate] = useState(null);
  const [edit, setEdit] = useState(null);
  const [reset, setReset] = useState(null);   // the API needs a new password, so ask for one instead of firing an empty POST
  const { run, busy } = useAction();

  const list = useApi(useCallback(() => users.list(table.params), [table.params]), [table.params]);
  const people = useApi(useCallback(() => employees.list({ page: 1, page_size: 300 }), []), []);

  async function saveCreate() {
    const body = { name: create.name, work_email: create.work_email, password: create.password,
                   roles: create.roles.length ? create.roles : ['EMPLOYEE'], employee_id: create.employee_id || undefined };
    await run('create', () => users.create(body)).then(() => { setCreate(null); list.reload(); toast.success('User created'); }).catch((e) => toast.error(e.message));
  }
  async function saveEdit() {
    await run('roles', () => users.setRoles(edit.id, { roles: edit.roles })).then(() => { setEdit(null); list.reload(); toast.success('Roles updated'); }).catch((e) => toast.error(e.message));
  }
  const act = (row, key, fn, message) => run(key + row.id, fn).then(() => { list.reload(); toast.success(message); }).catch((e) => toast.error(e.message));

  return (
    <>
      <PageHeader title="User access" subtitle="Who can sign in, and which of the four modules they see."
                  actions={mayCreate && <button className="btn-primary btn-sm" onClick={() => setCreate({ name: '', work_email: '', password: 'Password@123', roles: ['EMPLOYEE'], employee_id: '' })}>+ New user</button>} />
      <Panel pad={false}>
        <DataTable rows={toRows(list.data)} loading={list.loading} error={list.error} onRetry={list.reload}
          toolbar={<SearchInput className="w-64" value={table.term} onChange={table.onSearch} placeholder="Name or email…" />}
          columns={[
            { key: 'name', label: 'User', render: (r) => (<div><p className="text-slate-100">{r.name}</p><p className="text-xs text-slate-500">{r.work_email}</p></div>) },
            { key: 'roles', label: 'Roles', render: (r) => (
              <span className="flex flex-wrap gap-1">{(r.roles || [r.role]).filter(Boolean).map((x) => <span key={x} className="chip border-brand-500/30 bg-brand-500/10 text-brand-200">{human(x)}</span>)}</span>) },
            { key: 'employee', label: 'Linked employee', render: (r) => (r.employee_name ? `${r.employee_name} · ${r.employee_code}` : <span className="text-xs text-amber-300">not linked</span>) },
            { key: 'is_active', label: 'Status', render: (r) => <StatusChip value={r.is_active ? 'ACTIVE' : 'INACTIVE'} /> },
            { key: 'last_login_at', label: 'Last seen', render: (r) => <span className="text-xs text-slate-500">{r.last_login_at ? datetime(r.last_login_at) : 'never'}</span> },
            { key: '_a', label: '', render: (r) => (
              <span className="flex flex-wrap gap-1.5">
                {mayWrite && <button className="btn-ghost btn-sm" onClick={() => setEdit({ id: r.id, name: r.name, roles: r.roles || [r.role] })}>Roles</button>}
                {mayReset && <button className="btn-ghost btn-sm" onClick={() => setReset({ id: r.id, name: r.name, password: 'Password@123' })}>Reset pw</button>}
                {mayDeactivate && <button className={r.is_active ? 'btn-danger btn-sm' : 'btn-ghost btn-sm'}
                          onClick={() => act(r, 'toggle', () => (r.is_active ? users.deactivate(r.id) : users.activate(r.id)), r.is_active ? 'Deactivated' : 'Activated')}>{r.is_active ? 'Deactivate' : 'Activate'}</button>}
              </span>) },
          ]}
          pagination={{ page: table.page, size: table.size, total: totalOf(list.data, toRows(list.data).length), onPage: table.setPage, onSize: table.setSize }}
          empty={<EmptyState title="No users" />} />
      </Panel>

      <Modal open={!!create} onClose={() => setCreate(null)} width="max-w-lg" title="Create user"
             subtitle="A login can exist on its own, but linking it to an employee is what gives the person a payslip portal."
             footer={<><button className="btn-ghost" onClick={() => setCreate(null)}>Cancel</button>
                      <button className="btn-primary" disabled={!!busy} onClick={saveCreate}>{busy === 'create' ? 'Creating…' : 'Create user'}</button></>}>
        {create && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Name" required><Input value={create.name} onChange={(v) => setCreate({ ...create, name: v })} /></Field>
            <Field label="Work email" required><Input value={create.work_email} onChange={(v) => setCreate({ ...create, work_email: v })} /></Field>
            <Field label="Initial password" required hint="Hand it over out of band."><Input value={create.password} onChange={(v) => setCreate({ ...create, password: v })} /></Field>
            <Field label="Employee record"><Select value={create.employee_id} onChange={(v) => setCreate({ ...create, employee_id: v })} placeholder="No link"
                   options={toRows(people.data).map((p) => ({ value: p.id, label: p.name + ' · ' + p.employee_code }))} /></Field>
            <div className="sm:col-span-2">
              <p className="label">Roles</p>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                {ROLES.map((role) => (
                  <Checkbox key={role} checked={create.roles.includes(role)} label={human(role)}
                            hint={ROLE_HINT[role]} onChange={(on) => setCreate({ ...create, roles: on ? [...create.roles, role] : create.roles.filter((x) => x !== role) })} />
                ))}
              </div>
            </div>
          </div>
        )}
      </Modal>

      <Modal open={!!reset} onClose={() => setReset(null)} width="max-w-md" title={'Reset the password for ' + (reset?.name || '')}
             subtitle="Every session this user has is revoked, so sign them out of any device before you hand the new password over."
             footer={<><button className="btn-ghost" onClick={() => setReset(null)}>Cancel</button>
                      <button className="btn-primary" disabled={!!busy || (reset?.password || '').length < 10}
                              onClick={() => act(reset, 'reset', () => users.resetPassword(reset.id, { password: reset.password, must_change_pw: false }), 'Password reset')}>
                        {busy === 'reset' + (reset?.id || '') ? 'Saving…' : 'Set password'}</button></>}>
        {reset && (
          <Field label="New password" required hint="At least 10 characters."
                 error={(reset.password || '').length < 10 ? 'Use at least 10 characters' : undefined}>
            <Input value={reset.password} onChange={(v) => setReset({ ...reset, password: v })} />
          </Field>
        )}
      </Modal>

      <Modal open={!!edit} onClose={() => setEdit(null)} width="max-w-md" title={'Roles for ' + (edit?.name || '')}
             subtitle="A user with two roles gets the union of both — that is how an HR person who also runs payroll is set up."
             footer={<><button className="btn-ghost" onClick={() => setEdit(null)}>Cancel</button>
                      <button className="btn-primary" disabled={!!busy} onClick={saveEdit}>{busy === 'roles' ? 'Saving…' : 'Save roles'}</button></>}>
        {edit && (
          <div className="grid gap-2 sm:grid-cols-2">
            {ROLES.map((role) => (
              <Checkbox key={role} checked={edit.roles?.includes(role)} label={human(role)} hint={ROLE_HINT[role]}
                        onChange={(on) => setEdit({ ...edit, roles: on ? [...edit.roles, role] : edit.roles.filter((x) => x !== role) })} />
            ))}
          </div>
        )}
      </Modal>
    </>
  );
}

const ROLE_HINT = {
  EMPLOYEE: 'own payslips, leave, attendance',
  HR_MANAGER: 'people, attendance, time off',
  HR_PAYROLL_USER: '+ compute, validate, payslips',
  HR_PAYROLL_MANAGER: '+ send bulk, exports, structures',
  ADMIN: 'everything, incl. users & settings',
};
