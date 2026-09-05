import { bind, get, post, patch, del } from './_bind.js';
import * as c from '../controllers/employees.controller.js';
import * as v from '../validators/employee.schema.js';
export const employeeRoutes = bind([
  get('/', { perm: 'employee:read', query: v.listQuery, h: c.index, read: true }),
  post('/', { perm: 'employee:write', body: v.createBody, h: c.create }),
  post('/import', { perm: 'employee:write', body: v.importBody, h: c.importCsv }),
  get('/me', { h: c.me, audit: false }),
  get('/:id', { perm: 'employee:read', params: v.idParam, h: c.show, read: true }),
  patch('/:id', { perm: 'employee:write', params: v.idParam, body: v.updateBody, h: c.update }),
  post('/:id/terminate', { perm: 'employee:write', params: v.idParam, body: v.terminateBody, h: c.terminate }),
  get('/:id/summary', { perm: 'employee:read', params: v.idParam, h: c.summary, read: true }),
  get('/:id/contracts', { perm: 'contract:read', params: v.idParam, h: c.contracts, read: true }),
  get('/:id/attendance', { perm: 'attendance:read', params: v.idParam, h: c.attendance, read: true }),
  get('/:id/time-off', { perm: 'timeoff:approve', params: v.idParam, h: c.timeOff, read: true }),
  get('/:id/payslips', { perm: 'payslip:read_all', params: v.idParam, h: c.payslips, read: true }),
]);
