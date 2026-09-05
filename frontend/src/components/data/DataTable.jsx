import { EmptyState, ErrorPanel } from '../ui/Feedback.jsx';
import { Spinner } from '../ui/Spinner.jsx';

/**
 * One table for every list screen. `columns` decides what is shown; a column may bring its own
 * `render(row)` or just name a field. Sorting is opt-in per column (`sort: 'field'`).
 */
export function DataTable({ columns, rows = [], loading, error, onRetry, onRowClick, toolbar, pagination, empty, rowClassName, onSort }) {
  return (
    <div>
      {toolbar && <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">{toolbar}</div>}
      {error && <div className="p-4"><ErrorPanel error={error} onRetry={onRetry} /></div>}
      {loading && !rows.length ? (
        <div className="p-8"><Spinner label="Loading…" /></div>
      ) : !rows.length ? (
        empty || <EmptyState />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead className="bg-ink-850/60">
              <tr>
                {columns.map((c) => (
                  <th key={c.key} className={'th ' + (c.align === 'right' ? 'text-right ' : '') + (c.width || '')}>
                    {c.sort ? <button className="hover:text-slate-200" onClick={() => onSort?.(c)}>{c.label} ↕</button> : c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={row.id ?? i}
                    onClick={onRowClick ? () => onRowClick(row) : undefined}
                    className={'row ' + (onRowClick ? 'cursor-pointer ' : '') + (rowClassName?.(row) || '')}>
                  {columns.map((c) => (
                    <td key={c.key} className={'td ' + (c.align === 'right' ? 'text-right tabular-nums ' : '')}>
                      {c.render ? c.render(row) : formatCell(row[c.key])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {pagination && <Pagination {...pagination} />}
    </div>
  );
}

function formatCell(value) {
  if (value === null || value === undefined || value === '') return <span className="text-slate-600">—</span>;
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  return String(value);
}

/** Page X of Y with a page-size picker; `total` comes straight from the API envelope. */
export function Pagination({ page = 0, size = 20, total = 0, onPage, onSize }) {
  const pages = Math.max(1, Math.ceil((Number(total) || 0) / size));
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-4 py-2.5 text-xs text-slate-400">
      <span>{Number(total).toLocaleString('en-IN')} rows · page {page + 1} of {pages}</span>
      <div className="flex items-center gap-2">
        <select className="input w-auto px-2 py-1 text-xs" value={size} onChange={(e) => onSize?.(Number(e.target.value))}>
          {[10, 20, 50, 100].map((n) => <option key={n} value={n}>{n} / page</option>)}
        </select>
        <button className="btn-ghost btn-sm" disabled={page === 0} onClick={() => onPage?.(page - 1)}>Prev</button>
        <button className="btn-ghost btn-sm" disabled={page + 1 >= pages} onClick={() => onPage?.(page + 1)}>Next</button>
      </div>
    </div>
  );
}
