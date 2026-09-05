import * as svc from '../services/timeoff.service.js';
import { ok, created, list, filters } from './_http.js';
export const types = async (_req, res) => ok(res, { rows: await svc.listTypes({ includeInactive: _req.valid.query.include_inactive === true }) });
export const type = async (req, res) => ok(res, await svc.getType(req.params.id));
export const createType = async (req, res) => created(res, await svc.createType(req.valid.body));
export const updateType = async (req, res) => ok(res, await svc.updateType(req.params.id, req.valid.body));
export const deleteType = async (req, res) => ok(res, await svc.deleteType(req.params.id));
export const requests = async (req, res) => list(res, await svc.listRequests({ ...filters(req.query, { employee_id: 'employeeId', type_id: 'typeId', pending_only: 'pendingOnly' }),
  statuses: req.query.status ? undefined : ['TO_APPROVE', 'APPROVED', 'REFUSED', 'DRAFT'] }));
export const request = async (req, res) => {
  const rows = await svc.repoGetRequest(req.params.id);
  if (!rows) { const { AppError } = await import('../lib/shared/index.js'); throw AppError.notFound('Time off request not found'); }
  return ok(res, rows);
};
export const createRequest = async (req, res) => created(res, await svc.createRequest(req.valid.body, { auth: req.auth }));
export const patchRequest = async (req, res) => ok(res, await svc.patchRequest(req.params.id, req.valid.body, { auth: req.auth }));
export const decide = async (req, res) => ok(res, await svc.decide(req.params.id, req.valid.body, { auth: req.auth }));
export const cancel = async (req, res) => ok(res, await svc.cancel(req.params.id, { auth: req.auth }));
export const remove = async (req, res) => ok(res, await svc.remove(req.params.id, { auth: req.auth }));
export const allocations = async (req, res) => list(res, await svc.listAllocations(filters(req.query, { employee_id: 'employeeId', type_id: 'typeId' })));
export const createAllocation = async (req, res) => created(res, await svc.createAllocation(req.valid.body));
export const updateAllocation = async (req, res) => ok(res, await svc.updateAllocation(req.params.id, req.valid.body));
export const balances = async (req, res) => ok(res, { rows: await svc.allocationsFor(req.params.employeeId) });
export const overview = async (req, res) => ok(res, { rows: await svc.overview(filters(req.query, { department_id: 'departmentId' })) });
export const carryForward = async (req, res) => { const b = req.valid.body;
  ok(res, await svc.carryForward({ typeId: b.type_id ?? b.typeId, fromYear: b.from_year ?? b.fromYear, toYear: b.to_year ?? b.toYear, cap: b.cap })); };
export const countDays = async (req, res) => { const b = req.valid.body;
  ok(res, await svc.countDays({ employeeId: b.employee_id ?? b.employeeId, typeId: b.type_id ?? b.typeId,
    from: b.start_date ?? b.from, to: b.end_date ?? b.to, halfDayPeriod: b.half_day_period })); };
