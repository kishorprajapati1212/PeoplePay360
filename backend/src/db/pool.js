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
export async function assertDbUp() {
  const r = await pool.query('select current_database() as db, version() as v, pg_catalog.pg_postmaster_start_time() as started');
  return r.rows[0];
}
export async function withRetry(fn, { attempts = 3, delayMs = 60 } = {}) {
  for (let i = 1; ; i++) {
    try { return await fn(); } catch (e) {
      // 40001 serialization_failure / 40P01 deadlock_detected are expected under concurrency
      const retryable = ['40001', '40P01', '08006', '57P01'].includes(e.code);
      if (!retryable || i >= attempts) throw e;
      await new Promise((r) => setTimeout(r, delayMs * i));
    }
  }
}
