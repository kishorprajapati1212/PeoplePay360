import pino from 'pino';

export const logger = pino({
  level: process.env.LOG_LEVEL || (process.env.NODE_ENV === 'production' ? 'info' : 'debug'),
  base: { service: 'worker' },
  timestamp: pino.stdTimeFunctions.isoTime,
});
export const jobLogger = (job) => logger.child({ job: job.name, id: job.id, taskId: job.data?.taskId });
