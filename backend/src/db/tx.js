import { pool } from './pool.js';
import { mapDbError } from '../lib/shared/index.js';

/**
 * Runs fn(client) in a transaction. `client` exposes the same q() helper so repositories can be
 * written once and used with or without a transaction. Serialisation failures are retried by the caller.
 */
export async function transaction(fn, { isolation = 'read committed', onConflict } = {}) {
  const client = await pool.connect();
  try {
    await client.query(`begin isolation level ${isolation}`);
    const out = await fn(client);
    await client.query('commit');
    return out;
  } catch (e) {
    await client.query('rollback').catch(() => {});
    if (onConflict) { const handled = onConflict(e); if (handled !== undefined) return handled; }
    throw mapDbError(e) || e;
  } finally {
    client.release();
  }
}
