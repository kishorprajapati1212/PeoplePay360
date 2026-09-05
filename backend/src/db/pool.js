import pg from 'pg';
import { config } from '../config.js';
import { logger } from '../logger.js';

export const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  max: config.pg.max,
  idleTimeoutMillis: config.pg.idleTimeoutMillis,
  connectionTimeoutMillis: 8000,
  ssl: config.pg.ssl ? { rejectUnauthorized: false } : undefined,
  application_name: 'pp360-api',
});
pool.on('error', (e) => logger.error({ err: e }, 'idle client error'));
/**
 * NOTE on numerics: node-postgres returns NUMERIC as a *string* on purpose. We keep it that way and
 * convert explicitly in the repository mappers — a global parseFloat would silently wreck money math.
 */
export const query = (text, params) => pool.query(text, params);
export const one = async (text, params) => (await pool.query(text, params)).rows[0] ?? null;
export const rows = async (text, params) => (await pool.query(text, params)).rows;
