import { useCallback, useEffect, useState } from 'react';
import { system } from '../../api/endpoints.js';
import { useApi, useAction } from '../../hooks/useApi.js';
import { PageHeader } from '../../layout/PageHeader.jsx';
import { Panel } from '../../components/ui/Panel.jsx';
import { DataTable } from '../../components/data/DataTable.jsx';
import { StatusChip } from '../../components/ui/StatusChip.jsx';
import { useToast } from '../../components/ui/Toast.jsx';
import { useCan } from '../../rbac/Can.jsx';
import { num, datetime } from '../../utils/format.js';
import { toRows } from '../../utils/query.js';

/** Queue + audit: the page you open when someone says "the PDF never arrived". */
export function SystemPage() {
  const toast = useToast();
  const mayRetry = useCan('system:queue');
  const [auto, setAuto] = useState(true);
  const [tick, setTick] = useState(0);
  const { run, busy } = useAction();
  const jobs = useApi(useCallback(() => system.jobs(), []), []);
  const tasks = useApi(useCallback(() => system.tasks({ page: 1, page_size: 25 }), [tick]), [tick]);
  const audit = useApi(useCallback(() => system.audit({ page: 1, page_size: 12 }), [tick]), [tick]);

  useEffect(() => {
    if (!auto) return undefined;
    const t = setInterval(() => setTick((n) => n + 1), 8000);
    return () => clearInterval(t);
  }, [auto]);

  const queues = jobs.data?.queues || {};
  return (
    <>
      <PageHeader title="System" subtitle="Redis is the execution plane, Postgres is the record. This screen shows both."
                  actions={<>
                    <button className="btn-ghost btn-sm" onClick={() => setAuto((v) => !v)}>{auto ? 'Pause 8s refresh' : 'Resume refresh'}</button>
                    <button className="btn-ghost btn-sm" onClick={() => { setTick((n) => n + 1); jobs.reload(); }}>Refresh</button>
                    {mayRetry && <button className="btn-primary btn-sm" disabled={!!busy} onClick={() => run('reclaim', () => system.reclaim()).then((out) => { toast.success(`Re-pushed ${out?.pushed ?? 0} stuck job(s)`); setTick((n) => n + 1); }).catch((e) => toast.error(e.message))}>{busy === 'reclaim' ? '…' : 'Reclaim stuck jobs'}</button>}
                  </>} />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {Object.entries(queues).map(([name, counts]) => (
          <div key={name} className="panel panel-pad">
            <p className="label">{name}</p>
            <p className="mt-1.5 text-2xl font-semibold text-slate-50">{num(counts.waiting + counts.delayed)}<span className="text-sm font-normal text-slate-500"> waiting</span></p>
            <p className="mt-1 text-xs text-slate-500">{num(counts.active)} running · {num(counts.completed)} done · <span className={counts.failed ? 'text-amber-300' : ''}>{num(counts.failed)} failed</span></p>
          </div>
        ))}
        {!Object.keys(queues).length && <div className="panel panel-pad text-sm text-slate-400">Queue stats unavailable — is Redis running? {jobs.error?.slice(0, 80)}</div>}
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <Panel title="Task ledger" subtitle="one row per queued job; retry re-pushes a dead one" pad={false}>
          <DataTable rows={tasks.data?.rows || tasks.data || []} loading={tasks.loading}
            columns={[
              { key: 'task_type', label: 'Type', render: (r) => (r.task_type === 'GENERATE_PDF' ? 'PDF' : r.task_type === 'SEND_EMAIL' ? 'Email' : r.task_type) },
              { key: 'status', label: 'Status', render: (r) => <StatusChip value={r.status} /> },
              { key: 'attempts', label: 'Tries', align: 'right', render: (r) => `${num(r.attempts)}/${num(r.max_attempts)}` },
              { key: 'queue_name', label: 'Queue', render: (r) => <span className="text-xs text-slate-500">{r.queue_name}</span> },
              { key: 'error_message', label: 'Error', render: (r) => (r.error_message ? <span className="text-xs text-amber-200/80">{String(r.error_message).slice(0, 60)}</span> : <span className="text-slate-600">—</span>) },
              { key: 'updated_at', label: 'Updated', render: (r) => <span className="text-xs text-slate-500">{datetime(r.updated_at)}</span> },
              { key: '_a', label: '', render: (r) => mayRetry && ['DEAD', 'FAILED'].includes(r.status) && <button className="btn-ghost btn-sm" onClick={() => run('r' + r.id, () => system.retry(r.id)).then(() => { toast.success('Retried'); setTick((n) => n + 1); }).catch((e) => toast.error(e.message))}>Retry</button> },
            ]} empty={<p className="px-4 py-6 text-sm text-slate-500">Nothing queued.</p>} />
        </Panel>
        <Panel title="Audit trail" subtitle="who changed what, newest first" pad={false}>
          <ul className="divide-y divide-line/70 text-sm">
            {toRows(audit.data).map((a) => (
              <li key={a.id} className="px-4 py-2">
                <p className="text-slate-200">{a.action} <span className="text-slate-500">on {a.entity_type || a.entity}{a.entity_id ? ' · ' + String(a.entity_id).slice(0, 8) : ''}</span></p>
                <p className="text-xs text-slate-500">{a.actor || a.actor_email || 'system'} · {datetime(a.created_at)}</p>
              </li>
            ))}
            {!toRows(audit.data).length && <li className="px-4 py-6 text-sm text-slate-500">No audit rows yet.</li>}
          </ul>
        </Panel>
      </div>
    </>
  );
}
