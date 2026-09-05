import { bind, get, post, patch, del } from './_bind.js';
import * as att from '../controllers/attendance.controller.js';
import * as to from '../controllers/timeoff.controller.js';
import * as ct from '../controllers/contracts.controller.js';
import * as v from '../validators/hr.schema.js';
import { idParam } from '../validators/common-helpers.js';
export const contractRoutes = bind([
  get('/', { perm: 'contract:read', h: ct.index, read: true }),
  post('/', { perm: 'contract:write', body: v.contractBody, h: ct.create }),
  get('/expiring', { perm: 'contract:read', h: ct.expiring, read: true }),
  get('/employee/:employeeId', { perm: 'contract:read', params: idParam('employeeId'), h: ct.forEmployee, read: true }),
  get('/:id', { perm: 'contract:read', params: idParam(), h: ct.show, read: true }),
  patch('/:id', { perm: 'contract:write', params: idParam(), body: v.contractBody.partial().extend({ employee_id: v.contractBody.shape.employee_id.optional() }), h: ct.update }),
  post('/:id/terminate', { perm: 'contract:write', params: idParam(), body: v.terminateBody, h: ct.terminate }),
  post('/:id/renew', { perm: 'contract:write', params: idParam(), body: v.renewBody, h: ct.renew }),
]);
export const attendanceRoutes = bind([
  get('/', { perm: 'attendance:read', query: v.periodQuery, h: att.index, read: true }),
  post('/', { perm: 'attendance:write', body: v.attendanceBody, h: att.create }),
  post('/clock', { perm: 'attendance:clock', body: v.clockBody, h: att.clock }),
  post('/import', { perm: 'attendance:write', body: v.importBody, h: att.importRows }),
  get('/exceptions', { perm: 'attendance:read', query: v.periodQuery, h: att.exceptions, read: true }),
  get('/export.csv', { perm: 'attendance:read', query: v.periodQuery, h: att.exportCsv, read: false }),
  patch('/:id', { perm: 'attendance:write', params: idParam(), body: v.attendanceBody.partial().omit({ employee_id: true, day: true }), h: att.update }),
  del('/:id', { perm: 'attendance:write', params: idParam(), h: att.remove }),
  post('/:id/overtime', { perm: 'attendance:approve_overtime', params: idParam(), body: v.overtimeBody, h: att.overtime }),
]);
export const timeOffRoutes = bind([
  // The request form in "My time off" fills its Leave type picker from this list, so anyone who can
  // request leave (timeoff:type_read — every employee and every staff role) has to be able to read it.
  // With only the two admin perms here, an employee got a 403 → an empty dropdown in a 34px box.
  get('/types', { any: ['timeoff:type_read', 'timeoff:approve', 'timeoff:type_write'], query: v.typeListQuery, h: to.types, read: true }),
  post('/types', { perm: 'timeoff:type_write', body: v.timeOffTypeBody, h: to.createType }),
  get('/types/:id', { any: ['timeoff:type_read', 'timeoff:approve'], params: idParam(), h: to.type, read: true }),
  patch('/types/:id', { perm: 'timeoff:type_write', params: idParam(), body: v.timeOffTypeBody.partial(), h: to.updateType }),
  del('/types/:id', { perm: 'timeoff:type_write', params: idParam(), h: to.deleteType }),
  get('/allocations', { any: ['timeoff:allocation_read', 'timeoff:approve'], h: to.allocations, read: true }),
  post('/allocations', { perm: 'timeoff:allocation_write', body: v.allocationBody, h: to.createAllocation }),
  // Same grant for many people at once — what the "Assign balance" button on the types screen uses.
  post('/allocations/bulk', { perm: 'timeoff:allocation_write', body: v.allocateManyBody, h: to.allocateMany, idem: true }),
  patch('/allocations/:id', { perm: 'timeoff:allocation_write', params: idParam(), body: v.allocationBody.partial().omit({ employee_id: true, time_off_type_id: true }), h: to.updateAllocation }),
  get('/balances/:employeeId', { any: ['timeoff:allocation_read', 'timeoff:approve'], params: idParam('employeeId'), h: to.balances, read: true }),
  post('/count-days', { any: ['timeoff:approve', 'timeoff:request'], body: v.countDaysBody, h: to.countDays, read: false }),
  post('/carry-forward', { perm: 'timeoff:allocation_write', body: v.carryBody, h: to.carryForward }),
  get('/overview', { any: ['timeoff:allocation_read', 'timeoff:approve'], query: v.periodQuery, h: to.overview, read: true }),
  get('/requests', { any: ['timeoff:approve', 'timeoff:request'], query: v.periodQuery, h: to.requests, read: true }),
  post('/requests', { perm: 'timeoff:request', body: v.timeOffRequestBody, h: to.createRequest, idem: true }),
  get('/requests/:id', { any: ['timeoff:approve', 'timeoff:request'], params: idParam(), h: to.request, read: true }),
  patch('/requests/:id', { perm: 'timeoff:request', params: idParam(), body: v.timeOffPatch, h: to.patchRequest }),
  del('/requests/:id', { perm: 'timeoff:request', params: idParam(), h: to.remove }),
  post('/requests/:id/approve', { perm: 'timeoff:approve', params: idParam(), body: v.decideBody, h: to.decide, idem: true }),
  post('/requests/:id/refuse', { perm: 'timeoff:approve', params: idParam(), body: v.decideBody.partial(), h: to.decide, idem: true }),
  post('/requests/:id/cancel', { perm: 'timeoff:request', params: idParam(), h: to.cancel }),
]);
