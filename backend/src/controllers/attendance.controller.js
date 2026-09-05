import * as svc from '../services/attendance.service.js';
import { ok, created, list, filters, streamCsv } from './_http.js';
export const index = async (req, res) => list(res, await svc.list(filters(req.query, { employee_id: 'employeeId', only_exceptions: 'onlyExceptions', limit: 'limit' })));
export const show = async (req, res) => ok(res, await svc.read(req.params.id));
export const create = async (req, res) => created(res, await svc.upsert(req.valid.body, { auth: req.auth }));
export const update = async (req, res) => ok(res, await svc.patch(req.params.id, req.valid.body, { auth: req.auth }));
export const remove = async (req, res) => ok(res, await svc.remove(req.params.id));
export const clock = async (req, res) => ok(res, await svc.clock(req.valid.body, { auth: req.auth }));
export const overtime = async (req, res) => ok(res, await svc.approveOvertime(req.params.id, { auth: req.auth, approved: req.valid.body.approved }));
export const exceptions = async (req, res) => ok(res, await svc.exceptions(filters(req.query, { employee_id: 'employeeId' })));
export const monthly = async (req, res) => ok(res, await svc.monthly(req.params.employeeId, { from: req.query.from, to: req.query.to }));
export const importRows = async (req, res) => ok(res, await svc.importRows(req.valid.body, { auth: req.auth }));
export async function exportCsv(req, res) {
  const rows = await svc.list({ ...filters(req.query), limit: 5000 });
  const cols = ['day', 'employee_code', 'employee', 'check_in', 'check_out', 'worked_hours', 'net_worked_hours', 'expected_hours', 'overtime_hours', 'overtime_approved', 'status', 'is_manual'];
  const esc = (v) => (v == null ? '' : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
  const csv = [cols.join(',')].concat(rows.rows.map((r) => cols.map((c) => esc(r[c])).join(','))).join('\n');
  streamCsv(res, { csv, name: `attendance-${req.query.month || 'export'}.csv` });
}
