import { useState } from 'react';
import { useAuth } from '../auth/useAuth.js';
import { APP_NAME } from '../config/app.js';
import { Field, Input } from '../components/ui/controls.jsx';

/**
 * The mockup's login card, plus a role switcher: one click fills the demo credentials for that role so
 * you can see exactly what that role may do. Password is the seeded default for every account.
 */
const DEMO = [
  { role: 'Admin', email: 'admin@oxp.com', note: 'everything, incl. users & settings' },
  { role: 'HR', email: 'hr@oxp.com', note: 'employees, attendance, time off' },
  { role: 'Payroll', email: 'payroll@oxp.com', note: 'payruns, compute, payslips' },
  { role: 'Payroll Admin', email: 'payroll.admin@oxp.com', note: '+ send, exports, structures' },
  { role: 'Employee', email: 'aarav.mehta@oxp.com', note: 'own payslips, leave, attendance' },
];
const PASSWORD = 'Password@123';

export function LoginPage() {
  const { login } = useAuth();
  const [email, setEmail] = useState('admin@oxp.com');
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
              'Bulk PDFs and bulk email run on a Redis worker, never in the request',
              'Employees download their own slips straight from the portal',
            ].map((line) => <li key={line} className="flex gap-2"><span className="text-brand-300">•</span>{line}</li>)}
          </ul>
        </div>
        <p className="text-[11px] text-slate-600">PostgreSQL · Express · React · Node · Redis</p>
      </div>

      <div className="flex items-center justify-center p-6">
        <form onSubmit={submit} className="panel w-full max-w-md p-6">
          <h2 className="text-base font-semibold text-slate-100">Welcome back</h2>
          <p className="mt-1 text-xs text-slate-400">Sign in with your work email.</p>

          <div className="mt-5 flex flex-col gap-4">
            <Field label="Company email" required>
              <Input value={email} onChange={setEmail} type="email" autoComplete="username" placeholder="you@company.com" />
            </Field>
            <Field label="Password" required error={error}>
              <Input value={password} onChange={setPassword} type="password" autoComplete="current-password" placeholder="••••••••" />
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
            <p className="mt-3 text-[11px] text-slate-500">Password for all of them: <code className="text-slate-300">{PASSWORD}</code></p>
          </div>
        </form>
      </div>
    </div>
  );
}
