import { useCallback } from 'react';
import { Link } from 'react-router-dom';
import { timeOff } from '../../api/endpoints.js';
import { useApi } from '../../hooks/useApi.js';
import { PageHeader } from '../../layout/PageHeader.jsx';
import { Panel } from '../../components/ui/Panel.jsx';
import { StatusChip } from '../../components/ui/StatusChip.jsx';
import { ErrorPanel } from '../../components/ui/Feedback.jsx';
import { num, date } from '../../utils/format.js';
import { toRows, totalOf } from '../../utils/query.js';

/** Time-off landing screen: what is pending, what the balances look like, which types exist. */
export function TimeOffOverviewPage() {
  const overview = useApi(useCallback(() => timeOff.overview({}), []), []);
  const pending = useApi(useCallback(() => timeOff.requests.list({ status: 'PENDING', page: 1, page_size: 8 }), []), []);
  const types = useApi(useCallback(() => timeOff.types.list({}), []), []);
  const data = overview.data || {};

  return (
    <>
      <PageHeader title="Time off" subtitle="Leave policy in one place: types, allocations and the queue that HR has to clear."
                  actions={<Link className="btn-primary btn-sm" to="/time-off/requests">Open requests</Link>} />
      {overview.error && <ErrorPanel error={overview.error} onRetry={overview.reload} />}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[['Pending requests', num(data.pending ?? pending.data?.total ?? 0), 'needs a decision'],
          ['Approved this period', num(data.approved ?? 0), 'days booked off'],
          ['Unpaid', num(data.unpaid ?? 0), 'days that cut pay'],
          ['Leave types', num(toRows(types.data).length), 'configured']].map(([label, value, hint]) => (
          <div key={label} className="panel panel-pad">
            <p className="label">{label}</p>
            <p className="mt-1.5 text-2xl font-semibold text-slate-50">{value}</p>
            <p className="text-xs text-slate-500">{hint}</p>
          </div>
        ))}
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-3">
        <Panel className="xl:col-span-2" title="Waiting for you" subtitle="oldest first" pad={false}>
          <ul className="divide-y divide-line/70">
            {toRows(pending.data).map((r) => (
              <li key={r.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-slate-100">{r.employee}</span>
                  <span className="block text-xs text-slate-500">{r.type} · {date(r.start_date)} → {date(r.end_date)} · {num(r.duration)} {String(r.duration_unit || 'days').toLowerCase()}</span>
                </span>
                <StatusChip value={r.status} />
                <Link to="/time-off/requests" className="btn-ghost btn-sm">Decide</Link>
              </li>
            ))}
            {!toRows(pending.data).length && <li className="px-4 py-6 text-sm text-slate-500">Nothing is waiting. Good.</li>}
          </ul>
        </Panel>

        <Panel title="Types" pad={false}>
          <ul className="divide-y divide-line/70">
            {toRows(types.data).map((t) => (
              <li key={t.id} className="flex items-center justify-between gap-2 px-4 py-2 text-sm">
                <span className="flex items-center gap-2">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ background: t.display_color || '#6366f1' }} />
                  <span className="text-slate-200">{t.name}</span>
                </span>
                <span className="text-xs text-slate-500">{t.unit === 'HALF_DAY' ? 'half days' : t.unit?.toLowerCase() || 'days'}{t.is_unpaid ? ' · unpaid' : ''}</span>
              </li>
            ))}
          </ul>
          <div className="px-4 py-3 text-xs"><Link to="/time-off/types" className="link">Configure types</Link> · <Link to="/time-off/allocations" className="link">Allocations</Link></div>
        </Panel>
      </div>
    </>
  );
}
