import { signed } from '../../utils/format.js';

/** The KPI strip at the top of the dashboards. `icon` is an optional <svg> child; tones colour the value. */
export function StatCard({ label, value, hint, delta, tone = 'brand', icon }) {
  const tones = { brand: 'text-slate-50', money: 'text-emerald-300', warn: 'text-amber-300', bad: 'text-red-300' };
  return (
    <div className="panel panel-pad group relative overflow-hidden">
      {/* a whisper of accent in the top-right corner, so a row of these reads as one system */}
      <div aria-hidden className="pointer-events-none absolute inset-0 opacity-60 transition-opacity group-hover:opacity-100"
           style={{ background: 'radial-gradient(160px 80px at 92% -20%, rgb(var(--brand-500) / 0.14), transparent 70%)' }} />
      <div className="relative flex items-start justify-between gap-2">
        <p className="label">{label}</p>
        {icon && (
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-brand-500/12 text-brand-300 transition-colors group-hover:bg-brand-500/20">
            {icon}
          </span>
        )}
      </div>
      <p className={'num relative mt-2 text-[26px] font-semibold tracking-tight ' + (tones[tone] || tones.brand)}>{value}</p>
      <div className="relative mt-1 flex flex-wrap items-center gap-2">
        {delta !== undefined && delta !== null && (
          <span className={'chip ' + (Number(delta) >= 0 ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300' : 'border-red-500/30 bg-red-500/10 text-red-300')}>
            {signed(delta)} vs last month
          </span>
        )}
        {hint && <span className="text-xs text-slate-500">{hint}</span>}
      </div>
    </div>
  );
}
