import { useEffect, useState } from 'react';
import { api } from '../api/client.js';
import { setCompanyTimezone } from './format.js';

/**
 * States and leave categories come from GET /api/meta, which answers from the same arrays the API's own
 * validators check against. Cached at module level, so thirty employee rows do not mean thirty requests,
 * and never duplicated into a client-side constant that could disagree with the server.
 */
let cached = null;
let pending = null;
export function picklists() {
  if (cached) return Promise.resolve(cached);
  if (!pending) {
    pending = api.get('/meta')
      .then((out) => { setCompanyTimezone(out && out.timezone); cached = normalise(out); return cached; })
      .catch((e) => { pending = null; throw e; });
  }
  return pending;
}
const normalise = (out = {}) => ({
  states: (out.states || []).map((s) => ({ value: s, label: s, hint: (out.pt_states || []).includes(s) ? 'Professional Tax applies here' : '' })),
  ptStates: (out.pt_states || []).map((s) => ({ value: s, label: s })),
  leaveCategories: out.leave_categories || [],
});

/** Hook form: pages render a Select with `loading` and `error` while the list is on its way. */
export function usePicklists() {
  const [state, setState] = useState({ loading: !cached, error: null, data: cached || { states: [], ptStates: [], leaveCategories: [] } });
  useEffect(() => {
    let alive = true;
    picklists().then((data) => { if (alive) setState({ loading: false, error: null, data }); })
      .catch((e) => { if (alive) setState((s) => ({ ...s, loading: false, error: e.message })); });
    return () => { alive = false; };
  }, []);
  return { ...state.data, ...state };
}

/** The label a form should show when the stored value is not one of the choices (an old free-text entry). */
export function keepCurrentValue(options, value) {
  const v = String(value ?? '').trim();
  if (!v || options.some((o) => o.value === v)) return options;
  return [{ value: v, label: v, hint: 'kept as recorded — not one of the listed states' }, ...options];
}
