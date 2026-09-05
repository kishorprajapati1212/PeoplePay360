import { bind, get, post, patch } from './_bind.js';
import * as c from '../controllers/users.controller.js';
import * as v from '../validators/user.schema.js';
export const userRoutes = bind([
  get('/', { perm: 'user:write', query: v.listQuery, h: c.index, read: true }),
  post('/', { perm: 'user:write', body: v.createBody, h: c.create }),
  get('/:id', { perm: 'user:write', params: v.idParam, h: c.show, read: true }),
  patch('/:id', { perm: 'user:write', params: v.idParam, body: v.updateBody, h: c.update }),
  // One role per account, per the specification's five. /roles stays for older clients and refuses a list
  // longer than one, so nobody can quietly build a union of powers through an endpoint that looks legacy.
  post('/:id/role', { perm: 'user:write', params: v.idParam, body: v.roleBody, h: c.setRole }),
  post('/:id/roles', { perm: 'user:write', params: v.idParam, body: v.rolesBodyLegacy, h: c.roles }),
  post('/:id/invite', { perm: 'user:write', params: v.idParam, body: v.inviteBody.optional(), h: c.invite, idem: true }),
  // Who is waiting for their first password, and the one-by-one send for all of them at once.
  get('/invites/pending', { perm: 'user:write', h: c.pendingInvites, read: true }),
  post('/invites/send-pending', { perm: 'user:write', body: v.sendPendingBody, h: c.sendPending, idem: true }),
  get('/:id/invites', { perm: 'user:write', params: v.idParam, h: c.invites, read: true }),
  post('/:id/deactivate', { perm: 'user:write', params: v.idParam, h: c.deactivate }),
  post('/:id/activate', { perm: 'user:write', params: v.idParam, h: c.activate }),
  post('/:id/reset-password', { perm: 'user:write', params: v.idParam, body: v.passwordBody, h: c.resetPassword }),
]);
