import { signed } from '../../utils/format.js';

/** The KPI strip at the top of the mockup's dashboard. */
export function StatCard({ label, value, hint, delta, tone = 'brand' }) {
  const tones = { brand: 'text-slate-50', money: 'text-emerald-300', warn: 'text-amber-300', bad: 'text-red-300' };
  return (
    <div className="panel panel-pad">
      <p className="label">{label}</p>
      <p className={'mt-2 text-2xl font-semibold tracking-tight ' + (tones[tone] || tones.brand)}>{value}</p>
      <div className="mt-1 flex items-center gap-2">
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
