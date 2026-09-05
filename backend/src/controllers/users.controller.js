import * as svc from '../services/user.service.js';
import { ok, created, list, filters } from './_http.js';
export const index = async (req, res) => list(res, await svc.list(filters(req.query, { q: 'search' })));
export const show = async (req, res) => ok(res, await svc.read(req.params.id));
export const create = async (req, res) => created(res, await svc.create(req.valid.body, { auth: req.auth }));
export const update = async (req, res) => ok(res, await svc.update(req.params.id, req.valid.body, { auth: req.auth }));
export const setRole = async (req, res) => ok(res, await svc.setRole(req.params.id, req.valid.body.role, { auth: req.auth }));
export const invite = async (req, res) => ok(res, await svc.createInvite(req.params.id, { auth: req.auth, sendEmail: req.valid.body?.send_email !== false }));
export const invites = async (req, res) => ok(res, { rows: await svc.invitesFor(req.params.id) });
export const pendingInvites = async (req, res) => {
  const rows = await svc.pendingInvites();
  ok(res, { rows, count: rows.length });
};
export const sendPending = async (req, res) => ok(res, await svc.sendPendingInvites({ auth: req.auth, limit: req.valid.body.limit }));
export const roles = async (req, res) => ok(res, { id: req.params.id, roles: await svc.setRoles(req.params.id, req.valid.body.roles, { auth: req.auth }) });
export const activate = async (req, res) => ok(res, await svc.setActive(req.params.id, true, { auth: req.auth }));
export const deactivate = async (req, res) => ok(res, await svc.setActive(req.params.id, false, { auth: req.auth }));
export const resetPassword = async (req, res) => ok(res, await svc.resetPassword(req.params.id, req.valid.body.password, { mustChange: req.valid.body.must_change_pw !== false, auth: req.auth }));
