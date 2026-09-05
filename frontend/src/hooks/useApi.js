import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * The smallest data hook the app needs: call a function, keep the result, re-run on demand.
 * `deps` is the same idea as useEffect — pass the filters that should trigger a reload.
 */
export function useApi(loader, deps = [], { immediate = true } = {}) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(immediate);
  const alive = useRef(true);
  const fn = useCallback(loader, deps);

  useEffect(() => () => { alive.current = false; }, []);
  const run = useCallback(async () => {
    setLoading(true);
    try {
      const out = await fn();
      if (alive.current) { setData(out); setError(null); }
      return out;
    } catch (e) {
      if (alive.current) setError(e.message || 'Request failed');
      return null;
    } finally { if (alive.current) setLoading(false); }
  }, [fn]);

  useEffect(() => { if (immediate) run(); }, [run]);
  return { data, error, loading, reload: run, setData };
}

/** Write helper: tracks "in flight" per action so a button can disable itself while saving. */
export function useAction() {
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const run = useCallback(async (key, fn) => {
    setBusy(key); setError(null);
    try { return await fn(); }
    catch (e) { setError(e.message || 'Could not complete that'); throw e; }
    finally { setBusy(null); }
  }, []);
  return { busy, error, run, setBusy };
}
