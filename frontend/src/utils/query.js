/** Small helpers for building the ?query an API list endpoint expects. */
export function toQuery(params = {}) {
  const usp = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    usp.set(key, String(value));
  }
  const s = usp.toString();
  return s ? `?${s}` : '';
}
/** Turn a form object into a PATCH body: only keys that actually changed. */
export function changedKeys(initial, next) {
  const out = {};
  for (const [key, value] of Object.entries(next)) {
    const before = initial[key] ?? '';
    if (String(before) !== String(value ?? '')) out[key] = value === '' ? null : value;
  }
  return out;
}
export function debounce(fn, ms = 350) {
  let timer;
  return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), ms); };
}
