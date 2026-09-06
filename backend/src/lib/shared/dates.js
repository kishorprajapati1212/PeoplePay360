export const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const pad = (n) => String(n).padStart(2, '0');
export const toIso = (d) => {
  if (!d) return null;
  // A plain 'YYYY-MM-DD' is already the answer — routing it through new Date() would let the
  // process timezone move it a day (UTC midnight is the previous evening in the Americas).
  if (typeof d === 'string') return d.trim().slice(0, 10);
  const x = d instanceof Date ? d : new Date(d);
  return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`;
};
/** Mockup format: 02-Sep-2026 */
export const fmtDate = (d) => {
  if (!d) return '—';
  const x = new Date(d instanceof Date ? d : String(d).length <= 10 ? `${d}T00:00:00` : d);
  if (Number.isNaN(x.getTime())) return String(d);
  return `${pad(x.getDate())}-${MONTHS[x.getMonth()]}-${x.getFullYear()}`;
};
export const addDays = (d, n) => { const x = new Date(toIso(d) + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return toIso(x); };
export const daysInMonth = (y, m1) => new Date(Date.UTC(y, m1, 0)).getUTCDate();
export const monthStart = (d) => { const x = new Date(d); return `${x.getUTCFullYear()}-${pad(x.getUTCMonth() + 1)}-01`; };
export const monthEnd = (d) => { const x = new Date(d); const y = x.getUTCFullYear(), m = x.getUTCMonth() + 1; return `${y}-${pad(m)}-${pad(daysInMonth(y, m))}`; };
export const eachDay = (from, to) => { const out = []; let c = toIso(from); const end = toIso(to); let guard = 0; while (c <= end && guard++ < 400) { out.push(c); c = addDays(c, 1); } return out; };
/** ISO weekday: 1=Mon .. 7=Sun */
export const isoDow = (d) => { const x = new Date(`${toIso(d)}T00:00:00Z`); return x.getUTCDay() === 0 ? 7 : x.getUTCDay(); };
export const HALF = { FIRST: { start: 1, end: 15 }, SECOND: { start: 16, end: null } };
/** Which half of the month does [start,end] represent (if any)? */
export function halfOf(start, end) {
  const s = new Date(toIso(start)), e = new Date(toIso(end));
  const sameMonth = s.getUTCFullYear() === e.getUTCFullYear() && s.getUTCMonth() === e.getUTCMonth();
  if (!sameMonth) return null;
  const last = daysInMonth(e.getUTCFullYear(), e.getUTCMonth() + 1);
  if (s.getUTCDate() === 1 && e.getUTCDate() === 15) return 'FIRST';
  if (s.getUTCDate() === 16 && e.getUTCDate() === last) return 'SECOND';
  return null;
}
export function periodKey(start, end, payFrequency = 'MONTHLY') {
  const s = toIso(start), e = toIso(end);
  const anchor = `${s.slice(0, 7)}`;
  if (payFrequency === 'HALF_MONTH_FIRST' || halfOf(s, e) === 'FIRST') return `${anchor}-H1`;
  if (payFrequency === 'HALF_MONTH_SECOND' || halfOf(s, e) === 'SECOND') return `${anchor}-H2`;
  if (s.slice(0, 7) === e.slice(0, 7) && new Date(s).getUTCDate() === 1 && e.slice(8) === pad(daysInMonth(+e.slice(0, 4), +e.slice(5, 7)))) return anchor;
  return `${anchor}-C${String(new Date(s).getUTCDate()).padStart(2, '0')}-${String(new Date(e).getUTCDate()).padStart(2, '0')}`;
}
export function monthAnchor(start) { return `${toIso(start).slice(0, 7)}-01`; }
export function inferKind(start, end, payFrequency = 'MONTHLY') {
  if (payFrequency === 'MONTHLY' && periodKey(start, end) === toIso(start).slice(0, 7)) return 'MONTHLY';
  const h = halfOf(start, end);
  if (h === 'FIRST') return 'HALF_FIRST';
  if (h === 'SECOND') return 'HALF_SECOND';
  return 'CUSTOM';
}
export const periodLabel = (start, end) => {
  const s = new Date(toIso(start)), e = new Date(toIso(end));
  const same = s.getUTCFullYear() === e.getUTCFullYear() && s.getUTCMonth() === e.getUTCMonth();
  return same
    ? `${pad(s.getUTCDate())} → ${pad(e.getUTCDate())} ${MONTHS[e.getUTCMonth()]} ${e.getUTCFullYear()}`
    : `${fmtDate(s)} → ${fmtDate(e)}`;
};
export const monthLabel = (d) => { const x = new Date(d); return `${['January','February','March','April','May','June','July','August','September','October','November','December'][x.getUTCMonth()]} ${x.getUTCFullYear()}`; };

/**
 * The wizard promises "Period ends — blank = end of the month", and it used to be a lie: a blank end
 * date fell back to the START date, so the run covered a single day, nearly every employee looked like
 * a joiner or a leaver, and the payslips computed to pocket change. Resolving the month end here keeps
 * preview, create and every later recompute in agreement with the screen — and with each other.
 */
export function resolvePeriodEnd(period_start, period_end) {
  if (period_end) return toIso(period_end);
  const s = toIso(period_start);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const [y, m] = s.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10); // day 0 of next month = last day of this one
}
