import { API_BASE, TOKEN_KEY } from '../config/app.js';

/** Thrown for every non-2xx answer so pages can show `error.message` and nothing else. */
export class ApiError extends Error {
  constructor(message, { status, code, details, fieldErrors } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
    this.fieldErrors = fieldErrors || null;
  }
}

export const token = {
  read: () => localStorage.getItem(TOKEN_KEY),
  write: (value) => localStorage.setItem(TOKEN_KEY, value),
  clear: () => localStorage.removeItem(TOKEN_KEY),
};

let onUnauthorized = () => {};
/** AuthContext registers a handler so a 401 anywhere lands the user back on the login screen. */
export function setUnauthorizedHandler(fn) { onUnauthorized = fn; }

async function request(method, path, { body, query, raw = false, signal } = {}) {
  const url = API_BASE + path + (query ? `?${new URLSearchParams(clean(query))}` : '');
  const headers = {};
  const jwt = token.read();
  if (jwt) headers.authorization = `Bearer ${jwt}`;
  if (body !== undefined) headers['content-type'] = 'application/json';
  const res = await fetch(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal });
  if (res.status === 401 && !path.startsWith('/auth/login')) { onUnauthorized(); }
  if (raw) return res;
  const text = await res.text();
  const data = text ? safeJson(text) : null;
  if (!res.ok) throw toApiError(res, data);
  return data;
}

function clean(obj) {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined && v !== null && v !== ''));
}
function safeJson(text) { try { return JSON.parse(text); } catch { return { message: text.slice(0, 200) }; } }
/**
 * The API reports a refused request as { error: { code, message, details } }, and for a rejected form
 * `details.fields` lists what is wrong with each box. That list is turned into { field: message } here, so
 * a dialog can write the reason under the field it belongs to — and the headline text says what to fix
 * instead of only "Some fields need attention".
 */
function toApiError(res, data) {
  const payload = data && (data.error || data);
  const code = payload?.code || payload?.error?.code;
  const fields = Array.isArray(payload?.details?.fields) ? payload.details.fields : [];
  const fieldErrors = fields.length ? Object.fromEntries(fields.map((f) => [f.field, f.message]))
    : (payload?.details?.fieldErrors || payload?.fieldErrors || null);
  const named = fields.map((f) => (f.field === '(root)' ? '' : f.field + ': ') + f.message).join(' · ');
  const message = named || payload?.message || payload?.error || `Request failed with status ${res.status}`;
  return new ApiError(typeof message === 'string' ? message : JSON.stringify(message), { status: res.status, code, details: payload?.details, fieldErrors });
}

export const api = {
  get: (path, query, opts) => request('GET', path, { query, ...opts }),
  post: (path, body, opts) => request('POST', path, { body, ...opts }),
  patch: (path, body, opts) => request('PATCH', path, { body, ...opts }),
  put: (path, body, opts) => request('PUT', path, { body, ...opts }),
  del: (path, opts) => request('DELETE', path, opts),
};
