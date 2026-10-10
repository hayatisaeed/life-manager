import { createSerialDriver } from './serial';
import type { Row, SqlDriver, SqlValue } from './types';

/**
 * The part of `@capacitor-community/sqlite`'s `SQLiteDBConnection` we use. The
 * mobile shell opens the connection and passes it in.
 *
 * Every call passes `transaction = false`: the plugin otherwise wraps each
 * statement in its own transaction, which would break ours.
 * UNVERIFIED on a device (P0.2 Capacitor spike).
 */
export interface CapacitorSqliteConnection {
  run(
    statement: string,
    values?: unknown[],
    transaction?: boolean,
  ): Promise<{ changes?: { changes?: number } }>;
  query(statement: string, values?: unknown[]): Promise<{ values?: unknown[] }>;
  execute(statements: string, transaction?: boolean): Promise<unknown>;
  close(): Promise<void>;
}

export function createCapacitorDriver(db: CapacitorSqliteConnection): SqlDriver {
  return createSerialDriver({
    run: async (sql, params) => ({
      changes: (await db.run(sql, [...(params ?? [])], false)).changes?.changes ?? 0,
    }),
    all: async <T extends Row>(sql: string, params?: readonly SqlValue[]) =>
      ((await db.query(sql, [...(params ?? [])])).values ?? []) as T[],
    script: async (sql) => {
      await db.execute(sql, false);
    },
    close: () => db.close(),
  });
}
