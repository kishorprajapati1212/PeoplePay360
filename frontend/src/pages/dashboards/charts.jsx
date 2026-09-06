import { Link } from 'react-router-dom';
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, PieChart, Pie, Cell, Legend } from 'recharts';
import { useTheme } from '../../theme.js';
import { StatusChip } from '../../components/ui/StatusChip.jsx';
import { Panel } from '../../components/ui/Panel.jsx';
import { toRows } from '../../utils/query.js';
import { inr, inrCompact, num, pct } from '../../utils/format.js';

/**
 * The chart and panel primitives the dashboards compose. Recharts paints with literal colours (SVG props
 * cannot take a class), so the charts are the one place that asks the theme module what the palette is;
 * everything else in the app is recoloured by CSS.
 */

export function ChartRow({ data, xKey }) {
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

export function TrendRow({ data }) {
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

export function StatusBreakdown({ panels }) {
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

export function AttendanceBox({ data, selfLink }) {
  if (!data) return <p className="py-8 text-center text-sm text-slate-500">No attendance marked in this period.</p>;
  const rows = [['Records', num(data.records)], ['Present', num(data.present)], ['Absent', num(data.absent)], ['Late', num(data.late)],
                ['Missing punch-out', num(data.missing_checkout)], ['OT awaiting approval', num(data.ot_pending)],
                ['Avg hours / day', Number(data.avg_worked_hours || 0).toFixed(2)], ['Coverage', pct(data.coverage_pct)]];
  return (
    <div>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
        {rows.map(([label, value]) => (
          <div key={label} className="flex items-center justify-between rounded-lg bg-ink-850/60 px-2.5 py-1.5">
            <dt className="text-xs text-slate-400">{label}</dt><dd className="tabular-nums text-slate-100">{value}</dd>
          </div>
        ))}
      </dl>
      {selfLink && <Link to={selfLink} className="mt-2 inline-block text-xs text-brand-300 hover:underline">Open attendance →</Link>}
    </div>
  );
}

/**
 * The employee's month as two pictures, shared by "My month" (/dashboard) and My Portal so the same
 * numbers look the same everywhere. Both live off GET /portal/summary — no extra round trip.
 */
export function HomeCharts({ attendance, balances, monthLabel }) {
  const { palette } = useTheme();
  const att = attendance || {};
  const mix = [
    { name: 'Present', value: Number(att.present || 0), color: palette.net },
    { name: 'On leave', value: Number(att.on_leave || 0), color: palette.brandSoft },
    { name: 'Absent', value: Number(att.absent || 0), color: palette.bad },
    { name: 'Weekend / holiday', value: Number(att.holiday || 0), color: palette.axis },
  ].filter((x) => x.value > 0);
  const days = mix.reduce((a, x) => a + x.value, 0);
  const bal = (balances || []).map((b) => ({ type: b.type, remaining: Number(b.remaining || 0), taken: Number(b.taken || 0) }));
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Panel title="My month at a glance" subtitle={monthLabel ? `${monthLabel} · ${days} recorded day${days === 1 ? '' : 's'}` : undefined}>
        {days ? (
          <div className="flex flex-col items-center gap-2 sm:flex-row">
            <div className="h-44 w-44 shrink-0">
              <ResponsiveContainer>
                <PieChart>
                  <Pie data={mix} dataKey="value" nameKey="name" innerRadius={46} outerRadius={70} paddingAngle={2} stroke="none">
                    {mix.map((x) => <Cell key={x.name} fill={x.color} />)}
                  </Pie>
                  <Tooltip contentStyle={{ background: palette.surface, border: `1px solid ${palette.grid}`, borderRadius: 8, fontSize: 12, color: palette.text }} />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <ul className="w-full space-y-1.5 text-sm">
              {mix.map((x) => (
                <li key={x.name} className="flex items-center gap-2">
                  <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: x.color }} />
                  <span className="text-slate-300">{x.name}</span>
                  <span className="ml-auto tabular-nums text-slate-100">{x.value}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : <p className="py-8 text-center text-sm text-slate-500">No attendance marked for this month yet.</p>}
      </Panel>
      <Panel title="Leave balance" subtitle="what is left of each type">
        {bal.length ? (
          <div className="h-44">
            <ResponsiveContainer>
              <BarChart data={bal} layout="vertical" margin={{ top: 4, right: 12, bottom: 0, left: 0 }}>
                <CartesianGrid stroke={palette.grid} horizontal={false} />
                <XAxis type="number" stroke={palette.axis} fontSize={11} tickLine={false} allowDecimals={false} />
                <YAxis type="category" dataKey="type" stroke={palette.axis} fontSize={11} width={110} tickLine={false} axisLine={false} />
                <Tooltip contentStyle={{ background: palette.surface, border: `1px solid ${palette.grid}`, borderRadius: 8, fontSize: 12, color: palette.text }}
                         formatter={(v, n) => [`${v} day${v === 1 ? '' : 's'}`, n === 'remaining' ? 'Left' : 'Taken']} />
                <Bar dataKey="remaining" stackId="a" fill={palette.net} radius={[0, 0, 0, 0]} />
                <Bar dataKey="taken" stackId="a" fill={palette.gross} radius={[0, 3, 3, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        ) : <p className="py-8 text-center text-sm text-slate-500">No leave balance assigned yet.</p>}
      </Panel>
    </div>
  );
}

/** Net pay across the listed runs — the payroll list's own trend strip. */
export function NetTrend({ runs }) {
  const { palette } = useTheme();
  const items = toRows(runs)
    .filter((r) => r.period_key && Number(r.total_net || 0) > 0)
    .sort((a, b) => String(a.period_key).localeCompare(String(b.period_key)))
    .slice(-8)
    .map((r) => ({ period: r.period_key, net: Number(r.total_net || 0) }));
  if (items.length < 2) return null;
  return (
    <Panel title="Net pay by period" subtitle="the runs currently in view — newest on the right" className="mt-3">
      <div className="h-44">
        <ResponsiveContainer>
          <BarChart data={items} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid stroke={palette.grid} vertical={false} />
            <XAxis dataKey="period" stroke={palette.axis} fontSize={11} tickLine={false} />
            <YAxis stroke={palette.axis} fontSize={11} tickFormatter={(v) => inrCompact(v)} tickLine={false} axisLine={false} />
            <Tooltip contentStyle={{ background: palette.surface, border: `1px solid ${palette.grid}`, borderRadius: 8, fontSize: 12, color: palette.text }}
                     formatter={(v) => [inr(v), 'Net']} />
            <Bar dataKey="net" fill={palette.net} radius={[3, 3, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </Panel>
  );
}

/** Headcount per department — the HR dashboard's picture (payroll cost charts are permission-gated). */
export function HeadcountChart({ data }) {
  const { palette } = useTheme();
  const items = (data || []).map((d) => ({ department: d.department, headcount: Number(d.headcount || 0) })).filter((x) => x.headcount > 0);
  if (!items.length) return <p className="py-10 text-center text-sm text-slate-500">No employees on the roster yet.</p>;
  return (
    <div className="h-56">
      <ResponsiveContainer>
        <BarChart data={items} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid stroke={palette.grid} vertical={false} />
          <XAxis dataKey="department" stroke={palette.axis} fontSize={11} tickLine={false} />
          <YAxis stroke={palette.axis} fontSize={11} allowDecimals={false} tickLine={false} axisLine={false} />
          <Tooltip contentStyle={{ background: palette.surface, border: `1px solid ${palette.grid}`, borderRadius: 8, fontSize: 12, color: palette.text }}
                   formatter={(v) => [v, 'People']} />
          <Bar dataKey="headcount" fill={palette.brandSoft} radius={[3, 3, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Approved vs pending leave days per type — HR sees the month's pressure at a glance. */
export function LeaveChart({ data }) {
  const { palette } = useTheme();
  const items = (data || []).map((t) => ({ type: t.type, approved: Number(t.approved_days || 0), pending: Number(t.pending || 0) }));
  if (!items.length) return <p className="py-10 text-center text-sm text-slate-500">No leave configured.</p>;
  return (
    <div className="h-56">
      <ResponsiveContainer>
        <BarChart data={items} layout="vertical" margin={{ top: 4, right: 12, bottom: 0, left: 0 }}>
          <CartesianGrid stroke={palette.grid} horizontal={false} />
          <XAxis type="number" stroke={palette.axis} fontSize={11} allowDecimals={false} tickLine={false} />
          <YAxis type="category" dataKey="type" stroke={palette.axis} fontSize={11} width={104} tickLine={false} axisLine={false} />
          <Tooltip contentStyle={{ background: palette.surface, border: `1px solid ${palette.grid}`, borderRadius: 8, fontSize: 12, color: palette.text }}
                   formatter={(v, n) => [`${v} day${v === 1 ? '' : 's'}`, n]} />
          <Bar dataKey="approved" stackId="a" fill={palette.net} />
          <Bar dataKey="pending" stackId="a" fill={palette.warn} radius={[0, 3, 3, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
