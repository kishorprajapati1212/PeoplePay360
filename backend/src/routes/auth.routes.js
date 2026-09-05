import { bind, get, post } from './_bind.js';
import * as c from '../controllers/auth.controller.js';
import * as v from '../validators/auth.schema.js';
import { publicConfig } from '../config.js';
/** Public surface: only login/refresh/health. Everything else behind authenticate(). */
export const publicRoutes = bind([
  post('/login', { public: true, rate: { perMinute: 30 }, body: v.loginBody, h: c.login, audit: false }),
  post('/refresh', { public: true, rate: { perMinute: 60 }, h: c.refresh, audit: false }),
]);
export const authRoutes = bind([
  post('/logout', { h: c.logout, audit: false, read: true }),
  post('/change-password', { body: v.changePasswordBody, h: c.changePassword, audit: false }),
  get('/me', { h: c.me, audit: false }),
  get('/access-matrix', { h: c.accessMatrix, audit: false }),
  get('/token-for-payslip/:id', { h: c.downloadToken, audit: false }),
]);
