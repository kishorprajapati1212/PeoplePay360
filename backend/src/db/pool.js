import pg from 'pg';
import { config } from '../config.js';
import { logger } from '../logger.js';

/**
 * DATE columns must survive the trip to the browser as 'YYYY-MM-DD' — never as an instant.
 * node-postgres's default turns DATE into a Date at *local* midnight; with TZ=Asia/Kolkata that is
 * 18:30Z of the previous evening, and JSON.stringify then ships 2026-10-01 as
 * "2026-09-30T18:30:00.000Z". Every screen that sliced that string showed dates one day early
 * (payrun periods "30 Sep – 30 Oct 2026", attendance days, joining dates). Parsing DATE back to
 * the plain string kills the whole class of bug at the source; timestamptz (check-in punches,
 * created_at) is untouched and still arrives as a real instant.
 */
pg.types.setTypeParser(1082, (v) => v);

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
