import { useCallback, useState } from 'react';
import { users, employees } from '../../api/endpoints.js';
import { useApi, useAction } from '../../hooks/useApi.js';
import { useAuth } from '../../auth/useAuth.js';
import { useTable } from '../../hooks/useTable.js';
import { PageHeader } from '../../layout/PageHeader.jsx';
import { Panel } from '../../components/ui/Panel.jsx';
import { DataTable } from '../../components/data/DataTable.jsx';
import { Modal } from '../../components/ui/Modal.jsx';
import { Field, Input, Select, SearchInput } from '../../components/ui/controls.jsx';
import { StatusChip } from '../../components/ui/StatusChip.jsx';
import { EmptyState, Notice } from '../../components/ui/Feedback.jsx';
import { useToast } from '../../components/ui/Toast.jsx';
import { useCan } from '../../rbac/Can.jsx';
import { human, datetime, date } from '../../utils/format.js';
import { toRows, totalOf } from '../../utils/query.js';

/**
 * The mockup's "User Management" screen: the list on the left, "Create New User" on the right.
 *
 * Two things the API decides, not this page: an account carries exactly one of the five roles, and an
 * administrator cannot change a peer administrator (their own role, password or status only). Both are
 * enforced server-side, and the row actions here reflect them so that nobody clicks a button that can only
 * come back refused.
 *
 * A new account gets a set-password link, not a password typed by somebody else. Creating it queues the
 * message and answers immediately — the worker sends it and retries on its own — so this page shows the link
 * as a fallback and says, in plain words, that the mail goes out asynchronously.
 */
const ROLES = ['EMPLOYEE', 'HR_MANAGER', 'HR_PAYROLL_USER', 'HR_PAYROLL_MANAGER', 'ADMIN'];
const isAdmin = (who) => !!who && (who.roles || [who.role]).filter(Boolean).includes('ADMIN');

export function UsersPage() {
  const toast = useToast();
  const mayCreate = useCan('user:create');
  const mayWrite = useCan('user:write');
  const mayDeactivate = useCan('user:deactivate');
  const mayReset = useCan('user:reset_password');
  const { user: me } = useAuth();
  // Which rows belong to a peer administrator: the API refuses role, password and status changes on them.
  const isPeerAdmin = (r) => isAdmin(r) && isAdmin(me);
  const table = useTable({});
  const [create, setCreate] = useState(null);
  const [edit, setEdit] = useState(null);   // name + work email (the only two fields the API takes)
  const [reset, setReset] = useState(null);   // the API needs a new password, so ask for one instead of firing an empty POST
  const [invite, setInvite] = useState(null);   // the link just made, with its copy button
  const [copied, setCopied] = useState('');
  const [bulk, setBulk] = useState(null);   // what the one-by-one bulk send did, per account
  const pending = useApi(useCallback(() => users.pendingInvites(), []), []);
  const [error, setError] = useState('');               // the reason a save was refused, kept in the dialog
  const [fieldErrors, setFieldErrors] = useState({});
  const { run, busy } = useAction();

  const list = useApi(useCallback(() => users.list(table.params), [table.params]), [table.params]);
  const people = useApi(useCallback(() => employees.list({ page: 1, page_size: 300 }), []), []);

  async function saveCreate() {
    setError(''); setFieldErrors({});
    // Its own busy key, so the Create button says Creating… for this action and not for some other one.
    return run('create', doCreate).catch(() => {});   // the dialog keeps the reason; a toast expires mid-read
  }
  async function doCreate() {
    const pw = String(create.password || '').trim();
    if (!/^[^@\s]+@[^@\s.]+\.[A-Za-z]{2,}$/.test(String(create.work_email || '').trim())) { setError('A work email has to be a full address, like name@oxp.com'); return; }
    if (pw && pw.length < 10) { setError('A password you type here has to be at least 10 characters — the same rule the API enforces.'); return; }
    try {
      // An empty box is not a guess: it means "use the server's shared demo password", which is what
      // every other seeded login uses. The response says which of the two happened, and the toast
      // repeats it, because "created" is useless if nobody knows what to type at the sign-in box.
      const out = await users.create({ name: create.name, work_email: create.work_email, role: create.role,
        employee_id: create.employee_id || undefined, send_invite: create.send_invite, ...(pw ? { password: pw } : {}) });
      setCreate(null); list.reload();
      // The link is shown here as well as mailed: without SMTP credentials the message only exists as an
      // .eml under backend/storage/mail, so this box would otherwise be the single usable copy.
      //
      // Two things this had wrong before: the service answers with `invite` (not `invitation`), so the panel
      // never opened after a create; and the API's own `email` field is the send result rather than the
      // address, so the address is put back after the spread instead of being clobbered by it.
      if (out?.invite?.error) toast.error(`The login was created, but no link could be made: ${out.invite.error}`);
      else if (out?.invite?.link) { setInvite({ ...out.invite, mail: out.invite.email, name: out.name, email: out.work_email }); showDelivered(out.invite); pending.reload(); }
      else if (out?.password_source === 'provided') toast.success(`${out.name || 'User'} can sign in with the password you typed`);
      else toast.success(`${out?.name || 'User'} can sign in now with the shared demo password (DEMO_PASSWORD in backend/.env)`);
    } catch (e) {
      setError(e.message);
      setFieldErrors(e.fieldErrors || {});
    }
  }
  async function saveRole() {
    await run('role', () => users.setRole(edit.id, edit.role))
      .then((out) => { setEdit(null); list.reload(); toast.success(out?.must_sign_in ? 'Role changed — they have to sign in again' : 'Role changed'); })
      .catch((e) => toast.error(e.message));
  }
  /** Hand out (or re-hand out) the set-password link. The answer is a queue id, not a sent message. */
  function sendLink(row, sendEmail = true) {
    return run('invite' + row.id, () => users.invite(row.id, { send_email: sendEmail }))
      .then((out) => {
        setInvite({ ...out, mail: out?.email, name: row.name, email: row.work_email });
        list.reload(); pending.reload();
        showDelivered(out);
      })
      .catch((e) => toast.error(e.message));
  }
  /**
   * What a finished send means, in one place. By default the API mails the link from the request that made
   * it — one message per account, in order — so "sent" here is a fact about this request, not a promise about
   * a worker. INVITE_VIA_QUEUE=true is the only case where the honest word is "queued".
   */
  function showDelivered(out) {
    if (!out) return;
    if (out.mail_queued) toast.success('Handed to the worker: one job per account, on Settings → System');
    else if (out.mail_skipped) toast.success('No e-mail was sent; the link above is the whole delivery');
    else if (out.mail_sent) {
      toast.success(out.mail_driver === 'preview'
        ? 'No SMTP credentials, so the mail is a file under backend/storage/mail — the link above is the copy to send'
        : 'E-mailed, one message per account');
    } else toast.error('The link is ready but the mail server refused the send — copy the link and send it yourself');
  }
  /** The bulk send: one account after another, and a line of report per account. */
  function sendAllWaiting() {
    return run('bulk', () => users.sendPendingInvites({ limit: 50 }))
      .then((out) => {
        setBulk(out);
        list.reload(); pending.reload();
        const sent = out?.sent ?? 0, failed = out?.failed ?? 0;
        const secs = Math.max(1, Math.round((out?.took_ms || 0) / 1000));
        if (!out?.attempted) toast.success(out?.note || 'Nobody is waiting for a link');
        else if (!failed) toast.success(`Sent ${sent} link${sent === 1 ? '' : 's'}, one per account, in ${secs}s`);
        else toast.error(`${sent} sent, ${failed} refused by the mail server — the links are listed below`);
      })
      .catch((e) => toast.error(e.message));
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
      <PageHeader title="User access" subtitle="Who can sign in, and which of the four modules they see. One role per account; a new account sets its own password from a link."
                  actions={<span className="flex flex-wrap items-center gap-2">
                    {mayWrite && (pending.data?.count ?? 0) > 0 && (
                      <button className="btn-ghost btn-sm" disabled={!!busy}
                              title="Sends one message per account, from the API, in order, and waits for each one"
                              onClick={sendAllWaiting}>
                        {busy === 'bulk' ? 'Sending one by one…' : `Send links (${pending.data.count} waiting)`}
                      </button>
                    )}
                    {mayCreate && <button className="btn-primary btn-sm" onClick={() => { setError(''); setFieldErrors({}); setCreate({ name: '', work_email: '', role: 'EMPLOYEE', employee_id: '', password: '', send_invite: true }); }}>+ New user</button>}
                  </span>} />
      <Panel pad={false}>
        <DataTable rows={toRows(list.data)} loading={list.loading} error={list.error} onRetry={list.reload}
          toolbar={<SearchInput value={table.term} onChange={table.onSearch} placeholder="Name or email…" />}
          columns={[
            { key: 'name', label: 'User', render: (r) => (<div><p className="text-slate-100">{r.name}</p><p className="text-xs text-slate-500">{r.work_email}</p></div>) },
            { key: 'roles', label: 'Role', render: (r) => (
              <span className="flex flex-wrap items-center gap-1.5">
                {(r.roles || [r.role]).filter(Boolean).map((x) => <span key={x} className="chip border-brand-500/30 bg-brand-500/10 text-brand-200">{human(x)}</span>)}
                {/* The row that used to be a dead end: an account with a password it has never changed. */}
                {r.must_change_pw === true && (
                  <span className="chip border-amber-500/30 bg-amber-500/10 text-amber-300"
                        title="They must set their own password on first sign-in before this account works.">must set a password</span>
                )}
              </span>) },
            { key: 'employee', label: 'Linked employee', render: (r) => (r.employee_name ? `${r.employee_name} · ${r.employee_code}` : <span className="text-xs text-amber-300">not linked</span>) },
            { key: 'is_active', label: 'Status', render: (r) => <StatusChip value={r.is_active ? 'ACTIVE' : 'INACTIVE'} /> },
            { key: 'last_login_at', label: 'Last seen', render: (r) => <span className="text-xs text-slate-500">{r.last_login_at ? datetime(r.last_login_at) : 'never'}</span> },
            { key: '_a', label: '', render: (r) => (
              <span className="flex flex-wrap gap-1.5">
                {mayWrite && <button className="btn-ghost btn-sm" onClick={() => { setError(''); setFieldErrors({}); setEdit({ id: r.id, name: r.name, work_email: r.work_email, role: r.role || (r.roles || [])[0], adminTarget: isAdmin(r), tab: 'profile' }); }}>Edit</button>}
                {/* A link is a password reset wearing a hat, so the peer-admin rule applies to it as well. */}
                {mayWrite && (isPeerAdmin(r)
                  ? <span className="self-center text-xs text-slate-500" title="An administrator sets their own password: mailing them a reset link from another admin account is refused too.">link: self only</span>
                  : <button className="btn-ghost btn-sm" disabled={!!busy} title="Send (or resend) the link they use to set their own password"
                            onClick={() => sendLink(r, true)}>{busy === 'invite' + r.id ? 'Sending…' : 'Send link'}</button>)}
                {mayReset && (
                  isPeerAdmin(r)
                    ? <span className="self-center text-xs text-slate-500" title="An administrator's password is their own to change: the API refuses this on a peer account.">pw: self only</span>
                    : <button className="btn-ghost btn-sm" onClick={() => setReset({ id: r.id, name: r.name, password: '' })}>Reset pw</button>
                )}
                {mayDeactivate && (
                  isPeerAdmin(r)
                    ? <span className="self-center text-xs text-slate-500" title="Only that administrator can switch their own account off.">deactivate: self only</span>
                    : <button className={r.is_active ? 'btn-danger btn-sm' : 'btn-ghost btn-sm'}
                            onClick={() => act(r, 'toggle', () => (r.is_active ? users.deactivate(r.id) : users.activate(r.id)), r.is_active ? 'Deactivated' : 'Activated')}>{r.is_active ? 'Deactivate' : 'Activate'}</button>
                )}
              </span>) },
          ]}
          pagination={{ page: table.page, size: table.size, total: totalOf(list.data, toRows(list.data).length), onPage: table.setPage, onSize: table.setSize }}
          empty={<EmptyState title="No users" />} />
      </Panel>

      {bulk && (
        <Panel title="Set-password links, sent one by one" pad className="mb-4">
          <p className="text-xs text-slate-400">{bulk.note}</p>
          <ul className="mt-2 grid gap-1 text-xs">
            {(bulk.results || []).map((r, i) => r.stopped
              ? <li key={i} className="text-amber-300">Stopped early: {r.reason}</li>
              : <li key={i} className="flex flex-wrap items-center gap-2">
                  <span className={r.ok ? 'text-emerald-300' : 'text-red-300'}>{r.ok ? 'sent' : 'not sent'}</span>
                  <span className="text-slate-200">{r.name}</span>
                  <span className="text-slate-500">{r.work_email}</span>
                  <span className="text-slate-400">{r.note}</span>
                  {!r.ok && r.link && <code className="text-slate-300">{r.link}</code>}
                </li>)}
          </ul>
          <p className="mt-2 text-xs text-slate-500">Every line above is one SMTP conversation. A row that failed still has its link, so nothing is lost — copy it, or press that row's Send link again.</p>
        </Panel>
      )}

      {/* Three answers to create a login — name, work email, one role. The employee link is optional, and the
          account gets a link rather than a password somebody else invented. */}
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
            <label className="flex items-start gap-2 sm:col-span-2">
              <input type="checkbox" className="mt-1" checked={create.send_invite !== false}
                     onChange={(e) => setCreate({ ...create, send_invite: e.target.checked })} />
              <span className="text-xs text-slate-400">
                <span className="block text-slate-200">Send a set-password link</span>
                The account stays unusable until it is clicked, so nothing you type here is a secret anybody has to relay. With no password typed below, this is what makes the login work.
              </span>
            </label>
            <p className="text-xs text-slate-500 sm:col-span-2">
              The message goes out from this request, one account at a time — no queue to wait for. So it is as slow as your mail server says it is, and the button stays busy until it has answered. Until you have SMTP credentials the mail lands as a file in <code className="text-slate-400">backend/storage/mail</code>, which is why the link is also shown to you here.
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
               subtitle="One role per account — the specification's five. If a person does two jobs, change the role when they switch, rather than stacking powers onto one login."
               footer={<>
                 <button className="btn-ghost" onClick={() => setEdit({ ...edit, tab: 'profile' })}>Name &amp; email</button>
                 <button className="btn-primary" disabled={!!busy} onClick={saveRole}>{busy === 'role' ? 'Saving…' : 'Change role'}</button>
               </>}>
          <div className="grid gap-3">
            <Field label="Role" required hint={ROLE_HINT[edit.role]}>
              <Select value={edit.role} onChange={(v) => setEdit({ ...edit, role: v })} options={ROLES.map((r) => ({ value: r, label: human(r) }))} />
            </Field>
            <p className="text-xs text-slate-500">Their sessions end the moment the role changes, on purpose: a browser must not keep rights the account no longer has.</p>
            {edit.adminTarget && (
              <Notice tone="warn">You are editing another administrator. The API lets you fix their name and e-mail address only — role, password and status are theirs to change.</Notice>
            )}
            <div className="flex flex-wrap gap-1.5 border-t border-line-soft pt-3">
              <button className="btn-ghost btn-sm" disabled={!!busy || !!edit.adminTarget} title={edit.adminTarget ? 'Refused for a peer administrator, by the API' : undefined}
                      onClick={() => sendLink({ id: edit.id, name: edit.name, work_email: edit.work_email })}>Send a set-password link</button>
              <button className="btn-ghost btn-sm" onClick={() => run('invhist', () => users.invites(edit.id)).then((out) => setEdit({ ...edit, invites: out?.rows || [] }))}>Show open links</button>
            </div>
            {edit.invites && (
              edit.invites.length === 0
                ? <p className="text-xs text-slate-500">No open links. An expired or used one is closed already.</p>
                : <ul className="grid gap-1 text-xs text-slate-400">{edit.invites.map((i) => (
                    <li key={i.id} className="flex flex-wrap items-center gap-2">
                      <span className="text-slate-200">{i.email || edit.work_email}</span>
                      <span>sent {datetime(i.created_at)}</span>
                      <span className={new Date(i.expires_at) < new Date() ? 'text-red-300' : 'text-emerald-300'}>
                        {new Date(i.expires_at) < new Date() ? 'expired ' + datetime(i.expires_at) : 'valid until ' + datetime(i.expires_at)}
                      </span>
                      {i.accepted_at && <span>used {datetime(i.accepted_at)}</span>}
                    </li>))}</ul>
            )}
          </div>
        </Modal>
      )}

      {/* The link, in a box: what to do with it depends on whether a mailer is configured, and the
          answer to "did it send?" is in the panel below the button, not in the button. */}
      {invite && (
        <Modal open onClose={() => setInvite(null)} width="max-w-lg" title={'Set-password link for ' + (invite.name || 'this user')}
               subtitle="Hand it over yourself, or let the queue send it — either way it is single-use and it expires."
               footer={<><button className="btn-ghost" onClick={() => setInvite(null)}>Close</button>
                        <button className="btn-primary" onClick={() => setInvite(null)}>Done</button></>}>
          <div className="grid gap-3">
            <Field label="Link" hint="Paste it into a message to that address, or open it yourself to test the screen.">
              <div className="flex gap-2">
                <Input value={invite.link || ''} readOnly onChange={() => {}} className="flex-1 font-mono text-xs" />
                <button className="btn-ghost btn-sm" onClick={async () => {
                  try { await navigator.clipboard.writeText(invite.link || ''); setCopied('Link copied'); }
                  catch { setCopied('Your browser blocked the clipboard — select the text and copy it by hand'); }
                }}>Copy</button>
              </div>
            </Field>
            {copied && <p className="text-xs text-emerald-300">{copied}</p>}
            <p className="text-xs text-slate-400">{invite.how_it_is_delivered}</p>
            {invite.task_id != null && (
              <p className="text-xs text-slate-500">Logged as task <code className="text-slate-300">#{invite.task_id}</code> in the queue table, so the send — or the refusal — is on Settings → System either way.</p>
            )}
            {invite.mail?.file && <p className="text-xs text-slate-500">Written to <code className="text-slate-300">{invite.mail.file}</code></p>}
            {invite.mail?.error && <Notice tone="bad">The mail server said: {invite.mail.error}</Notice>}
            {invite.queue_fallback_reason && (
              <Notice tone="warn">The queue was not available, so this request sent the mail itself: {invite.queue_fallback_reason}</Notice>
            )}
            <p className="text-xs text-slate-500">
              {invite.email ? <>Address: <span className="text-slate-300">{String(invite.email)}</span> · </> : null}
              {invite.expires_at ? <>Expires {datetime(invite.expires_at)} ({invite.expires_in_hours}h).</> : null}
            </p>
            <p className="text-xs text-slate-500">Until it is used, the account cannot sign in — that is the point, not a fault. "Send link" again issues a fresh one.</p>
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
  ADMIN: 'everything, including User Access, system/jobs and writing company settings. Only ADMIN can create a login — and no admin can change another admin: role, password and status are self-service at that level.',
};
