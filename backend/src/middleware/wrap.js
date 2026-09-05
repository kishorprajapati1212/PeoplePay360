/** Express 4 doesn't catch async rejections; every route goes through this. */
export const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
export class HttpError extends Error { constructor(status, message, code = 'ERROR', details) { super(message); this.status = status; this.code = code; this.details = details; } }
