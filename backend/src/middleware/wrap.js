/** Express 4 doesn't catch async rejections; every route goes through this. */
export const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
