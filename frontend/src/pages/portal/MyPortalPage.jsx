import { useCallback, useState } from 'react';
import { Link } from 'react-router-dom';
import { portal, attendance } from '../../api/endpoints.js';
import { useApi, useAction } from '../../hooks/useApi.js';
import { PageHeader } from '../../layout/PageHeader.jsx';
import { Panel } from '../../components/ui/Panel.jsx';
import { KeyValue, ErrorPanel } from '../../components/ui/Feedback.jsx';
import { StatusChip } from '../../components/ui/StatusChip.jsx';
import { useToast } from '../../components/ui/Toast.jsx';
import { useCan } from '../../rbac/Can.jsx';
import { inr, num, date, time, periodLabel } from '../../utils/format.js';

/** Employee home: the two things people actually look for — did my punch land, and what did I get paid. */
export function MyPortalPage() {
  const toast = useToast();
  const { run, busy } = useAction();
  const summary = useApi(useCallback(() => portal.summary(), []), []);
  const today = useApi(useCallback(() => portal.attendance({ page: 1, page_size: 5 }), []), []);
  const can = useCan('attendance:clock');

  if (summary.error) return <ErrorPanel error={summary.error} onRetry={summary.reload} />;
  const data = summary.data;
  if (!data) return <Panel><p className="text-sm text-slate-400">Loading your portal…</p></Panel>;
  if (data.error) return <Panel><p className="text-sm text-amber-200">{data.error.message || 'This login is not linked to an employee record yet.'}</p></Panel>;

  return (
    <>
      <PageHeader title={`Hello, ${data.employee?.name?.split(' ')[0] || data.name || ''}`} subtitle={data.employee ? `${data.employee.employee_code} · ${data.employee.job_position || ''} · ${data.employee.department || ''}` : 'Your login is not linked to an employee record yet.'}
                  actions={can && (
                    <button className="btn-primary btn-sm" disabled={!!busy}
                            onClick={() => run('clock', () => attendance.clock({})).then(() => { summary.reload(); today.reload(); toast.success('Punch recorded'); }).catch((e) => toast.error(e.message))}>
                      {busy === 'clock' ? '…' : 'Clock in / out'}
                    </button>
                  )} />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[['Net this month', inr(data.current?.net_amount), data.current ? periodLabel(data.current.period_key) : 'no payslip yet'],
          ['Attendance this month', num(data.monthly?.present ?? data.stats?.present) + ' present', `${num(data.monthly?.absent ?? data.stats?.absent)} absent · ${num(data.monthly?.late ?? data.stats?.late)} late`],
          ['Leave balance', num(data.leave_balance ?? data.stats?.leave_remaining) + ' days', (data.balances || []).map((b) => `${b.type} ${b.remaining}`).join(' · ') || 'annual + sick'],
          ['Payslips', num(data.stats?.payslips ?? (data.payslips || []).length), `${num(data.stats?.paid ?? 0)} paid · YTD ${inr(data.stats?.ytd_net)}`]]
          .map(([label, value, hint]) => (
          <div key={label} className="panel panel-pad">
            <p className="label">{label}</p>
            <p className="mt-1.5 text-xl font-semibold text-slate-50">{value}</p>
            <p className="mt-0.5 truncate text-xs text-slate-500">{hint}</p>
          </div>
        ))}
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-3">
        <Panel className="xl:col-span-2" title="Last payslip" subtitle={data.current ? `document v${num(data.current.document_version || 1)} · ${data.current.status}` : 'nothing issued yet'}>
          {data.current ? (
            <div className="flex flex-wrap items-center gap-6">
              <div>
                <p className="label">Net pay</p>
                <p className="text-3xl font-semibold text-emerald-300">{inr(data.current.net_amount)}</p>
              </div>
              <div className="min-w-40 flex-1">
                <KeyValue columns={2} rows={[
                  { label: 'Gross', value: inr(data.current.gross_amount) },
                  { label: 'Deductions', value: inr(data.current.total_deductions) },
                  { label: 'Worked days', value: num(data.current.worked_days) },
                  { label: 'Overtime', value: Number(data.current.overtime_hours || 0).toFixed(2) + ' h' },
                ]} />
              </div>
              <div className="flex gap-2">
                <Link to="/portal/payslips" className="btn-ghost btn-sm">All payslips</Link>
                <button className="btn-primary btn-sm" onClick={() => downloadSlip(data.current.id, data.employee?.employee_code, data.current.period_key, toast)}>Download PDF</button>
              </div>
            </div>
          ) : <p className="text-sm text-slate-500">Your first payslip will appear here as soon as payroll runs.</p>}
        </Panel>

        <Panel title="My recent punches">
          <ul className="space-y-2 text-sm">
            {(today.data?.rows || []).map((a) => (
              <li key={a.id} className="flex items-center gap-2 rounded-lg bg-ink-850/60 px-2.5 py-1.5">
                <span className="text-slate-300">{date(a.day)}</span>
                <span className="text-xs text-slate-500">{time(a.check_in)} → {time(a.check_out)}</span>
                <span className="ml-auto"><StatusChip value={a.status} /></span>
              </li>
            ))}
            {!(today.data?.rows || []).length && <li className="text-sm text-slate-500">Nothing marked this month yet.</li>}
          </ul>
          <div className="mt-3 flex gap-2 text-xs">
            <Link to="/time-off/my-requests" className="link">Request leave</Link>
            <span className="text-slate-600">·</span>
            <Link to="/portal/payslips" className="link">Payslip archive</Link>
          </div>
        </Panel>
      </div>
    </>
  );
}

/** A plain <a href> cannot send the JWT, so the API mints a 5-minute single-purpose link. */
export async function downloadSlip(id, code, period, toast) {
  try {
    const { auth } = await import('../../api/endpoints.js');
    const out = await auth.slipToken(id);
    const link = document.createElement('a');
    link.href = out.url;
    link.download = `payslip-${code || 'me'}-${period || ''}.pdf`;
    document.body.appendChild(link);
    link.click();
    link.remove();
  } catch (e) { toast?.error(e.message); }
}
