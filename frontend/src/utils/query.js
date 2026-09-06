/**
 * `toRows(answer)` — the list endpoints come back in two shapes: paged ones `{ rows, total, page }`,
 * plain lookups (departments, schedules, structures, leave types, PT slabs) as a bare array or `{ rows }`.
 * Every screen that iterates an API answer goes through this, so a shape change on one endpoint cannot
 * white-screen a page. Also tolerates null (the first render, before the fetch resolves).
 */
export function toRows(x) {
  if (Array.isArray(x)) return x;
  if (Array.isArray(x?.rows)) return x.rows;
  if (Array.isArray(x?.items)) return x.items;
  if (Array.isArray(x?.data)) return x.data;
  // last resort: a few endpoints name their list after the domain (payrun preview → employees)
  if (Array.isArray(x?.employees)) return x.employees;
  return [];
}
/** The matching total, for the few screens that show "N rows" without paging. */
export const totalOf = (x, fallback = 0) => Number(x?.total ?? x?.count ?? (Array.isArray(x) ? x.length : fallback)) || 0;

/** Keep typing from from hammering the API. */
export function debounce(fn, ms = 350) {
  let timer;
  return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), ms); };
}
