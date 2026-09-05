import { bind, get, post, patch, del } from './_bind.js';
import * as c from '../controllers/org.controller.js';
import * as v from '../validators/org.schema.js';
export const orgRoutes = bind([
  get('/departments', { any: ['department:read', 'employee:read'], query: v.deptQuery, h: c.departments, read: true }),
  post('/departments', { perm: 'department:write', body: v.deptBody, h: c.createDepartment }),
  patch('/departments/:id', { perm: 'department:write', params: v.idParam, body: v.deptBody.partial(), h: c.updateDepartment }),
  del('/departments/:id', { perm: 'department:write', params: v.idParam, h: c.deleteDepartment }),
  get('/working-schedules', { any: ['schedule:read', 'employee:read'], query: v.listQuery, h: c.schedules, read: true }),
  get('/working-schedules/:id', { any: ['schedule:read', 'employee:read'], params: v.idParam, h: c.schedule, read: true }),
  post('/working-schedules', { perm: 'schedule:write', body: v.scheduleBody, h: c.createSchedule }),
  patch('/working-schedules/:id', { perm: 'schedule:write', params: v.idParam, body: v.scheduleBody, h: c.updateSchedule }),
  patch('/working-schedules/:id/active', { perm: 'schedule:write', params: v.idParam, body: v.scheduleActiveBody, h: c.setScheduleActive }),
  del('/working-schedules/:id', { perm: 'schedule:write', params: v.idParam, h: c.deleteSchedule }),
  get('/holidays', { any: ['holiday:read', 'employee:read'], query: v.holidayQuery, h: c.holidays, read: true }),
  post('/holidays', { perm: 'holiday:write', body: v.holidayBody, h: c.createHoliday }),
  patch('/holidays/:id', { perm: 'holiday:write', params: v.idParam, body: v.holidayBody.partial(), h: c.updateHoliday }),
  del('/holidays/:id', { perm: 'holiday:write', params: v.idParam, h: c.deleteHoliday }),
  get('/holiday-templates', { perm: 'holiday:write', h: c.templates, read: true }),
  post('/holidays/generate', { perm: 'holiday:write', body: v.generateBody, h: c.generate }),
]);
