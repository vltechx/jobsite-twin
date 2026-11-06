// Applies server/migrations/*.sql in filename order. Each file runs once, in its own
// transaction, and is recorded in schema_migrations.
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { pool, withTransaction } from '../db.js';

const MIGRATIONS_DIR = fileURLToPath(new URL('../../migrations/', import.meta.url));

async function main(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name       text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  const { rows } = await pool.query<{ name: string }>('SELECT name FROM schema_migrations');
  const applied = new Set(rows.map((r) => r.name));

  const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort();
  const pending = files.filter((f) => !applied.has(f));
  if (pending.length === 0) {
    console.log('Database is up to date.');
    return;
  }

  for (const file of pending) {
    const sql = await readFile(MIGRATIONS_DIR + file, 'utf8');
    await withTransaction(async (client) => {
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
    });
    console.log(`Applied ${file}`);
  }
}

main()
  .catch((err) => {
    console.error('Migration failed:', err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
