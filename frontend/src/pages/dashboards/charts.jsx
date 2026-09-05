import { Link } from 'react-router-dom';
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { useTheme } from '../../theme.js';
import { StatusChip } from '../../components/ui/StatusChip.jsx';
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
          {/* 2px ends, deliberately: at 8px tall a full radius makes each end a semicircle, and on a wide
              desktop bar that reads as a round shape stuck in the middle of the panel. */}
          <div className="h-2 flex-1 overflow-hidden rounded-sm bg-ink-800">
            <div className="h-2 bg-brand-500" style={{ width: (b.n / max) * 100 + '%' }} />
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
