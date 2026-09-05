import express from 'express';
import { config } from '../config.js';
import { publicRoutes, authRoutes } from './auth.routes.js';
import { employeeRoutes } from './employee.routes.js';
import { userRoutes } from './user.routes.js';
import { orgRoutes } from './org.routes.js';
import { contractRoutes, attendanceRoutes, timeOffRoutes } from './hr.routes.js';
import { salaryRoutes, payrunRoutes, payslipRoutes } from './payroll.routes.js';
import { portalRoutes, dashboardRoutes, companyRoutes, systemRoutes } from './misc.routes.js';
import { authenticate } from '../middleware/auth.js';
import { requirePermission } from '../middleware/rbac.js';
import { wrap } from '../middleware/wrap.js';
import { notFound, errorHandler } from '../middleware/error.js';
import { AppError } from '../lib/shared/index.js';
import * as payslipSvc from '../services/payslip.service.js';
import { makeZip } from '../lib/pdf/index.js';

/**
 * Route map — the URL surface of the product. Permissions live in each table entry and are defined once
 * in src/lib/shared/src/permissions.js; nav/visibility on the front end comes from the same file.
 */
const humanise = (v) => String(v).toLowerCase().replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
export function apiRouter() {
  const r = express.Router();
  r.use('/auth', publicRoutes);
  r.use('/auth', authRoutes);
  r.use('/employees', employeeRoutes);
  r.use('/users', userRoutes);
  r.use('/org', orgRoutes);
  r.use('/contracts', contractRoutes);
  r.use('/attendance', attendanceRoutes);
  r.use('/time-off', timeOffRoutes);
  r.use('/salary', salaryRoutes);
  r.use('/payruns', payrunRoutes);
  r.use('/payslips', payslipRoutes);
  r.use('/portal', authenticate(), portalRoutes);
  r.use('/dashboard', dashboardRoutes);
  r.use('/company', companyRoutes);
  r.use('/system', systemRoutes);
  r.use('/reports', reportsRouter());
  // Picklists the forms need, straight from the same tables the validators use: the client never keeps a
  // second copy of "which states exist" or "which leave categories are allowed", so an option that the
  // API would refuse cannot appear in a dropdown.
  r.get('/meta', async (_req, res) => {
    const { INDIAN_STATES, PT_STATES } = await import('../lib/shared/index.js');
    const { LEAVE_CATEGORIES } = await import('../validators/hr.schema.js');
    res.json({ ok: true, ts: new Date().toISOString(),
             states: INDIAN_STATES, pt_states: PT_STATES,
             leave_categories: LEAVE_CATEGORIES.map((value) => ({ value, label: humanise(value) })) });
  });
  r.use(notFound);
  r.use(errorHandler);
  return r;
}
/** Bulk exports: payslip ZIP + salary register CSV, each permission-gated. */
function reportsRouter() {
  const r = express.Router();
  const guard = (perm) => [authenticate(), requirePermission(perm)];
  const csv = (rows, cols) => {
    const esc = (v) => (v === null || v === undefined ? '' : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
    return [cols.join(',')].concat(rows.map((x) => cols.map((c) => esc(x[c])).join(','))).join('\n');
  };
  // A bulk export always belongs to one pay run: without it we would silently ship the whole table.
  const needRun = (req) => {
    if (!req.query.payrun_id) throw AppError.badRequest('Add ?payrun_id=<uuid> — a bulk payslip export always belongs to one pay run', { code: 'PAYRUN_REQUIRED' });
    return req.query.payrun_id;
  };
  r.get('/payslips.zip', ...guard('payroll:pdf'), wrap(async (req, res) => {
    const out = await payslipSvc.zipPayslips(needRun(req), { auth: req.auth });
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${out.fileName}"`);
    res.end(out.buffer);
  }));
  r.get('/attendance.csv', ...guard('attendance:read'), wrap(async (req, res) => {
    const svc = await import('../services/attendance.service.js');
    const { rows } = await svc.list({ month: req.query.month, departmentId: req.query.department_id, employeeId: req.query.employee_id, limit: 5000 });
    const cols = ['day', 'employee_code', 'employee', 'check_in', 'check_out', 'worked_hours', 'net_worked_hours', 'overtime_hours', 'status'];
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.end(csv(rows, cols));
  }));
  r.get('/salary-register.csv', ...guard('payroll:export'), wrap(async (req, res) => {
    const svc = await import('../services/payrun.service.js');
    const out = await svc.exportCsv(needRun(req));
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${out.name}"`);
    res.end(out.csv);
  }));
  r.get('/payroll-summary.csv', ...guard('payroll:export'), wrap(async (req, res) => {
    const { query } = await import('../db/pool.js');
    const { rows } = await query(`select r.name, r.period_key, r.status, r.employee_count, r.total_gross, r.total_net, r.total_deductions
                                   from v_payrun_summary r order by r.period_start desc limit 500`);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.end(csv(rows, ['name', 'period_key', 'status', 'employee_count', 'total_gross', 'total_net', 'total_deductions']));
  }));
  return r;
}
