import { useCallback } from 'react';
import { Link } from 'react-router-dom';
import { portal } from '../../api/endpoints.js';
import { useApi } from '../../hooks/useApi.js';
import { PageHeader } from '../../layout/PageHeader.jsx';
import { Panel } from '../../components/ui/Panel.jsx';
import { PunchCard } from '../../components/attendance/PunchCard.jsx';
import { KeyValue, ErrorPanel } from '../../components/ui/Feedback.jsx';
import { StatusChip } from '../../components/ui/StatusChip.jsx';
import { useToast } from '../../components/ui/Toast.jsx';
import { useCan } from '../../rbac/Can.jsx';
import { downloadSlip } from '../../utils/download.js';
import { inr, num, date, time, periodLabel } from '../../utils/format.js';
import { toRows, totalOf } from '../../utils/query.js';
import { HomeCharts } from '../dashboards/charts.jsx';

/** Employee home: the three things people actually look for — did my punch land, how long have I
 *  worked today, and what did I get paid. */
export function MyPortalPage() {
  const toast = useToast();
  const summary = useApi(useCallback(() => portal.summary(), []), []);
  const today = useApi(useCallback(() => portal.attendance({ page: 1, page_size: 5 }), []), []);
  const canClock = useCan('attendance:clock');
  // the punch card reads the summary's today row; a punch bumps both fetches
  const reloadBoth = useCallback(() => { summary.reload(); today.reload(); }, [summary, today]);

  if (summary.error) return <ErrorPanel error={summary.error} onRetry={summary.reload} />;
  const data = summary.data;
  if (!data) return <Panel><p className="text-sm text-slate-400">Loading your portal…</p></Panel>;
  if (data.error) return <Panel><p className="text-sm text-amber-200">{data.error.message || 'This login is not linked to an employee record yet.'}</p></Panel>;

  // Field names as the API actually sends them (portal.service.summary): last_payslip, attendance,
  // leave_balances, stats. The card strip used to read keys that were never in the payload
  // (data.current, data.monthly, data.stats?.present), so it happily showed zeros forever.
  const slip = data.last_payslip;
  const att = data.attendance || {};
  const leaveRows = toRows(data.leave_balances);
  const leaveTotal = leaveRows.reduce((sum, b) => sum + Number(b.remaining ?? 0), 0);
  const cards = [
    { label: 'Net this month', value: inr(slip?.net_amount), hint: slip ? periodLabel(slip.period_key) : 'no payslip yet', icon: <><rect x="2.5" y="6" width="19" height="13" rx="3" /><path d="M2.5 10h19" /><path d="M6 15h4" /></> },
    { label: 'Attendance this month', value: num(att.present) + ' present', hint: `${num(att.absent)} absent · ${num(att.on_leave)} on leave · ${num(att.holiday)} holidays`, icon: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3.5 2" /></> },
    { label: 'Leave balance', value: num(leaveTotal) + ' days', hint: leaveRows.map((b) => `${b.type} ${b.remaining}`).join(' · ') || 'none assigned yet', icon: <><rect x="3" y="5" width="18" height="16" rx="3" /><path d="M8 3v4M16 3v4M3 10h18" /></> },
    { label: 'Payslips', value: num(data.stats?.payslips), hint: `${num(data.stats?.paid)} paid · YTD ${inr(data.stats?.ytd_net)}`, icon: <><path d="M6 2.5h12v19l-3-2-3 2-3-2-3 2z" /><path d="M9 7.5h6M9 11.5h6" /></> },
  ];

  return (
    <>
      <PageHeader title={`Hello, ${data.employee?.name?.split(' ')[0] || data.name || ''}`}
                  subtitle={data.employee ? `${data.employee.code || data.employee.employee_code || ''} · ${data.employee.job_position || ''} · ${data.employee.department || ''}` : 'Your login is not linked to an employee record yet.'} />

      {/* The day's punch: state, live hours, and the button that names the next action. */}
      {canClock && (
        <div className="mb-4">
          <PunchCard today={data.today_attendance} onDone={reloadBoth} />
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map((c) => (
          <div key={c.label} className="panel panel-pad group">
            <div className="flex items-start justify-between gap-2">
              <p className="label">{c.label}</p>
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-brand-500/12 text-brand-300 transition-colors group-hover:bg-brand-500/20">
                <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{c.icon}</svg>
              </span>
            </div>
            <p className="num mt-2 text-xl font-semibold tracking-tight text-slate-50">{c.value}</p>
            <p className="mt-1 truncate text-xs text-slate-500">{c.hint}</p>
          </div>
        ))}
      </div>

      <div className="mt-4">
        <HomeCharts attendance={att} balances={leaveRows} monthLabel={data?.period?.label} />
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-3">
        <Panel className="xl:col-span-2" title="Last payslip" subtitle={slip ? `document v${num(slip.document_version || 1)} · ${slip.status}` : 'nothing issued yet'}>
          {slip ? (
            <div className="flex flex-wrap items-center gap-6">
              <div>
                <p className="label">Net pay</p>
                <p className="num mt-1 text-3xl font-semibold tracking-tight text-emerald-300">{inr(slip.net_amount)}</p>
              </div>
              <div className="min-w-40 flex-1">
                <KeyValue columns={2} rows={[
                  { label: 'Gross', value: inr(slip.gross_amount) },
                  { label: 'Deductions', value: inr(slip.total_deductions) },
                  { label: 'Worked days', value: num(slip.worked_days) },
                  { label: 'Overtime', value: Number(slip.overtime_hours || 0).toFixed(2) + ' h' },
                ]} />
              </div>
              <div className="flex gap-2">
                <Link to="/portal/payslips" className="btn-ghost btn-sm">All payslips</Link>
                <button className="btn-primary btn-sm" onClick={() => downloadSlip(slip.id, data.employee?.employee_code, slip.period_key).catch((e) => toast.error(e.message))}>Download PDF</button>
              </div>
            </div>
          ) : <p className="text-sm text-slate-500">Your first payslip will appear here as soon as payroll runs.</p>}
        </Panel>

        <Panel title="My recent punches">
          <ul className="space-y-2 text-sm">
            {toRows(today.data).map((a) => {
              const punches = Array.isArray(a.punches) && a.punches.length
                ? a.punches : (a.check_in ? [{ in: a.check_in, out: a.check_out || null }] : []);
              const open = punches.some((s) => !s.out);
              return (
                <li key={a.id} className="flex items-center gap-2 rounded-xl bg-ink-850/60 px-2.5 py-1.5">
                  <span className={'h-1.5 w-1.5 shrink-0 rounded-full ' + (open ? 'bg-good' : 'bg-slate-600')} />
                  <span className="text-slate-300">{date(a.day)}</span>
                  <span className="num text-xs text-slate-500">
                    {time(punches[0]?.in ?? a.check_in)} → {open ? <span className="text-good">now</span> : time(punches[punches.length - 1]?.out ?? a.check_out)}
                    {punches.length > 1 && ` · ${punches.length} sessions`}
                  </span>
                  <span className="ml-auto"><StatusChip value={a.status} /></span>
                </li>
              );
            })}
            {!toRows(today.data).length && <li className="text-sm text-slate-500">Nothing marked this month yet.</li>}
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
