import { useCallback, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { dashboard, org } from '../../api/endpoints.js';
import { useApi } from '../../hooks/useApi.js';
import { useAuth } from '../../auth/useAuth.js';
import { useCan } from '../../rbac/Can.jsx';
import { PageHeader } from '../../layout/PageHeader.jsx';
import { Panel } from '../../components/ui/Panel.jsx';
import { StatCard } from '../../components/ui/StatCard.jsx';
import { StatusChip } from '../../components/ui/StatusChip.jsx';
import { ErrorPanel } from '../../components/ui/Feedback.jsx';
import { Select } from '../../components/ui/controls.jsx';
import { inr, inrCompact, num, periodLabel } from '../../utils/format.js';
import { toRows } from '../../utils/query.js';
import { ChartRow, TrendRow, StatusBreakdown, AttendanceBox, HeadcountChart, LeaveChart } from './charts.jsx';

/**
 * The staff dashboard — one component, two entries in the registry (HR and payroll). Everything that
 * differs between them is a field on `entry` (the title, the shortcut), so neither half keeps a copy of the
 * layout that can drift out of sync with the other.
 *
 * Every number comes from GET /api/dashboard, which already drops the payroll panels for a role that may not
 * see them: the screen does not decide what is visible, it renders what the API answered.
 */
export function OverviewDashboard({ entry }) {
  const { user } = useAuth();
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [departmentId, setDepartmentId] = useState('');

  const load = useCallback(() => dashboard.get({ month, department_id: departmentId || undefined }), [month, departmentId]);
  const { data, error, loading, reload } = useApi(load, [load]);
  const { data: departments } = useApi(useCallback(() => org.departments.list({}), []), []);

  const kpis = data?.kpis || {};
  const panels = data?.panels || {};
  const deptOptions = useMemo(() => toRows(departments).map((d) => ({ value: d.id, label: d.name })), [departments]);
  const mayRunPayroll = useCan('payroll:payrun_create');
  const seesPayroll = !!data?.kpis;

  return (
    <>
      <PageHeader
        title={entry.title}
        subtitle={data ? `${data.period?.label || ''} · ${user?.scope === 'own' ? 'your records only' : 'filtered by the month and department below'}` : 'Loading the month…'}
        actions={
          <div className="flex flex-wrap items-end gap-2">
            {entry.showPayrunCta && mayRunPayroll && <Link to="/payruns" className="btn-primary btn-sm">Payruns</Link>}
            <label className="text-right">
              <span className="label">Month</span>
              <input type="month" className="input mt-1 w-40" value={month} onChange={(e) => setMonth(e.target.value)} />
            </label>
            <label>
              <span className="label">Department</span>
              <Select className="mt-1 w-44" value={departmentId} onChange={setDepartmentId} options={deptOptions} placeholder="All departments" />
            </label>
            <button className="btn-ghost btn-sm" onClick={reload} disabled={loading}>{loading ? '…' : 'Refresh'}</button>
          </div>
        }
      />
      {error && <ErrorPanel error={error} onRetry={reload} />}
      {data?.restricted && (
        <p className="mb-3 rounded-lg border border-line bg-ink-900 px-3 py-2 text-xs text-slate-400">
          {data.restricted} — the panels below are the ones your role is allowed to read.
        </p>
      )}

      {seesPayroll && (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          <StatCard label="Total payroll (net)" value={inrCompact(kpis.net_paid)} delta={kpis.change_pct} tone="money" />
          <StatCard label="Employees in period" value={num(kpis.employees)} hint={`${num(kpis.payslips_generated)} payslips generated`} />
          <StatCard label="Average cost / employee" value={inr(kpis.avg_per_employee)} hint="net pay, this month" />
          <StatCard label="Awaiting payment" value={num(kpis.payslips_pending)} tone={kpis.payslips_pending ? 'warn' : 'brand'} hint="generated, not marked paid" />
          <StatCard label="Deductions this month" value={inrCompact(kpis.deductions)} hint={`employer cost ${inrCompact(kpis.employer_cost)}`} />
        </div>
      )}

      <div className="mt-4 grid gap-4 xl:grid-cols-3">
        {seesPayroll && (
          <>
            <Panel title="Salary cost by department" subtitle="gross vs net, this month" className="xl:col-span-2">
              <ChartRow data={toRows(panels.salary_by_department)} xKey="department" />
            </Panel>
            <Panel title="Payrun status" subtitle="what the month looks like right now">
              <StatusBreakdown panels={panels} />
            </Panel>
            <Panel title="Monthly net pay trend" subtitle="last 12 months with money" className="xl:col-span-2">
              <TrendRow data={toRows(panels.net_trend)} />
            </Panel>
          </>
        )}
        {/* The HR view never had a picture: every chart sat behind the payroll permission, so an HR
            manager landed on tables only. These two use panels the API already sends for HR. */}
        {!seesPayroll && (
          <>
            <Panel title="Headcount by department" subtitle="people on the roster today" className="xl:col-span-2">
              <HeadcountChart data={toRows(panels.departments)} />
            </Panel>
            <Panel title="Leave days by type" subtitle="approved vs pending, this period">
              <LeaveChart data={toRows(panels.time_off)} />
            </Panel>
          </>
        )}
        <Panel title="Attendance for the period" subtitle="from the same period as payroll" className={seesPayroll ? '' : 'xl:col-span-2'}>
          <AttendanceBox data={panels.attendance} selfLink={seesPayroll ? '/attendance' : null} />
        </Panel>

        {seesPayroll && (
          <Panel title="Payruns" subtitle="latest runs, newest first" pad={false} className="xl:col-span-2">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-ink-850/60">
                  <tr><th className="th">Payrun</th><th className="th">Period</th><th className="th">Status</th><th className="th text-right">Employees</th><th className="th text-right">Net</th></tr>
                </thead>
                <tbody>
                  {toRows(panels.payruns).slice(0, 8).map((r) => (
                    <tr key={r.id} className="row">
                      <td className="td"><Link to={'/payruns/' + r.id} className="link">{r.name}</Link></td>
                      <td className="td text-slate-400">{periodLabel(r.period_key)}</td>
                      <td className="td"><StatusChip value={r.status} /></td>
                      <td className="td text-right">{num(r.employee_count)}</td>
                      <td className="td text-right">{inr(r.total_net)}</td>
                    </tr>
                  ))}
                  {!toRows(panels.payruns).length && <tr><td className="td text-slate-500" colSpan={5}>No payruns in this period.</td></tr>}
                </tbody>
              </table>
            </div>
          </Panel>
        )}

        <Panel title="Health & alerts" subtitle="aggregated by the API, not computed here" pad={false}>
          <ul className="divide-y divide-line/70">
            {toRows(panels.alerts).map((a) => (
              <li key={a.code} className="flex items-start gap-3 px-4 py-2.5 text-sm">
                <span className="chip border-amber-500/30 bg-amber-500/10 text-amber-300">{num(a.n)}</span>
                <span className="text-slate-300">{a.label}</span>
                <Link to={'/' + (a.entity === 'payrun' ? 'payruns' : a.entity === 'payslip' ? 'payslips' : 'employees')} className="ml-auto text-xs text-brand-300 hover:underline">open</Link>
              </li>
            ))}
            {!toRows(panels.alerts).length && <li className="px-4 py-3 text-sm text-slate-500">Nothing needs attention.</li>}
          </ul>
        </Panel>

        <Panel title="Department overview" subtitle="headcount and monthly wage cost" pad={false}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-ink-850/60"><tr><th className="th">Department</th><th className="th text-right">People</th><th className="th text-right">Wage cost</th></tr></thead>
              <tbody>
                {toRows(panels.departments).map((d) => (
                  <tr key={d.department_id || d.department} className="row">
                    <td className="td">{d.department}</td><td className="td text-right">{num(d.headcount)}</td><td className="td text-right">{inr(d.monthly_wage_cost)}</td>
                  </tr>
                ))}
                {!toRows(panels.departments).length && <tr><td className="td text-slate-500" colSpan={3}>No departments yet.</td></tr>}
              </tbody>
            </table>
          </div>
        </Panel>

        <Panel title="Time off this period" pad={false}>
          <table className="w-full text-sm">
            <thead className="bg-ink-850/60"><tr><th className="th">Type</th><th className="th text-right">Approved</th><th className="th text-right">Pending</th><th className="th text-right">Balance</th></tr></thead>
            <tbody>
              {toRows(panels.time_off).map((t) => (
                <tr key={t.type} className="row">
                  <td className="td">{t.type}</td><td className="td text-right">{num(t.approved_days)}</td>
                  <td className="td text-right">{num(t.pending)}</td><td className="td text-right">{num(t.remaining_balance)}</td>
                </tr>
              ))}
              {!toRows(panels.time_off).length && <tr><td className="td text-slate-500" colSpan={4}>No leave configured.</td></tr>}
            </tbody>
          </table>
        </Panel>

        <Panel title="Attendance by employee" subtitle="worked hours in the period" pad={false} className="xl:col-span-2">
          <div className="max-h-72 overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="bg-ink-850/60"><tr><th className="th">Employee</th><th className="th">Dept</th><th className="th text-right">Hours</th><th className="th text-right">OT</th><th className="th text-right">Absent</th></tr></thead>
              <tbody>
                {toRows(panels.attendance_by_employee).slice(0, 20).map((r) => (
                  <tr key={r.id} className="row">
                    <td className="td"><Link to={'/employees/' + r.id} className="link">{r.employee}</Link></td>
                    <td className="td text-slate-400">{r.department}</td>
                    <td className="td text-right">{Number(r.worked_hours || 0).toFixed(1)}</td>
                    <td className="td text-right">{num(r.overtime_hours)}</td>
                    <td className="td text-right">{num(r.absent)}</td>
                  </tr>
                ))}
                {!toRows(panels.attendance_by_employee).length && <tr><td className="td text-slate-500" colSpan={5}>No attendance rows for this period.</td></tr>}
              </tbody>
            </table>
          </div>
        </Panel>
      </div>
    </>
  );
}
