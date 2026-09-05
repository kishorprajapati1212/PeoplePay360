import { api } from './client.js';

/**
 * Every call the UI makes, in one file, grouped the way the backend groups its routes.
 * A page never builds a URL by hand — so if an endpoint moves, exactly one line changes here.
 */
export const auth = {
  login: (email, password) => api.post('/auth/login', { email, password }),
  logout: () => api.post('/auth/logout', {}),
  me: () => api.get('/auth/me'),
  /** Rotates the refresh cookie and returns a new access token; client.js calls this itself on a 401. */
  refresh: () => api.post('/auth/refresh', {}),
  accessMatrix: () => api.get('/auth/access-matrix'),
  /** Anyone may change their own password; the API then revokes the session cookie, so you sign in again. */
  changePassword: (body) => api.post('/auth/change-password', body),
  /** 5-minute signed link so a plain <a> can stream the payslip PDF. */
  slipToken: (payslipId) => api.get(`/auth/token-for-payslip/${payslipId}`),
};

export const employees = {
  list: (query) => api.get('/employees', query),
  one: (id) => api.get(`/employees/${id}`),
  create: (body) => api.post('/employees', body),
  update: (id, body) => api.patch(`/employees/${id}`, body),
  terminate: (id, body) => api.post(`/employees/${id}/terminate`, body || {}),
  summary: (id) => api.get(`/employees/${id}/summary`),
  contracts: (id) => api.get(`/employees/${id}/contracts`),
  attendance: (id, query) => api.get(`/employees/${id}/attendance`, query),
  timeOff: (id, query) => api.get(`/employees/${id}/time-off`, query),
  payslips: (id, query) => api.get(`/employees/${id}/payslips`, query),
};

export const org = {
  departments: {
    list: (query) => api.get('/org/departments', query),
    create: (body) => api.post('/org/departments', body),
    update: (id, body) => api.patch(`/org/departments/${id}`, body),
    remove: (id) => api.del(`/org/departments/${id}`),
  },
  schedules: {
    list: (query) => api.get('/org/working-schedules', query),
    one: (id) => api.get(`/org/working-schedules/${id}`),
    create: (body) => api.post('/org/working-schedules', body),
    update: (id, body) => api.patch(`/org/working-schedules/${id}`, body),
    remove: (id) => api.del(`/org/working-schedules/${id}`),
  },
  holidays: {
    list: (query) => api.get('/org/holidays', query),
    create: (body) => api.post('/org/holidays', body),
    update: (id, body) => api.patch(`/org/holidays/${id}`, body),
    remove: (id) => api.del(`/org/holidays/${id}`),
    generate: (body) => api.post('/org/holidays/generate', body),
  },
  holidayTemplates: () => api.get('/org/holiday-templates'),
};

export const contracts = {
  list: (query) => api.get('/contracts', query),
  create: (body) => api.post('/contracts', body),
  update: (id, body) => api.patch(`/contracts/${id}`, body),
  renew: (id, body) => api.post(`/contracts/${id}/renew`, body || {}),
  terminate: (id, body) => api.post(`/contracts/${id}/terminate`, body || {}),
  expiring: (query) => api.get('/contracts/expiring', query),
};

export const attendance = {
  list: (query) => api.get('/attendance', query),
  entry: (body) => api.post('/attendance', body),
  update: (id, body) => api.patch(`/attendance/${id}`, body),
  remove: (id) => api.del(`/attendance/${id}`),
  clock: (body) => api.post('/attendance/clock', body),
  overtime: (id, body) => api.post(`/attendance/${id}/overtime`, body),
  exceptions: (query) => api.get('/attendance/exceptions', query),
};

export const timeOff = {
  types: {
    list: (query) => api.get('/time-off/types', query),
    create: (body) => api.post('/time-off/types', body),
    update: (id, body) => api.patch(`/time-off/types/${id}`, body),
    remove: (id) => api.del(`/time-off/types/${id}`),
  },
  requests: {
    list: (query) => api.get('/time-off/requests', query),
    create: (body) => api.post('/time-off/requests', body),
    approve: (id, body) => api.post(`/time-off/requests/${id}/approve`, body || {}),
    refuse: (id, body) => api.post(`/time-off/requests/${id}/refuse`, body || {}),
    cancel: (id, body) => api.post(`/time-off/requests/${id}/cancel`, body || {}),
  },
  allocations: {
    list: (query) => api.get('/time-off/allocations', query),
    create: (body) => api.post('/time-off/allocations', body),
    bulk: (body) => api.post('/time-off/allocations/bulk', body),
    update: (id, body) => api.patch(`/time-off/allocations/${id}`, body),
  },
  balances: (employeeId) => api.get(`/time-off/balances/${employeeId}`),
  overview: (query) => api.get('/time-off/overview', query),
  countDays: (body) => api.post('/time-off/count-days', body),
  /** HR pushes last year's unused days into the new year; the API writes the allocation rows itself. */
  carryForward: (body) => api.post('/time-off/carry-forward', body),
};

export const salary = {
  structures: {
    list: (query) => api.get('/salary/structures', query),
    one: (id) => api.get(`/salary/structures/${id}`),
    create: (body) => api.post('/salary/structures', body),
    update: (id, body) => api.patch(`/salary/structures/${id}`, body),
    remove: (id) => api.del(`/salary/structures/${id}`),
    impact: (id) => api.get(`/salary/structures/${id}/impact`),
  },
  rules: {
    list: (query) => api.get('/salary/rules', query),
    one: (id) => api.get(`/salary/rules/${id}`),
    create: (body) => api.post('/salary/rules', body),
    update: (id, body) => api.patch(`/salary/rules/${id}`, body),
    remove: (id) => api.del(`/salary/rules/${id}`),
    validate: (body) => api.post('/salary/rules/validate', body),
  },
  preview: (body) => api.post('/salary/preview', body),
  ptSlabs: () => api.get('/salary/pt-slabs'),
};

export const payroll = {
  payruns: {
    list: (query) => api.get('/payruns', query),
    one: (id) => api.get(`/payruns/${id}`),
    create: (body) => api.post('/payruns', body),
    remove: (id) => api.del(`/payruns/${id}`),
    candidates: (query) => api.get('/payruns/employees', query),
    preview: (body) => api.post('/payruns/preview', body),
    compute: (id, body) => api.post(`/payruns/${id}/compute`, body || {}),
    validate: (id, body) => api.post(`/payruns/${id}/validate`, body || {}),
    generatePdfs: (id, body) => api.post(`/payruns/${id}/generate-pdfs`, body || {}),
    markPaid: (id, body) => api.post(`/payruns/${id}/mark-paid`, body || {}),
    send: (id, body) => api.post(`/payruns/${id}/send`, body || {}),
    void: (id, body) => api.post(`/payruns/${id}/void`, body || {}),
    warnings: (id) => api.get(`/payruns/${id}/warnings`),
    tasks: (id) => api.get(`/payruns/${id}/tasks`),
    emails: (id) => api.get(`/payruns/${id}/emails`),
  },
  payslips: {
    list: (query) => api.get('/payslips', query),
    one: (id) => api.get(`/payslips/${id}`),
    compute: (id, body) => api.post(`/payslips/${id}/compute`, body || {}),
    print: (id) => api.post(`/payslips/${id}/print`, {}),
    arrear: (id, body) => api.post(`/payslips/${id}/arrear`, body || {}),
    lines: (id, body) => api.patch(`/payslips/${id}/lines`, body),
    inputs: (id, body) => api.patch(`/payslips/${id}/inputs`, body),
    bulkSend: (body) => api.post('/payslips/send', body),
    history: (id) => api.get(`/payslips/${id}/history`),
    downloads: (id) => api.get(`/payslips/${id}/downloads`),
  },
};

export const dashboard = { get: (query) => api.get('/dashboard', query) };
export const portal = {
  summary: () => api.get('/portal/summary'),
  payslips: (query) => api.get('/portal/payslips', query),
  payslip: (id) => api.get(`/portal/payslips/${id}`),        // one own slip, lines included
  attendance: (query) => api.get('/portal/attendance', query),
  timeOff: (query) => api.get('/portal/time-off', query),
  balances: () => api.get('/portal/balances'),
  calendar: (query) => api.get('/portal/calendar', query),
  contract: () => api.get('/portal/contracts'),
  request: (body) => api.post('/portal/time-off', body),
  cancelRequest: (id) => api.post(`/portal/time-off/${id}/cancel`, {}),
};
export const users = {
  list: (query) => api.get('/users', query),
  one: (id) => api.get(`/users/${id}`),
  create: (body) => api.post('/users', body),
  update: (id, body) => api.patch(`/users/${id}`, body),
  setRoles: (id, body) => api.post(`/users/${id}/roles`, body),
  activate: (id) => api.post(`/users/${id}/activate`, {}),
  deactivate: (id) => api.post(`/users/${id}/deactivate`, {}),
  resetPassword: (id, body) => api.post(`/users/${id}/reset-password`, body || {}),
};
export const company = { get: () => api.get('/company'), update: (body) => api.patch('/company', body) };
export const system = {
  jobs: (query) => api.get('/system/jobs', query),
  tasks: (query) => api.get('/system/tasks', query),
  retry: (id) => api.post(`/system/tasks/${id}/retry`, {}),
  reclaim: () => api.post('/system/reclaim', {}),
  audit: (query) => api.get('/system/audit', query),
};
