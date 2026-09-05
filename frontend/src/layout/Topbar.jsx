import { useLocation, useNavigate } from 'react-router-dom';
import { useState } from 'react';
import { useAuth } from '../auth/useAuth.js';
import { initials, human } from '../utils/format.js';
import { Modal } from '../components/ui/Modal.jsx';
import { Field, Input } from '../components/ui/controls.jsx';
import { auth } from '../api/endpoints.js';
import { useToast } from '../components/ui/Toast.jsx';
import { MobileNav } from './Sidebar.jsx';

/** Breadcrumb + role chips + the account menu (change password, sign out). */
export function Topbar() {
  const { user, logout } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const toast = useToast();
  const [pwOpen, setPwOpen] = useState(false);
  const [pw, setPw] = useState({ currentPassword: '', newPassword: '', confirm: '' });
  const [busy, setBusy] = useState(false);

  const crumbs = [{ label: 'Home', to: '/' }].concat(
    location.pathname.split('/').filter(Boolean).map((part, i, all) => ({
      label: human(decodeURIComponent(part)),
      to: '/' + all.slice(0, i + 1).join('/'),
      isId: /^[0-9a-f-]{36}$/i.test(part),
    })),
  );

  async function changePassword() {
    if (pw.newPassword !== pw.confirm) return toast.error('The two new passwords do not match');
    setBusy(true);
    try {
      await auth.changePassword(pw.currentPassword, pw.newPassword);
      setPwOpen(false);
      toast.success('Password changed — please sign in again');
      setTimeout(logout, 800);
    } catch (e) { toast.error(e.message); }
    finally { setBusy(false); }
  }

  return (
    <header className="sticky top-0 z-20 border-b border-line bg-ink-950/85 backdrop-blur">
      <div className="mx-auto flex w-full max-w-[1500px] items-center gap-3 px-4 py-3 sm:px-6">
        <nav className="flex min-w-0 items-center gap-1.5 text-xs text-slate-500">
          {crumbs.map((c, i) => (
            <span key={c.to + i} className="flex items-center gap-1.5">
              {i > 0 && <span>/</span>}
              {c.isId ? <span className="text-slate-600">#{c.label}</span>
                : <button className={i === crumbs.length - 1 ? 'text-slate-200' : 'hover:text-slate-300'} onClick={() => navigate(c.to)}>{c.label}</button>}
            </span>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-2">
          <div className="hidden items-center gap-1 sm:flex">
            {(user?.roles || []).map((role) => (
              <span key={role} className="chip border-brand-500/30 bg-brand-500/10 text-brand-200">{human(role)}</span>
            ))}
            {user?.scope === 'own' && <span className="chip border-amber-500/30 bg-amber-500/10 text-amber-200">own records</span>}
          </div>
          <div className="group relative">
            <button className="flex items-center gap-2 rounded-lg border border-line px-2 py-1.5 text-xs text-slate-300 hover:bg-ink-800">
              <span className="grid h-6 w-6 place-items-center rounded-full bg-brand-600 text-[11px] font-semibold text-white">{initials(user?.name)}</span>
              <span className="hidden max-w-32 truncate sm:inline">{user?.name}</span>
              <span className="text-slate-500">▾</span>
            </button>
            <div className="invisible absolute right-0 top-full z-30 w-56 pt-1 opacity-0 transition group-hover:visible group-hover:opacity-100">
              <div className="panel p-1 text-xs">
                <div className="px-3 py-2">
                  <p className="font-medium text-slate-200">{user?.name}</p>
                  <p className="truncate text-slate-500">{user?.workEmail}</p>
                </div>
                <button className="w-full rounded-md px-3 py-2 text-left text-slate-300 hover:bg-ink-800" onClick={() => setPwOpen(true)}>Change password</button>
                <button className="w-full rounded-md px-3 py-2 text-left text-slate-300 hover:bg-ink-800" onClick={() => navigate('/portal')}>My portal</button>
                <button className="w-full rounded-md px-3 py-2 text-left text-red-300 hover:bg-red-950/40" onClick={logout}>Sign out</button>
              </div>
            </div>
          </div>
        </div>
      </div>
      <MobileNav />

      <Modal open={pwOpen} onClose={() => setPwOpen(false)} title="Change password" width="max-w-md"
             subtitle="Signing you out afterwards: every other session is revoked."
             footer={<><button className="btn-ghost" onClick={() => setPwOpen(false)}>Cancel</button>
                      <button className="btn-primary" disabled={busy} onClick={changePassword}>{busy ? 'Saving…' : 'Change password'}</button></>}>
        <div className="flex flex-col gap-3">
          <Field label="Current password" required><Input type="password" value={pw.currentPassword} onChange={(v) => setPw((s) => ({ ...s, currentPassword: v }))} /></Field>
          <Field label="New password" required hint="At least 10 characters.">
            <Input type="password" value={pw.newPassword} onChange={(v) => setPw((s) => ({ ...s, newPassword: v }))} />
          </Field>
          <Field label="Repeat new password" required>
            <Input type="password" value={pw.confirm} onChange={(v) => setPw((s) => ({ ...s, confirm: v }))} />
          </Field>
        </div>
      </Modal>
    </header>
  );
}
