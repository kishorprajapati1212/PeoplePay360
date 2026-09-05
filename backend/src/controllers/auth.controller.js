import * as svc from '../services/auth.service.js';
import * as userSvc from '../services/user.service.js';
import { config } from '../config.js';
import { ok } from './_http.js';
const REFRESH = 'pp360_rt';
const cookieOpts = () => ({ httpOnly: true, sameSite: config.cookies.sameSite, secure: config.cookies.secure, path: '/api/auth', maxAge: config.jwt.refreshTtlDays * 86400000, domain: config.cookies.domain });
export async function login(req, res) {
  const out = await svc.login(req.valid.body, { ip: req.ip, userAgent: req.headers['user-agent'] });
  res.cookie(REFRESH, out.refreshToken, cookieOpts());
  ok(res, { token: out.accessToken, token_type: 'Bearer', expires_in: out.expiresIn, user: out.user, must_change_password: out.user.mustChangePassword });
}
export async function refresh(req, res) {
  const out = await svc.refresh({ refreshToken: req.cookies?.[REFRESH] });
  res.cookie(REFRESH, out.refreshToken, cookieOpts());
  ok(res, { token: out.accessToken, expires_in: out.expiresIn, user: out.user });
}
export async function logout(req, res) {
  await svc.logout({ refreshToken: req.cookies?.[REFRESH], userId: req.auth.userId, all: req.valid.query.all === true });
  res.clearCookie(REFRESH, { ...cookieOpts(), maxAge: undefined });
  ok(res, { ok: true, note: 'Refresh token revoked; access token still expires on its own' });
}
export const me = async (req, res) => ok(res, await svc.me(req.auth.userId));
export const accessMatrix = async (req, res) => ok(res, await userSvc.accessMatrix());
/** The two public halves of an invitation: what does this link point at, and finishing it. */
export async function inviteInfo(req, res) {
  ok(res, await userSvc.readInvite(req.params.token));
}
export async function setPassword(req, res) {
  ok(res, await userSvc.completeInvite(req.valid.body.token, req.valid.body.password));
}
export async function changePassword(req, res) {
  const out = await svc.changePassword({ userId: req.auth.userId, ...req.valid.body });
  res.clearCookie(REFRESH, { ...cookieOpts(), maxAge: undefined });
  ok(res, out);
}
export async function downloadToken(req, res) {
  const { downloadToken } = await import('../services/auth.service.js');
  const token = downloadToken(req.auth.userId, req.params.id);
  // An employee must be pointed at the self-service route: /api/payslips/:id/pdf asks for payslip:read_all,
  // so handing them that link would have produced a 403 in a new tab.
  const canReadAll = req.auth.all === true || (req.auth.permissions || []).includes('payslip:read_all');
  const path = canReadAll ? `/api/payslips/${req.params.id}/pdf` : `/api/portal/payslips/${req.params.id}/pdf`;
  ok(res, { token, ttl_seconds: 300, url: `${path}?t=${token}`,
            note: 'Short-lived, single-purpose link so a browser can open the PDF without the SPA' });
}
export const publicConfig = async (_req, res) => ok(res, config.env === 'production' ? { env: 'production' } : { ...config.env && { env: config.env }, web_origin: config.webOrigin });
