import { createContext, useCallback, useEffect, useMemo, useState } from 'react';
import { auth } from '../api/endpoints.js';
import { setUnauthorizedHandler, token } from '../api/client.js';

export const AuthContext = createContext(null);

/**
 * Holds the signed-in user. The API owns the token (JWT) and the permission list; this provider only
 * keeps a copy in memory and re-validates on load, so a stale token never renders a half-screen.
 */
export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState(null);

  const loadMe = useCallback(async () => {
    if (!token.read()) { setReady(true); return; }
    try { setUser(await auth.me()); }
    catch { token.clear(); setUser(null); }
    finally { setReady(true); }
  }, []);

  useEffect(() => { loadMe(); }, [loadMe]);
  useEffect(() => { setUnauthorizedHandler(() => { token.clear(); setUser(null); }); }, []);

  const login = useCallback(async (email, password) => {
    setError(null);
    const out = await auth.login(email, password);
    token.write(out.token);
    const me = await auth.me();
    setUser(me);
    return me;
  }, []);

  const logout = useCallback(async () => {
    try { await auth.logout(); } catch { /* the token is gone either way */ }
    token.clear();
    setUser(null);
  }, []);

  /** After editing your own password every session is revoked, so the UI must go back to the door. */
  const refresh = useCallback(() => loadMe(), [loadMe]);

  const value = useMemo(() => ({ user, ready, error, login, logout, refresh, setUser }), [user, ready, error, login, logout, refresh]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
