import * as svc from '../services/employee.service.js';
import { ok, created, list, filters } from './_http.js';
export const index = async (req, res) => list(res, await svc.list(filters(req.query, { q: 'search', department_id: 'departmentId', employee_type: 'employeeType' })));
export const show = async (req, res) => ok(res, await svc.read(req.params.id));
export const create = async (req, res) => created(res, await svc.create(req.valid.body, { auth: req.auth }));
export const update = async (req, res) => ok(res, await svc.update(req.params.id, req.valid.body, { auth: req.auth }));
export const terminate = async (req, res) => ok(res, await svc.terminate(req.params.id, req.valid.body, { auth: req.auth }));
export const summary = async (req, res) => ok(res, await svc.summary(req.params.id));
export const contracts = async (req, res) => ok(res, { rows: await svc.contracts(req.params.id) });
export const attendance = async (req, res) => {
  const svc2 = await import('../services/attendance.service.js');
  return ok(res, await svc2.list({ ...filters(req.query, { month: 'month' }), employeeId: req.params.id }));
};
export const timeOff = async (req, res) => {
  const svc2 = await import('../services/timeoff.service.js');
  return ok(res, await svc2.listRequests({ employeeId: req.params.id, limit: 50 }));
};
export const payslips = async (req, res) => {
  const svc2 = await import('../services/payslip.service.js');
  return ok(res, await svc2.list({ employeeId: req.params.id, limit: 60 }, { auth: req.auth }));
};
export const importCsv = async (req, res) => ok(res, await svc.importCsv(req.valid.body, { auth: req.auth }));
export const me = async (req, res) => ok(res, req.auth.employeeId ? await svc.read(req.auth.employeeId) : { employee: null, note: 'This login is not linked to an employee record' });
