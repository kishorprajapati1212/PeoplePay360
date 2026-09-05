import { API_BASE, TOKEN_KEY } from '../config/app.js';
import { auth } from '../api/endpoints.js';

/**
 * Streaming endpoints (PDF, CSV, ZIP) answer with bytes, so they cannot go through the JSON client.
 * We fetch with the bearer token and hand the browser an object URL — that keeps the token out of the
 * address bar and out of server logs, and still gives the user a real "Save as" dialog.
 */
export async function download(path, filename) {
  const token = localStorage.getItem(TOKEN_KEY);
  const res = await fetch(`${API_BASE}${path}`, { headers: token ? { authorization: `Bearer ${token}` } : {} });
  if (!res.ok) throw new Error(`Download failed (${res.status})`);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename || nameFromHeaders(res.headers.get('content-disposition')) || 'download';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/**
 * A payslip PDF is streamed, and a plain <a> cannot carry a bearer token — so the API hands out a
 * five-minute link for exactly one slip and we click that instead. The backend chooses which path the
 * link uses (the payroll screen's for staff, /api/portal/… for the employee the slip belongs to),
 * which is why no page here has to know about roles.
 */
export async function downloadSlip(id, code, period) {
  const out = await auth.slipToken(id);
  const link = document.createElement('a');
  link.href = out.url;
  link.download = `payslip-${code || 'me'}-${period || ''}.pdf`;
  document.body.appendChild(link);
  link.click();
  link.remove();
}

function nameFromHeaders(header) {
  const m = header && /filename="?([^";]+)"?/i.exec(header);
  return m ? m[1] : null;
}
