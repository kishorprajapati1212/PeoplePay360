import { AppError, mapDbError } from '../lib/shared/index.js';
import { config } from '../config.js';
import { logger } from '../logger.js';
/** Every failure leaves as {error:{code,message,details}} — the UI switches on `code`, never on prose. */
export function notFound(req, res) { res.status(404).json({ error: { code: 'NOT_FOUND', message: `No route for ${req.method} ${req.path}` } }); }
export function errorHandler(err, req, res, _next) {
  const mapped = err instanceof AppError ? err : (mapDbError(err) || normalise(err));
  const status = mapped.status || 500;
  const body = { error: { code: mapped.code || 'INTERNAL', message: mapped.message || 'Unexpected error', details: mapped.details }, requestId: req.id };
  if (status >= 500) logger.error({ rid: req.id, err: mapped.stack || mapped.message }, 'unhandled');
  else logger.debug({ rid: req.id, code: mapped.code, msg: mapped.message }, 'handled');
  if (config.isProd && status >= 500) body.error.message = 'Internal server error';
  res.status(status).json(body);
}
function normalise(err) {
  if (err?.type === 'entity.parse.failed') return new AppError('BAD_JSON', 'Request body is not valid JSON', { status: 400 });
  if (err?.code === '23505' || err?.code === '23514' || err?.code === '23503') return mapDbError(err) || err;
  if (err?.code === '22P02') return new AppError('INVALID_ID', 'An id in this request is not valid', { status: 400 });
  return err;
}
