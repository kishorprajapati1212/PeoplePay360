export function EmptyState({ title = 'Nothing here yet', hint, action }) {
  return (
    <div className="flex flex-col items-center gap-2 py-12 text-center">
      <div className="text-2xl">◇</div>
      <p className="text-sm font-medium text-slate-200">{title}</p>
      {hint && <p className="max-w-md text-xs text-slate-400">{hint}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function ErrorPanel({ error, onRetry }) {
  if (!error) return null;
  const text = typeof error === 'string' ? error : error.message || 'Something went wrong';
  return (
    <div className="rounded-lg border border-bad/40 bg-red-950/40 px-3 py-2 text-sm text-red-200">
      <div className="flex items-start justify-between gap-3">
        <span>{text}</span>
        {onRetry && <button className="btn-ghost btn-sm" onClick={onRetry}>Retry</button>}
      </div>
    </div>
  );
}

/** Shown when a route exists but the signed-in role has no permission for it. */
export function NoAccess({ permission, path }) {
  return (
    <div className="panel panel-pad">
      <h2 className="text-sm font-semibold text-slate-100">This screen is not part of your role</h2>
      <p className="mt-1 text-sm text-slate-400">
        It needs the permission <code className="rounded bg-ink-800 px-1.5 py-0.5 text-xs text-amber-200">{permission || path}</code>.
        Access is defined in <code className="rounded bg-ink-800 px-1.5 py-0.5 text-xs text-slate-300">backend/src/lib/shared/permissions.js</code>.
      </p>
    </div>
  );
}

export function KeyValue({ rows, columns = 2 }) {
  const pairs = rows.filter((r) => r && r.value !== undefined && r.value !== null && r.value !== '');
  return (
    <dl className={'grid gap-x-6 gap-y-3 ' + (columns === 2 ? 'sm:grid-cols-2' : 'grid-cols-1')}>
      {pairs.map((r) => (
        <div key={r.label}>
          <dt className="label">{r.label}</dt>
          <dd className="mt-1 text-sm text-slate-100">{typeof r.value === 'boolean' ? (r.value ? 'Yes' : 'No') : (r.render ? r.render(r.value) : String(r.value ?? '—'))}</dd>
        </div>
      ))}
    </dl>
  );
}
