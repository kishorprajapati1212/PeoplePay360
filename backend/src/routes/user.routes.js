import { bind, get, post, patch } from './_bind.js';
import * as c from '../controllers/users.controller.js';
import * as v from '../validators/user.schema.js';
export const userRoutes = bind([
  get('/', { perm: 'user:write', query: v.listQuery, h: c.index, read: true }),
  post('/', { perm: 'user:write', body: v.createBody, h: c.create }),
  get('/:id', { perm: 'user:write', params: v.idParam, h: c.show, read: true }),
  patch('/:id', { perm: 'user:write', params: v.idParam, body: v.updateBody, h: c.update }),
  post('/:id/roles', { perm: 'user:write', params: v.idParam, body: v.rolesBody, h: c.roles }),
  post('/:id/deactivate', { perm: 'user:write', params: v.idParam, h: c.deactivate }),
  post('/:id/activate', { perm: 'user:write', params: v.idParam, h: c.activate }),
  post('/:id/reset-password', { perm: 'user:write', params: v.idParam, body: v.passwordBody, h: c.resetPassword }),
]);
