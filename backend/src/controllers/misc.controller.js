import * as portal from '../services/portal.service.js';
import * as payslips from '../services/payslip.service.js';
import * as dashboard from '../services/dashboard.service.js';
import * as company from '../services/company.service.js';
import * as delivery from '../services/delivery.service.js';
import * as auditRepo from '../repositories/audit.repo.js';
import { ok, filters } from './_http.js';
import { config } from '../config.js';
import { AppError } from '../lib/shared/index.js';

// portal — everything here is scoped to the signed-in employee, no id in the URL on purpose
const selfEmployee = (req) => {
  if (!req.auth?.employeeId) throw new AppError('NO_PROFILE', 'Your login is not linked to an employee record', { status: 403 });
  return req.auth.employeeId;
};
export const portalSummary = async (req, res) => ok(res, await portal.summary(selfEmployee(req), { month: req.query.month }));
export const portalPayslips = async (req, res) => ok(res, await portal.myPayslips(req.auth.employeeId, filters(req.query)));
// One slip with its lines, for the employee it belongs to — payslip.service.read() refuses anything else.
export const portalPayslip = async (req, res) => ok(res, await payslips.read(req.params.id, { auth: req.auth }));
export const portalAttendance = async (req, res) => ok(res, await portal.myAttendance(req.auth.employeeId, { month: req.query.month }));
export const portalCalendar = async (req, res) => ok(res, await portal.myCalendar(req.auth.employeeId, { month: req.query.month }));
export const portalContracts = async (req, res) => ok(res, { rows: await portal.myContracts(req.auth.employeeId) });
export const portalTimeOff = async (req, res) => ok(res, await portal.myTimeOff(req.auth.employeeId));
export const portalBalances = async (req, res) => ok(res, { rows: await portal.myBalances(req.auth.employeeId) });
// dashboard
export const dashboardLoad = async (req, res) => ok(res, await dashboard.load({ ...filters(req.query), month: req.query.month }, { auth: req.auth }));
// company
export const companyRead = async (_req, res) => ok(res, await company.read());
export const companyUpdate = async (req, res) => ok(res, await company.update(req.valid.body, { auth: req.auth }));
export const companyPtSlabs = async (req, res) => ok(res, { rows: await company.ptSlabs(req.query.state) });
export const companyAddPtSlab = async (req, res) => ok(res, await company.addPtSlab(req.valid.body));
export const companyRemovePtSlab = async (req, res) => ok(res, await company.removePtSlab(req.params.id));
// system
export const systemJobs = async (_req, res) => ok(res, await delivery.stats());
export const systemTasks = async (req, res) => ok(res, await delivery.tasks({ payrunId: req.query.payrun_id, limit: Number(req.query.limit) || 50 }));
export const systemRetry = async (req, res) => ok(res, await delivery.retry(req.params.id, { auth: req.auth }));
export const systemReclaim = async (_req, res) => ok(res, await delivery.reclaim({ limit: 100 }));
export const auditList = async (req, res) => ok(res, await auditRepo.listAudit({ ...filters(req.query, { entity_type: 'entityType', entity_id: 'entityId', action: 'action' }) }));
export const auditEntity = async (req, res) => ok(res, { rows: await auditRepo.auditForEntity(req.params.type, req.params.id) });
