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
export async function changePassword(req, res) {
  const out = await svc.changePassword({ userId: req.auth.userId, ...req.valid.body });
  res.clearCookie(REFRESH, { ...cookieOpts(), maxAge: undefined });
  ok(res, out);
}
export async function downloadToken(req, res) {
  const { downloadToken } = await import('../services/auth.service.js');
  ok(res, { token: downloadToken(req.auth.userId, req.params.id), ttl_seconds: 300,
            url: `/api/payslips/${req.params.id}/pdf?t=${downloadToken(req.auth.userId, req.params.id)}`,
            note: 'Short-lived, single-purpose link so a browser can open the PDF without the SPA' });
}
export const publicConfig = async (_req, res) => ok(res, config.env === 'production' ? { env: 'production' } : { ...config.env && { env: config.env }, web_origin: config.webOrigin });
