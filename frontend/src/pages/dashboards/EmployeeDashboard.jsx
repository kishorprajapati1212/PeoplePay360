import { useCallback, useState } from 'react';
import { Link } from 'react-router-dom';
import { portal } from '../../api/endpoints.js';
import { useApi } from '../../hooks/useApi.js';
import { PageHeader } from '../../layout/PageHeader.jsx';
import { Panel } from '../../components/ui/Panel.jsx';
import { StatCard } from '../../components/ui/StatCard.jsx';
import { StatusChip } from '../../components/ui/StatusChip.jsx';
import { ErrorPanel, EmptyState } from '../../components/ui/Feedback.jsx';
import { date, inr, num } from '../../utils/format.js';

/**
 * What an employee sees when they sign in. It used to be the HR dashboard with the payroll panels missing,
 * which is a blank page to the one person who only ever needs their own numbers.
 *
 * One call feeds it: GET /api/portal/summary, the audited self-service route that can only ever return the
 * caller's own records. Nothing here is computed on the client.
 */
export function EmployeeDashboard({ entry, onMonthChange }) {
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const load = useCallback(() => portal.summary({ month }), [month]);
  const { data, error, loading, reload } = useApi(load, [load]);

  const me = data?.employee || {};
  const att = data?.attendance || {};
  const slip = data?.last_payslip;
  const balances = data?.leave_balances || [];
  const requests = data?.requests || [];

  return (
    <>
      <PageHeader
        title={entry.title}
        subtitle={data ? `${data.period?.label || ''} · ${me.name || 'your records'}${me.code ? ` · ${me.code}` : ''}` : 'Loading your month…'}
        actions={
          <div className="flex flex-wrap items-end gap-2">
            <label className="text-right">
              <span className="label">Month</span>
              <input type="month" className="input mt-1 w-40" value={month}
                     onChange={(e) => { setMonth(e.target.value); onMonthChange?.(e.target.value); }} />
            </label>
            <button className="btn-ghost btn-sm" onClick={reload} disabled={loading}>{loading ? '…' : 'Refresh'}</button>
          </div>
        }
      />
      {error && <ErrorPanel error={error} onRetry={reload} />}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Hours worked" value={Number(att.worked_hours || 0).toFixed(1)} hint={`${num(att.present)} present · ${num(att.absent)} absent · ${num(att.half_day)} half`} />
        <StatCard label="Overtime" value={Number(att.overtime_hours || 0).toFixed(2)} hint="hours, awaiting or already approved" tone={Number(att.overtime_hours) ? 'brand' : undefined} />
        <StatCard label="Leave pending" value={num(data?.pending_approvals)} tone={data?.pending_approvals ? 'warn' : undefined} hint="requests waiting on an approver" />
        <StatCard label="Last payslip" value={slip ? inr(slip.net) : '—'} hint={slip ? `${slip.period} · ${String(slip.status).toLowerCase()}` : 'none released yet'} tone="money" />
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-3">
        <Panel title="Leave balance" subtitle="what you have left, per type" pad={false}>
          {balances.length ? (
            <table className="w-full text-sm">
              <thead className="bg-ink-850/60"><tr><th className="th">Type</th><th className="th text-right">Got</th><th className="th text-right">Taken</th><th className="th text-right">Pending</th><th className="th text-right">Left</th></tr></thead>
              <tbody>
                {balances.map((b) => (
                  <tr key={b.id || b.code} className="row">
                    <td className="td">
                      <p className="text-slate-100">{b.type}</p>
                      {b.valid_until && <p className="text-xs text-slate-500">valid to {date(b.valid_until)}</p>}
                    </td>
                    <td className="td text-right">{num(b.allocated)}</td>
                    <td className="td text-right">{num(b.taken)}</td>
                    <td className="td text-right">{num(b.pending)}</td>
                    <td className="td text-right">{num(b.remaining)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <EmptyState title="No leave balance yet"
                        hint="HR assigns one per type. Until then, only leave types that need no balance can be applied for — the same screen has the request form."
                        action={<Link to="/time-off/my-requests" className="btn-ghost btn-sm">Open my requests</Link>} />
          )}
        </Panel>

        <Panel title="My recent requests" pad={false}>
          <ul className="divide-y divide-line/70">
            {requests.slice(0, 6).map((r) => (
              <li key={r.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                <span className="text-slate-200">{r.type}</span>
                <span className="text-xs text-slate-500">{date(r.from)}{r.to && r.to !== r.from ? ` → ${date(r.to)}` : ''} · {num(r.days)} {r.days === 1 ? 'day' : 'days'}</span>
                <span className="ml-auto"><StatusChip value={r.status} /></span>
              </li>
            ))}
            {!requests.length && <li className="px-4 py-3 text-sm text-slate-500">Nothing applied for this month.</li>}
          </ul>
          <div className="px-4 py-3">
            <Link to="/time-off/my-requests" className="btn-primary btn-sm">+ Request leave</Link>
          </div>
        </Panel>

        <Panel title="My payslips" pad={false}>
          <div className="px-4 py-3 text-sm text-slate-300">
            {slip ? (
              <>
                <p>Latest: <b>{slip.period}</b> — net {inr(slip.net)}, gross {inr(slip.gross)}, {String(slip.status).toLowerCase()}{slip.paid_on ? ` on ${date(slip.paid_on)}` : ''}.</p>
                <p className="mt-1 text-xs text-slate-500">{slip.has_pdf ? 'The PDF is on the payslip page — the same file payroll released.' : 'No PDF for that slip yet; the run may still be generating them.'}</p>
              </>
            ) : <p>No payslip has been released to you yet.</p>}
          </div>
          <div className="flex flex-wrap gap-2 border-t border-line/70 px-4 py-3">
            <Link to="/portal/payslips" className="btn-ghost btn-sm">All my payslips</Link>
            <Link to="/portal/attendance" className="btn-ghost btn-sm">My attendance</Link>
            <Link to="/portal" className="btn-ghost btn-sm">My profile</Link>
          </div>
        </Panel>
      </div>
    </>
  );
}
