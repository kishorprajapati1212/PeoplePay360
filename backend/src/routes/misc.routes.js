import express from 'express';
import { bind, get, post, patch, del } from './_bind.js';
import * as c from '../controllers/misc.controller.js';
import * as ps from '../controllers/payslips.controller.js';
import * as to from '../controllers/timeoff.controller.js';
import { idParam } from '../validators/common-helpers.js';
import * as v from '../validators/payroll.schema.js';
import * as hv from '../validators/hr.schema.js';
import { z } from 'zod';

/**
 * Employee self-service. Note there are no employee ids in these paths: the record is always taken from
 * the logged-in user, which is what makes "an employee can read someone else's payslip" impossible here.
 */
export const portalRoutes = bind([
  get('/summary', { h: c.portalSummary, audit: false }),
  get('/payslips', { h: c.portalPayslips, audit: false }),
  get('/payslips/:id', { perm: 'payslip:read_own', params: idParam(), h: c.portalPayslip, read: true, audit: false }),
  get('/payslips/:id/pdf', { perm: 'payslip:download_own', params: idParam(), h: ps.pdf, download: true, audit: false }),
  get('/attendance', { h: c.portalAttendance, audit: false }),
  get('/calendar', { h: c.portalCalendar, audit: false }),
  get('/contracts', { h: c.portalContracts, audit: false }),
  get('/time-off', { h: c.portalTimeOff, audit: false }),
  get('/balances', { h: c.portalBalances, audit: false }),
  post('/time-off', { perm: 'timeoff:request', body: hv.timeOffRequestBody, h: to.createRequest, idem: true }),
  post('/time-off/:id/cancel', { perm: 'timeoff:request', params: idParam(), h: to.cancel }),
]);
export const dashboardRoutes = bind([
  get('/', { any: ['dashboard:hr', 'dashboard:payroll'], query: v.dashboardQuery, h: c.dashboardLoad, read: true }),
]);
export const companyRoutes = bind([
  get('/', { perm: 'settings:read', h: c.companyRead, read: true }),
  patch('/', { perm: 'settings:write', body: v.companyBody, h: c.companyUpdate }),
  get('/pt-slabs', { any: ['settings:read', 'salary:rule_read'], h: c.companyPtSlabs, read: true }),
  post('/pt-slabs', { perm: 'settings:write', body: v.ptSlabBody, h: c.companyAddPtSlab }),
  del('/pt-slabs/:id', { perm: 'settings:write', params: idParam(), h: c.companyRemovePtSlab }),
]);
export const systemRoutes = bind([
  get('/jobs', { perm: 'system:queue', h: c.systemJobs, read: true }),
  get('/tasks', { perm: 'system:queue', h: c.systemTasks, read: true }),
  post('/tasks/:id/retry', { perm: 'system:queue', params: idParam(), h: c.systemRetry }),
  post('/reclaim', { perm: 'system:queue', h: c.systemReclaim }),
  get('/audit', { perm: 'audit:read', h: c.auditList, read: true }),
  get('/audit/:type/:id', { perm: 'audit:read', params: z.object({ type: z.string().trim().min(2).max(40), id: z.string().uuid() }), h: c.auditEntity, read: true }),
]);
