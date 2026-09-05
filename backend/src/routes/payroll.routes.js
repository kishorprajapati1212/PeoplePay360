import { bind, get, post, patch, del } from './_bind.js';
import * as sr from '../controllers/salary.controller.js';
import * as pr from '../controllers/payruns.controller.js';
import * as ps from '../controllers/payslips.controller.js';
import * as v from '../validators/payroll.schema.js';
import { idParam } from '../validators/common-helpers.js';
export const salaryRoutes = bind([
  get('/structures', { any: ['salary:structure_read', 'payroll:payrun_create'], h: sr.structures, read: true }),
  post('/structures', { perm: 'salary:structure_write', body: v.structureBody, h: sr.createStructure }),
  get('/structures/:id', { perm: 'salary:structure_read', params: idParam(), h: sr.structure, read: true }),
  patch('/structures/:id', { perm: 'salary:structure_write', params: idParam(), body: v.structureBody.partial(), h: sr.updateStructure }),
  del('/structures/:id', { perm: 'salary:structure_write', params: idParam(), h: sr.deleteStructure }),
  get('/structures/:id/impact', { perm: 'salary:structure_write', params: idParam(), h: sr.impact, read: true }),
  get('/rules', { perm: 'salary:rule_read', h: sr.rules, read: true }),
  post('/rules', { perm: 'salary:rule_write', body: v.ruleBody, h: sr.createRule }),
  post('/rules/validate', { perm: 'salary:rule_write', body: v.validateRuleBody, h: sr.validate, read: false }),
  post('/preview', { any: ['salary:rule_write', 'salary:structure_read', 'payroll:payrun_create'], body: v.previewBody, h: sr.preview, read: false }),
  get('/rules/:id', { perm: 'salary:rule_read', params: idParam(), h: sr.rule, read: true }),
  patch('/rules/:id', { perm: 'salary:rule_write', params: idParam(), body: v.ruleBody.partial().omit({ salary_structure_id: true }), h: sr.updateRule }),
  del('/rules/:id', { perm: 'salary:rule_write', params: idParam(), h: sr.deleteRule }),
  get('/pt-slabs', { any: ['settings:write', 'salary:rule_read'], h: sr.ptSlabs, read: true }),
  post('/pt-slabs', { perm: 'settings:write', body: v.ptSlabBody, h: sr.createPtSlab }),
  del('/pt-slabs/:id', { perm: 'settings:write', params: idParam(), h: sr.deletePtSlab }),
]);
export const payrunRoutes = bind([
  get('/', { perm: 'payroll:payrun_read', query: v.payrunListQuery, h: pr.index, read: true }),
  get('/zip/:payrunId', { perm: 'payroll:pdf', params: idParam('payrunId'), h: ps.zip, read: false }),
  post('/preview', { perm: 'payroll:payrun_create', body: v.wizardStep1, h: pr.step1, read: false }),
  get('/employees', { perm: 'payroll:payrun_create', query: v.candidateQuery, h: pr.candidates, read: true }),
  post('/', { perm: 'payroll:payrun_create', body: v.wizardStep2, h: pr.create, idem: true }),
  get('/:id', { perm: 'payroll:payrun_read', params: v.idParam, h: pr.show, read: true }),
  del('/:id', { perm: 'payroll:payrun_delete', params: v.idParam, h: pr.remove }),
  post('/:id/compute', { perm: 'payroll:compute', params: v.idParam, body: v.computeBody.optional(), h: pr.compute, idem: true, read: false }),
  post('/:id/validate', { perm: 'payroll:validate', params: v.idParam, h: pr.validate, idem: true, read: false }),
  post('/:id/mark-paid', { perm: 'payroll:mark_paid', params: v.idParam, h: pr.markPaid, idem: true, read: false }),
  post('/:id/void', { perm: 'payroll:payrun_delete', params: v.idParam, h: pr.voidRun, idem: true }),
  post('/:id/generate-pdfs', { perm: 'payroll:validate', params: v.idParam, h: pr.pdfs, read: false }),
  post('/:id/send', { perm: 'payroll:send_bulk', params: v.idParam, body: v.sendBody.optional(), h: pr.send, idem: true, read: false }),
  get('/:id/export.csv', { perm: 'payroll:payrun_read', params: v.idParam, h: pr.exportCsv, read: false, audit: false }),
  get('/:id/warnings', { perm: 'payroll:payrun_read', params: v.idParam, h: pr.warnings, read: true }),
  get('/:id/tasks', { perm: 'payroll:payrun_read', params: v.idParam, h: pr.tasks, read: true }),
  get('/:id/emails', { perm: 'payroll:send_bulk', params: v.idParam, h: pr.emails, read: true }),
]);
export const payslipRoutes = bind([
  get('/', { any: ['payslip:read_all', 'payslip:download_own'], query: v.payslipListQuery, h: ps.index, read: true }),
  // Bulk release for a selection — declared before /:id so the path is never read as a payslip id.
  post('/send', { perm: 'payroll:send_bulk', body: v.bulkSendBody, h: ps.bulkSend, idem: true }),
  get('/:id', { perm: 'payslip:read_all', params: v.idParam, h: ps.show, read: true }),
  post('/:id/compute', { perm: 'payroll:compute', params: v.idParam, h: ps.recompute, read: false }),
  patch('/:id/lines', { perm: 'payslip:edit_lines', params: v.idParam, body: v.linePatch, h: ps.lines }),
  patch('/:id/inputs', { perm: 'payslip:edit_lines', params: v.idParam, body: v.inputsBody, h: ps.inputs }),
  post('/:id/arrear', { perm: 'payslip:arrear', params: v.idParam, body: v.arrearBody, h: ps.arrear, idem: true }),
  get('/:id/pdf', { perm: 'payslip:read_all', params: v.idParam, h: ps.pdf, download: true, read: false }),
  get('/:id/preview-pdf', { perm: 'payslip:read_all', params: v.idParam, h: ps.preview, read: false, audit: false }),
  post('/:id/print', { perm: 'payroll:pdf', params: v.idParam, h: ps.print, read: false }),
  get('/:id/history', { perm: 'payslip:read_all', params: v.idParam, h: ps.history, read: true }),
  get('/:id/downloads', { perm: 'payroll:send_bulk', params: v.idParam, h: ps.downloads, read: true }),
]);
