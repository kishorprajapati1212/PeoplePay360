#!/usr/bin/env node
// Tiny, dependency-free migration runner. One transaction per file, ordered by filename.
//   node db/migrate.js            apply pending
//   node db/migrate.js --reset    drop schema, re-apply everything
//   node db/migrate.js --status   show applied/pending
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations');
const url =
  process.env.DATABASE_URL ||
  `postgres://${process.env.PGUSER || 'postgres'}:${process.env.PGPASSWORD || 'postgres'}@${
    process.env.PGHOST || '127.0.0.1'
  }:${process.env.PGPORT || 5432}/${process.env.PGDATABASE || 'peoplepay360'}`;

const args = new Set(process.argv.slice(2));
const files = fs
  .readdirSync(DIR)
  .filter((f) => f.endsWith('.sql'))
  .sort();

const client = new pg.Client({ connectionString: url, statement_timeout: 0 });
try {
  await client.connect();
} catch (e) {
  // A friendly "the database is not up yet" beats a stack trace, because that is the first thing
  // anyone hits when they run `npm run setup` before `docker compose up -d postgres`.
  console.error(`\n✗ migrate: cannot reach Postgres — ${e.message}`);
  console.error(`  connection tried: ${url.replace(/\/\/[^@/]*@/, '//***@')}`);
  console.error('  start it with:    docker compose up -d postgres   (or point DATABASE_URL / backend/.env at your own)\n');
  process.exit(1);
}
try {
  await client.query(
    `CREATE TABLE IF NOT EXISTS schema_migrations(
       filename text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())`
  );
  if (args.has('--reset')) {
    await client.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
    await client.query('DROP TABLE IF EXISTS schema_migrations');
    await client.query(
      `CREATE TABLE schema_migrations(filename text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())`
    );
    console.log('[migrate] schema reset');
  }
  const done = new Map(
    (await client.query('SELECT filename, checksum FROM schema_migrations')).rows.map((r) => [r.filename, r.checksum])
  );
  const hash = async (s) => (await import('node:crypto')).createHash('sha256').update(s).digest('hex').slice(0, 16);

  let applied = 0;
  for (const f of files) {
    const sql = fs.readFileSync(path.join(DIR, f), 'utf8');
    const sum = await hash(sql);
    if (args.has('--status')) {
      console.log(`${done.has(f) ? 'applied' : 'pending'}  ${f}`);
      continue;
    }
    if (done.get(f) === sum) continue;
    const noTx = /^--?\s*no-transaction/m.test(sql);
    if (!done.has(f)) {
      if (noTx) {
        await client.query(sql);
      } else {
        await client.query('BEGIN');
        try {
          await client.query(sql);
          await client.query('INSERT INTO schema_migrations(filename, checksum) VALUES($1,$2) ON CONFLICT (filename) DO UPDATE SET checksum=EXCLUDED.checksum', [f, sum]);
          await client.query('COMMIT');
        } catch (e) {
          await client.query('ROLLBACK');
          throw new Error(`${f}: ${e.message}`);
        }
      }
      if (noTx) await client.query('INSERT INTO schema_migrations(filename, checksum) VALUES($1,$2) ON CONFLICT (filename) DO UPDATE SET checksum=EXCLUDED.checksum', [f, sum]);
      console.log(`[migrate] + ${f}`);
      applied++;
    } else if (done.get(f) !== sum) {
      console.warn(`[migrate] ! ${f} changed after being applied (edits to applied migrations are ignored; add a new file)`);
    }
  }
  if (!args.has('--status')) console.log(`[migrate] done (${applied} applied, ${files.length} total)`);
} finally {
  await client.end();
}
