import { AppError } from '../lib/shared/index.js';
/** zod in, typed `req.valid` out. Body + query + params are all validated, all reported together. */
export const validate = (schemaOrFactory, source = 'body') => (req, _res, next) => {
  const schema = typeof schemaOrFactory === 'function' ? schemaOrFactory(source === 'params' ? 'id' : undefined) : schemaOrFactory;
  const data = source === 'query' ? req.query : source === 'params' ? req.params : req.body;
  const r = schema.safeParse(data ?? {});
  if (!r.success) {
    return next(AppError.badRequest('Some fields need attention', {
      code: 'VALIDATION_ERROR',
      details: { fields: r.error.issues.map((i) => ({ field: i.path.join('.') || '(root)', message: i.message, code: i.code })) },
    }));
  }
  req.valid = { ...(req.valid || {}), [source]: r.data };
  if (source === 'body') req.body = r.data;
  if (source === 'query') Object.assign(req.query, r.data);
  next();
};
