import sqlite3InitModule from '@sqlite.org/sqlite-wasm';
import { createSerialDriver } from './serial';
import { SqlError, type RawSql, type Row, type SqlDriver, type SqlValue } from './types';

type Sqlite3 = Awaited<ReturnType<typeof sqlite3InitModule>>;
type Oo1Db = InstanceType<Sqlite3['oo1']['DB']>;

/**
 * Settings every connection gets. ARCHITECTURE.md §4: the default 2 MiB page
 * cache made full scans of a 30 MiB database take seconds on OPFS.
 */
export const CONNECTION_PRAGMAS = 'PRAGMA cache_size = -32000; PRAGMA foreign_keys = ON;';

let sqlite3: Promise<Sqlite3> | null = null;
export const loadSqlite = () => (sqlite3 ??= sqlite3InitModule());

/** Raw access to an open sqlite-wasm database (synchronous API, async wrapper). */
export function wasmRawSql(db: Oo1Db): RawSql {
  const guard = <T>(fn: () => T): Promise<T> => {
    try {
      return Promise.resolve(fn());
    } catch (error) {
      return Promise.reject(new SqlError(error instanceof Error ? error.message : String(error)));
    }
  };
  // Prepared statements rather than `db.exec` so each call runs exactly one
  // statement and binds exactly its own parameters.
  const each = (
    sql: string,
    params: readonly SqlValue[] | undefined,
    onRow: (row: Row) => void,
  ) => {
    const stmt = db.prepare(sql);
    try {
      if (params && params.length > 0) stmt.bind([...params]);
      while (stmt.step()) onRow(stmt.get({}) as Row);
    } finally {
      stmt.finalize();
    }
  };
  return {
    run: (sql, params) =>
      guard(() => {
        each(sql, params, () => undefined);
        return { changes: db.changes() };
      }),
    all: <T extends Row>(sql: string, params?: readonly SqlValue[]) =>
      guard(() => {
        const rows: Row[] = [];
        each(sql, params, (row) => rows.push(row));
        return rows as T[];
      }),
    script: (sql) =>
      guard(() => {
        db.exec(sql);
      }),
    close: () =>
      guard(() => {
        db.close();
      }),
  };
}

/** An in-memory database. Used by tests in Node; the same SQLite build as the web worker. */
export async function openMemoryDriver(): Promise<SqlDriver> {
  return createSerialDriver(await openMemoryRawSql());
}

export async function openMemoryRawSql(): Promise<RawSql> {
  const s = await loadSqlite();
  const db = new s.oo1.DB(':memory:', 'c');
  db.exec(CONNECTION_PRAGMAS);
  return wasmRawSql(db);
}
