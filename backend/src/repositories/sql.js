/** Shared SQL helpers. Repositories are the only place that writes SQL in this app. */
export const like = (v) => `%${String(v).replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
export const ident = (s) => { const ok = /^[a-z_][a-z0-9_]*$/i.test(s); if (!ok) throw new Error(`unsafe identifier: ${s}`); return s; };
const SORT = {
  name: 'e.name', employee_code: 'e.employee_code', department: 'd.name', date_of_joining: 'e.date_of_joining',
  wage: 'c.wage', email: 'e.work_email', status: 'e.status', period: 'p.period_start', gross: 'p.gross_amount', net: 'p.net_amount',
  day: 'a.day', sequence: 'r.sequence', created: 'r.created_at', type: 't.name', start: 'x.start_date', role: 'u.display_name',
  employee: 'e.name', check_in: 'a.check_in', amount: 'l.amount', month: 'p.month_anchor',
};
export const orderBy = (key, dir, fallback) => {
  const col = SORT[String(key || '').toLowerCase()];
  if (!col) return fallback;
  return `order by ${col} ${String(dir).toLowerCase() === 'desc' ? 'desc' : 'asc'}, e.id nulls last`;
};
/** Builds "where true" + $n params, so filters compose without string soup. */
export function where() {
  const clauses = []; const params = [];
  const add = (sql, ...vals) => { clauses.push(sql); params.push(...vals); return `$${params.length}`; };
  const addIdx = (vals) => { const start = params.length + 1; params.push(...vals); return start; };
  return { add, params, clauses, sql: () => (clauses.length ? `where ${clauses.join(' and ')}` : ''), next: () => `$${params.length + 1}`, addIdx };
}
export const page = (q, { defaultSize = 50, maxSize = 500 } = {}) => {
  const limit = Math.min(maxSize, Math.max(1, Number(q.pageSize || q.limit || defaultSize)));
  const offset = Math.max(0, (Math.max(1, Number(q.page || 1)) - 1) * limit);
  return { limit, offset };
};
export const money = (v) => (v === null || v === undefined ? null : Number(v));
export const paise = (v) => Math.round((Number(v) || 0) * 100);
/** Convert pg numerics to JS numbers at the edge, and keep nulls null (never 0 — that hides a gap). */
export function mapKeys(row, numericFields = []) {
  if (!row) return null;
  const out = { ...row };
  for (const f of numericFields) if (out[f] != null) out[f] = Number(out[f]);
  return out;
}
export const IN = (arr, startIdx, param = '$') => arr.map((_, i) => `${param}${startIdx + i}`).join(',');
