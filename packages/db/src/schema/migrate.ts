import type { SqlDriver } from '../driver/types';
import { MIGRATIONS, type Migration } from './migrations';

/** Thrown when the database was written by a newer app version. */
export class DatabaseTooNewError extends Error {
  override name = 'DatabaseTooNewError';
}

/**
 * Applies pending migrations in order, each in one transaction, and returns
 * the versions it applied. `now` stamps `applied_at` (an Instant).
 */
export async function migrate(
  db: SqlDriver,
  now: () => string,
  migrations: readonly Migration[] = MIGRATIONS,
): Promise<number[]> {
  await db.script(
    'CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY NOT NULL, name TEXT NOT NULL, applied_at TEXT NOT NULL)',
  );
  const rows = await db.all<{ version: number }>('SELECT version FROM schema_migrations');
  const done = new Set(rows.map((r) => r.version));
  const latest = Math.max(0, ...migrations.map((m) => m.version));
  const newest = Math.max(0, ...done);
  if (newest > latest) {
    throw new DatabaseTooNewError(
      `Database schema ${String(newest)} is newer than this app (${String(latest)})`,
    );
  }
  const applied: number[] = [];
  for (const m of [...migrations].sort((a, b) => a.version - b.version)) {
    if (done.has(m.version)) continue;
    await db.transaction(async (tx) => {
      await tx.script(m.sql);
      await tx.run('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)', [
        m.version,
        m.name,
        now(),
      ]);
    });
    applied.push(m.version);
  }
  return applied;
}
