import { useCallback, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Cell } from 'recharts';
import { dashboard, org } from '../api/endpoints.js';
import { useApi } from '../hooks/useApi.js';
import { PageHeader } from '../layout/PageHeader.jsx';
import { Panel } from '../components/ui/Panel.jsx';
import { StatCard } from '../components/ui/StatCard.jsx';
import { StatusChip } from '../components/ui/StatusChip.jsx';
import { ErrorPanel } from '../components/ui/Feedback.jsx';
import { Select } from '../components/ui/controls.jsx';
import { inr, inrCompact, num, date, periodLabel, pct } from '../utils/format.js';
import { useTheme } from '../theme.js';
import { useAuth } from '../auth/useAuth.js';
import { toRows, totalOf } from '../utils/query.js';

/**
 * Section 6 of the mockup: five KPI tiles, then the charts that explain them.
 * Every number here is real dashboard data from GET /api/dashboard — the same query the CSV reports use.
 */
export function DashboardPage({ mode = 'hr' }) {
  const { user } = useAuth();
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [departmentId, setDepartmentId] = useState('');

  const load = useCallback(() => dashboard.get({ month, department_id: departmentId || undefined }), [month, departmentId]);
  const { data, error, loading, reload } = useApi(load, [load]);
  const { data: departments } = useApi(useCallback(() => org.departments.list({}), []), []);

  const kpis = data?.kpis || {};
  const panels = data?.panels || {};
  const deptOptions = useMemo(() => toRows(departments).map((d) => ({ value: d.id, label: d.name })), [departments]);
  const payrollFirst = mode === 'payroll';

  return (
    <>
      <PageHeader
        title={payrollFirst ? 'Payroll dashboard' : 'HR dashboard'}
        subtitle={data ? `${data.period?.label || ''} · ${user?.scope === 'own' ? 'your records only' : 'filtered by the month and department below'}` : 'Loading the month…'}
        actions={
          <div className="flex items-end gap-2">
            <label className="text-right">
              <span className="label">Month</span>
              <input type="month" className="input mt-1 w-40" value={month} onChange={(e) => setMonth(e.target.value)} />
            </label>
            <label>
              <span className="label">Department</span>
              <Select className="mt-1 w-44" value={departmentId} onChange={setDepartmentId} options={deptOptions} placeholder="All departments" />
            </label>
            <button className="btn-ghost btn-sm mb-0.5" onClick={reload} disabled={loading}>{loading ? '…' : 'Refresh'}</button>
          </div>
        }
      />
      {error && <ErrorPanel error={error} onRetry={reload} />}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <StatCard label="Total payroll (net)" value={inrCompact(kpis.net_paid)} delta={kpis.change_pct} tone="money" />
        <StatCard label="Employees in period" value={num(kpis.employees)} hint={`${num(kpis.payslips_generated)} payslips generated`} />
        <StatCard label="Average cost / employee" value={inr(kpis.avg_per_employee)} hint="net pay, this month" />
        <StatCard label="Awaiting payment" value={num(kpis.payslips_pending)} tone={kpis.payslips_pending ? 'warn' : 'brand'} hint="generated, not marked paid" />
        <StatCard label="Deductions this month" value={inrCompact(kpis.deductions)} hint={`employer cost ${inrCompact(kpis.employer_cost)}`} />
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-3">
        <Panel title="Salary cost by department" subtitle="gross vs net, this month" className="xl:col-span-2">
          <ChartRow data={toRows(panels.salary_by_department)} xKey="department" />
        </Panel>
        <Panel title="Payrun status" subtitle="what the month looks like right now">
          <StatusBreakdown panels={panels} />
        </Panel>

        <Panel title="Monthly net pay trend" subtitle="last 12 months with money" className="xl:col-span-2">
          <TrendRow data={toRows(panels.net_trend)} />
        </Panel>
        <Panel title="Attendance for the period" subtitle="from the same period as payroll">
          <AttendanceBox data={panels.attendance} />
        </Panel>

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

        <Panel title="Attendance by employee" subtitle="worked hours in the period" pad={false}>
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
              </tbody>
            </table>
          </div>
        </Panel>
      </div>
    </>
  );
}

/** Recharts paints with literal colours (SVG props cannot take a class), so the chart is the one place that
 *  asks the theme module what the current palette is. Everything else in the app is recoloured by CSS. */
function ChartRow({ data, xKey }) {
  const { palette } = useTheme();
  const items = toRows(data);
  if (!items.length) return <p className="py-10 text-center text-sm text-slate-500">No payroll rows for this period yet.</p>;
  return (
    <div className="h-64">
      <ResponsiveContainer>
        <BarChart data={items} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid stroke={palette.grid} vertical={false} />
          <XAxis dataKey={xKey} stroke={palette.axis} fontSize={11} tickLine={false} />
          <YAxis stroke={palette.axis} fontSize={11} tickFormatter={(v) => inrCompact(v)} tickLine={false} axisLine={false} />
          <Tooltip contentStyle={{ background: palette.surface, border: `1px solid ${palette.grid}`, borderRadius: 8, fontSize: 12, color: palette.text }}
                   formatter={(v, n) => [inr(v), n === 'gross' ? 'Gross' : n === 'net' ? 'Net' : n === 'deductions' ? 'Deductions' : 'Employer cost']} />
          <Bar dataKey="gross" fill={palette.gross} radius={[3, 3, 0, 0]} />
          <Bar dataKey="net" fill={palette.net} radius={[3, 3, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function TrendRow({ data }) {
  const { palette } = useTheme();
  const items = toRows(data);
  if (!items.length) return <p className="py-10 text-center text-sm text-slate-500">No history yet.</p>;
  return (
    <div className="h-56">
      <ResponsiveContainer>
        <LineChart data={items} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid stroke={palette.grid} vertical={false} />
          <XAxis dataKey="month" stroke={palette.axis} fontSize={11} tickLine={false} />
          <YAxis stroke={palette.axis} fontSize={11} tickFormatter={(v) => inrCompact(v)} tickLine={false} axisLine={false} />
          <Tooltip contentStyle={{ background: palette.surface, border: `1px solid ${palette.grid}`, borderRadius: 8, fontSize: 12, color: palette.text }} formatter={(v) => inr(v)} />
          <Line type="monotone" dataKey="net" stroke={palette.net} strokeWidth={2} dot={{ r: 2 }} />
          <Line type="monotone" dataKey="gross" stroke={palette.brandSoft} strokeWidth={2} dot={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

function StatusBreakdown({ panels }) {
  const runs = toRows(panels.payruns);
  const buckets = ['DRAFT', 'COMPUTED', 'VALIDATED', 'PAID', 'VOID'].map((status) => ({ status, n: runs.filter((r) => r.status === status).length }));
  const max = Math.max(1, ...buckets.map((b) => b.n));
  return (
    <div className="space-y-2">
      {buckets.map((b) => (
        <div key={b.status} className="flex items-center gap-2">
          <span className="w-24 shrink-0"><StatusChip value={b.status} /></span>
          <div className="h-2 flex-1 rounded-full bg-ink-800">
            <div className="h-2 rounded-full bg-brand-500" style={{ width: (b.n / max) * 100 + '%' }} />
          </div>
          <span className="w-6 text-right text-xs text-slate-400">{b.n}</span>
        </div>
      ))}
      <p className="pt-2 text-xs text-slate-500">
        {runs.length} payruns in this window · {num(runs.reduce((a, r) => a + (r.emails_sent || 0), 0))} payslips emailed
      </p>
    </div>
  );
}

function AttendanceBox({ data }) {
  if (!data) return <p className="py-8 text-center text-sm text-slate-500">No attendance marked in this period.</p>;
  const rows = [['Records', num(data.records)], ['Present', num(data.present)], ['Absent', num(data.absent)], ['Late', num(data.late)],
                ['Missing punch-out', num(data.missing_checkout)], ['OT awaiting approval', num(data.ot_pending)],
                ['Avg hours / day', Number(data.avg_worked_hours || 0).toFixed(2)], ['Coverage', pct(data.coverage_pct)]];
  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
      {rows.map(([label, value]) => (
        <div key={label} className="flex items-center justify-between rounded-lg bg-ink-850/60 px-2.5 py-1.5">
          <dt className="text-xs text-slate-400">{label}</dt><dd className="tabular-nums text-slate-100">{value}</dd>
        </div>
      ))}
    </dl>
  );
}
