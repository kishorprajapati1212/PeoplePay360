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
  const [edit, setEdit] = useState(null);   // name + work email (the only two fields the API takes)
  const [reset, setReset] = useState(null);   // the API needs a new password, so ask for one instead of firing an empty POST
  const [error, setError] = useState('');               // the reason a save was refused, kept in the dialog
  const [fieldErrors, setFieldErrors] = useState({});
  const { run, busy } = useAction();

  const list = useApi(useCallback(() => users.list(table.params), [table.params]), [table.params]);
  const people = useApi(useCallback(() => employees.list({ page: 1, page_size: 300 }), []), []);

  async function saveCreate() {
    setError(''); setFieldErrors({});
    const pw = String(create.password || '').trim();
    if (!/^[^@\s]+@[^@\s.]+\.[A-Za-z]{2,}$/.test(String(create.work_email || '').trim())) { setError('A work email has to be a full address, like name@oxp.com'); return; }
    if (pw && pw.length < 10) { setError('A password you type here has to be at least 10 characters — the same rule the API enforces.'); return; }
    try {
      // An empty box is not a guess: it means "use the server's shared demo password", which is what
      // every other seeded login uses. The response says which of the two happened, and the toast
      // repeats it, because "created" is useless if nobody knows what to type at the sign-in box.
      const out = await users.create({ name: create.name, work_email: create.work_email, role: create.role,
        employee_id: create.employee_id || undefined, ...(pw ? { password: pw } : {}) });
      setCreate(null); list.reload();
      toast.success(out?.password_source === 'provided'
        ? `${out.name || 'User'} can sign in with the password you typed`
        : `${out?.name || 'User'} can sign in now with the shared demo password (DEMO_PASSWORD in backend/.env)`);
    } catch (e) {
      setError(e.message);
      setFieldErrors(e.fieldErrors || {});
    }
  }
  async function saveRoles() {
    await run('roles', () => users.setRoles(edit.id, { roles: edit.roles })).then(() => { setEdit(null); list.reload(); toast.success('Roles updated'); }).catch((e) => toast.error(e.message));
  }
  async function saveUser() {
    setError(''); setFieldErrors({});
    try {
      await run('user', () => users.update(edit.id, { name: edit.name, work_email: edit.work_email }));
      setEdit(null); list.reload(); toast.success('User updated');
    } catch (e) { setError(e.message); setFieldErrors(e.fieldErrors || {}); }
  }
  const act = (row, key, fn, message) => run(key + row.id, fn).then(() => { list.reload(); toast.success(message); }).catch((e) => toast.error(e.message));

  return (
    <>
      <PageHeader title="User access" subtitle="Who can sign in, and which of the four modules they see."
                  actions={mayCreate && <button className="btn-primary btn-sm" onClick={() => { setError(''); setFieldErrors({}); setCreate({ name: '', work_email: '', role: 'EMPLOYEE', employee_id: '', password: '' }); }}>+ New user</button>} />
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
                {mayWrite && <button className="btn-ghost btn-sm" onClick={() => { setError(''); setFieldErrors({}); setEdit({ id: r.id, name: r.name, work_email: r.work_email, roles: r.roles || [r.role], tab: 'profile' }); }}>Edit</button>}
                {mayReset && <button className="btn-ghost btn-sm" onClick={() => setReset({ id: r.id, name: r.name, password: 'Password@123' })}>Reset pw</button>}
                {mayDeactivate && <button className={r.is_active ? 'btn-danger btn-sm' : 'btn-ghost btn-sm'}
                          onClick={() => act(r, 'toggle', () => (r.is_active ? users.deactivate(r.id) : users.activate(r.id)), r.is_active ? 'Deactivated' : 'Activated')}>{r.is_active ? 'Deactivate' : 'Activate'}</button>}
              </span>) },
          ]}
          pagination={{ page: table.page, size: table.size, total: totalOf(list.data, toRows(list.data).length), onPage: table.setPage, onSize: table.setSize }}
          empty={<EmptyState title="No users" />} />
      </Panel>

      {/* Three answers to create a login — name, work email, role. The employee link is optional, and the
          password is not asked for because the server hands out the demo one. */}
      <Modal open={!!create} onClose={() => setCreate(null)} width="max-w-lg" title="Create user"
             subtitle="A login can exist on its own, but linking it to an employee is what gives the person a payslip portal."
             footer={<><button className="btn-ghost" onClick={() => setCreate(null)}>Cancel</button>
                      <button className="btn-primary" disabled={!!busy} onClick={saveCreate}>{busy === 'create' ? 'Creating…' : 'Create user'}</button></>}>
        {create && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Name" required error={fieldErrors.name}><Input value={create.name} onChange={(v) => setCreate({ ...create, name: v })} placeholder="Rahul Verma" /></Field>
            <Field label="Work email" required error={fieldErrors.work_email} hint="This is what they type at the sign-in box.">
              <Input type="email" value={create.work_email} onChange={(v) => setCreate({ ...create, work_email: v })} placeholder="name@oxp.com" />
            </Field>
            <Field label="Role" required hint={ROLE_HINT[create.role]}>
              <Select value={create.role} onChange={(v) => setCreate({ ...create, role: v })} options={ROLES.map((r) => ({ value: r, label: human(r) }))} />
            </Field>
            <Field label="Employee record" error={fieldErrors.employee_id} hint="Optional — needed for payslips and attendance.">
              <Select value={create.employee_id} onChange={(v) => setCreate({ ...create, employee_id: v })} placeholder="No link"
                      options={toRows(people.data).map((p) => ({ value: p.id, label: p.name + ' · ' + p.employee_code }))} />
            </Field>
            <Field label="Temporary password" error={error && error.startsWith('A password') ? error : null}
                   hint="Leave blank to use the shared demo password. Hand it over out of band — the app never shows a stored password again.">
              <Input type="text" autoComplete="new-password" value={create.password} onChange={(v) => setCreate({ ...create, password: v })}
                     placeholder="Blank = demo password (10+ characters if you type one)" />
            </Field>
            <p className="text-xs text-slate-500 sm:col-span-2">
              Newly created logins are active straight away — there is no invitation step in this build, and no e-mail is sent to them.
            </p>
            {error && (
              <p className="rounded-lg border border-bad/40 bg-red-950/40 px-3 py-2 text-sm text-red-200 sm:col-span-2">{error}</p>
            )}
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

      {edit && edit.tab === 'profile' ? (
        <Modal open onClose={() => setEdit(null)} width="max-w-md" title={'Edit ' + (edit.name || 'user')}
               subtitle="Only the name and the sign-in address live here — roles and passwords have their own buttons."
               footer={<><button className="btn-ghost" onClick={() => setEdit(null)}>Cancel</button>
                        <button className="btn-ghost" onClick={() => setEdit({ ...edit, tab: 'access' })}>Roles</button>
                        <button className="btn-primary" disabled={!!busy} onClick={saveUser}>{busy === 'user' ? 'Saving…' : 'Save user'}</button></>}>
          <div className="grid gap-3">
            <Field label="Name" required error={fieldErrors.name}><Input value={edit.name} onChange={(v) => setEdit({ ...edit, name: v })} /></Field>
            <Field label="Work email" required error={fieldErrors.work_email} hint="This is what they type at the sign-in box.">
              <Input type="email" value={edit.work_email} onChange={(v) => setEdit({ ...edit, work_email: v })} />
            </Field>
            {error && <p className="rounded-lg border border-bad/40 bg-red-950/40 px-3 py-2 text-sm text-red-200">{error}</p>}
          </div>
        </Modal>
      ) : edit && (
        <Modal open onClose={() => setEdit(null)} width="max-w-md" title={'Access for ' + (edit.name || '')}
               subtitle="A user with two roles gets the union of both — that is how an HR person who also runs payroll is set up."
               footer={<>
                 <button className="btn-ghost" onClick={() => setEdit({ ...edit, tab: 'profile' })}>Name &amp; email</button>
                 <button className="btn-primary" disabled={!!busy} onClick={saveRoles}>{busy === 'roles' ? 'Saving…' : 'Save roles'}</button>
               </>}>
          <div className="grid gap-2 sm:grid-cols-2">
            {ROLES.map((role) => (
              <Checkbox key={role} checked={edit.roles?.includes(role)} label={human(role)} hint={ROLE_HINT[role]}
                        onChange={(on) => setEdit({ ...edit, roles: on ? [...edit.roles, role] : edit.roles.filter((x) => x !== role) })} />
            ))}
          </div>
        </Modal>
      )}
    </>
  );
}

/**
 * What each role can actually do, read off ROLE_PERMISSIONS/DENIES in backend/src/lib/shared/permissions.js.
 * Keep this in step with that file: a hint that overpromises is how someone ends up hunting for a button
 * that was never going to appear.
 */
const ROLE_HINT = {
  EMPLOYEE: 'own payslips, own leave requests, own attendance. No other person is visible.',
  HR_MANAGER: 'employees, contracts, attendance, time off (approve + assign balances), company settings to read. Cannot compute or release a payrun.',
  HR_PAYROLL_USER: 'everything HR_MANAGER sees, plus create/compute/validate a run and mark it paid. No bulk payslip e-mail, no structure editing, no voiding.',
  HR_PAYROLL_MANAGER: 'payroll end to end: compute, validate, mark paid, generate PDFs, bulk e-mail payslips, edit slip lines and arreares, structures, void/delete a run, read company settings. No user admin and no settings writes.',
  ADMIN: 'everything, including User Access, system/jobs and writing company settings. Only ADMIN can create or deactivate a login.',
};
