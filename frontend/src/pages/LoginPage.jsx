import { useState } from 'react';
import { useAuth } from '../auth/useAuth.js';
import { APP_NAME } from '../config/app.js';
import { Field, Input } from '../components/ui/controls.jsx';
import { ThemeToggle } from '../layout/ThemeToggle.jsx';

/**
 * The mockup's login card, plus a role switcher: one click fills the demo credentials for that role so
 * you can see exactly what that role may do. Password is the seeded default for every account.
 */
/**
 * One button per seeded login — the addresses here are copied from backend/db/seed/data.js and must
 * stay identical to it. An earlier version of this list typed "payroll.admin@oxp.com" for the account
 * the seeder creates as "payroll-admin@oxp.com", and clicking it produced a sign-in failure that looked
 * like a broken account rather than a typo.
 * The notes are what the roles actually hold (see backend/src/lib/shared/permissions.js).
 *
 * One role per account, which is what the API enforces — so this list has no "manager + HR" combination any
 * more, and it has one login per role and nothing else. The rule that an administrator cannot change a peer
 * administrator is still enforced by the API (it is the first line of every user route); it just does not need
 * a spare admin account sitting in the demo to prove it.
 */
const DEMO = [
  { role: 'Admin', email: 'admin@oxp.com', note: 'everything, incl. users & settings' },
  { role: 'HR Manager', email: 'hr@oxp.com', note: 'people, contracts, attendance, time off' },
  { role: 'Payroll Officer', email: 'hr2@oxp.com', note: 'runs: compute, validate, mark paid — no bulk mail' },
  { role: 'Payroll Manager', email: 'payroll@oxp.com', note: '+ bulk e-mail, PDFs, structures, delete a run' },
  { role: 'Employee', email: 'aarav.mehta@oxp.com', note: 'own payslips, leave, attendance' },
];
/** The seeder's default (config.demo.password). A deployment that set DEMO_PASSWORD must change this. */
const PASSWORD = 'Password@123';

export function LoginPage() {
  const { login } = useAuth();
  const [email, setEmail] = useState('admin@oxp.com');
  const [showPw, setShowPw] = useState(false);
  const [password, setPassword] = useState(PASSWORD);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  async function submit(event) {
    event?.preventDefault();
    setBusy(true); setError(null);
    try { await login(email.trim(), password); }
    catch (e) { setError(e.message || 'Sign in failed'); }
    finally { setBusy(false); }
  }

  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      <div className="hidden flex-col justify-between border-r border-line bg-ink-900 p-10 lg:flex">
        <div className="flex items-center gap-2">
          <div className="grid h-9 w-9 place-items-center rounded-lg bg-brand-600 text-sm font-bold text-white">P3</div>
          <span className="text-sm font-semibold text-slate-100">{APP_NAME}</span>
        </div>
        <div>
          <h1 className="max-w-md text-3xl font-semibold tracking-tight text-slate-50">
            Payroll that shows its working.
          </h1>
          <p className="mt-3 max-w-md text-sm text-slate-400">
            Attendance, time off and salary rules feed one computation: draft → compute → validate → PDFs → paid → emailed.
            Half-month runs reconcile back to the same monthly net, and every payslip a role touched is auditable.
          </p>
          <ul className="mt-6 space-y-2 text-xs text-slate-400">
            {[
              'Roles decide the menu, the buttons and the rows you can see',
              'Bulk payslip PDFs and mail run on a Redis worker, never in the request',
              'Employees download their own slips straight from the portal',
            ].map((line) => <li key={line} className="flex gap-2"><span className="text-brand-300">•</span>{line}</li>)}
          </ul>
        </div>
        <p className="text-[11px] text-slate-600">PostgreSQL · Express · React · Node · Redis</p>
      </div>

      <div className="flex items-center justify-center p-4 sm:p-6">
        {/* The theme control lives here too: the sign-in screen is part of the product, and a light-mode user
            should not get a dark card and then a light app. */}
        <form onSubmit={submit} className="panel w-full max-w-md p-6">
          <div className="mb-4 flex justify-end"><ThemeToggle compact /></div>
          <h2 className="text-base font-semibold text-slate-100">Welcome back</h2>
          <p className="mt-1 text-xs text-slate-400">Sign in with your work email.</p>

          <div className="mt-5 flex flex-col gap-4">
            <Field label="Company email" required>
              <Input value={email} onChange={setEmail} type="email" autoComplete="username" placeholder="you@company.com" />
            </Field>
            <Field label="Password" required error={error} hint={error ? 'Check the address with the buttons below — most failures here are a typo in the email.' : undefined}>
              <div className="relative">
                <Input value={password} onChange={setPassword} type={showPw ? 'text' : 'password'} autoComplete="current-password" placeholder="Password" className="pr-16" />
                <button type="button" className="absolute right-2 top-1/2 -translate-y-1/2 text-[11px] text-slate-400 hover:text-slate-200"
                        onClick={() => setShowPw((v) => !v)}>{showPw ? 'Hide' : 'Show'}</button>
              </div>
            </Field>
          </div>

          <button className="btn-primary mt-5 w-full" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>

          <div className="mt-6 border-t border-line pt-4">
            <p className="label">Demo accounts</p>
            <div className="mt-2 grid gap-1.5">
              {DEMO.map((d) => (
                <button type="button" key={d.email} onClick={() => { setEmail(d.email); setPassword(PASSWORD); setError(null); }}
                        className={'flex items-center justify-between rounded-lg border px-3 py-2 text-left text-xs ' + (email === d.email ? 'border-brand-500/60 bg-brand-600/10' : 'border-line hover:bg-ink-800')}>
                  <span className="font-medium text-slate-200">{d.role}</span>
                  <span className="truncate pl-3 text-slate-500">{d.email} · {d.note}</span>
                </button>
              ))}
            </div>
            <p className="mt-3 text-[11px] text-slate-500">Password for all of them: <code className="text-slate-300">{PASSWORD}</code> — the shared
              <code className="text-slate-400">DEMO_PASSWORD</code> from backend/.env, applied to every seeded and newly created login.</p>
            <p className="mt-1.5 text-[11px] text-slate-600">
              If a sign-in is refused twice, stop retyping it: the guard allows 8 attempts per 5 minutes per address and
              then waits 15 minutes out before it will try again. Pick the address with a button above instead.
            </p>
          </div>
        </form>
      </div>
    </div>
  );
}
