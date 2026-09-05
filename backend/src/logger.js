import pino from 'pino';
export const logger = pino({
  level: process.env.LOG_LEVEL || (process.env.NODE_ENV === 'production' ? 'info' : 'debug'),
  base: undefined,
  timestamp: pino.stdTimeFunctions.isoTime,
  ...(process.env.NODE_ENV === 'production' ? {} : { transport: undefined }),
});
/** Child logger bound to a request id so a whole HTTP call is greppable in one line. */
export const reqLogger = (req) => logger.child({ rid: req.id });
