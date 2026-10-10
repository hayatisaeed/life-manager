import { createSerialDriver } from './serial';
import { splitSqlScript } from './split';
import type { Row, SqlDriver, SqlValue } from './types';

/**
 * The part of `@tauri-apps/plugin-sql`'s `Database` we use. The desktop shell
 * loads it (`Database.load('sqlite:lm.db')`) and passes it in, so this package
 * doesn't depend on Tauri.
 *
 * UNVERIFIED on a device (P0.2 Tauri spike): the plugin runs queries on a
 * connection pool, and BEGIN/COMMIT must reach the same connection. If they
 * don't, the desktop needs a single-connection Rust command instead (ADR-018).
 */
export interface TauriSqlDatabase {
  execute(query: string, bindValues?: unknown[]): Promise<{ rowsAffected: number }>;
  select<T>(query: string, bindValues?: unknown[]): Promise<T>;
  close(): Promise<boolean>;
}

export function createTauriDriver(db: TauriSqlDatabase): SqlDriver {
  return createSerialDriver({
    run: async (sql, params) => ({
      changes: (await db.execute(sql, [...(params ?? [])])).rowsAffected,
    }),
    all: <T extends Row>(sql: string, params?: readonly SqlValue[]) =>
      db.select<T[]>(sql, [...(params ?? [])]),
    script: async (sql) => {
      for (const stmt of splitSqlScript(sql)) await db.execute(stmt);
    },
    close: async () => {
      await db.close();
    },
  });
}
