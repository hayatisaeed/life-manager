// SqlDriver over an sqlite-wasm `oo1.DB`. Used inside the web worker and
// directly in Node tests ("the web driver", AGENTS.md §6).

import type { Database } from '@sqlite.org/sqlite-wasm';
import type { Row, SqlDriver, SqlStatement, SqlValue } from './types';

type Bind = (string | number | null | Uint8Array)[];

/** Synchronous operations on one connection; the worker and the Node driver wrap this. */
export class WasmSql {
  constructor(private readonly db: Database) {}

  exec(sql: string, params: SqlValue[] = []): void {
    if (params.length) this.db.exec({ sql, bind: params as Bind });
    else this.db.exec(sql);
  }

  query(sql: string, params: SqlValue[] = []): Row[] {
    return (
      params.length ? this.db.selectObjects(sql, params as Bind) : this.db.selectObjects(sql)
    ) as Row[];
  }

  batch(statements: SqlStatement[]): void {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      for (const s of statements) this.exec(s.sql, s.params);
      this.db.exec('COMMIT');
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
  }

  close(): void {
    this.db.close();
  }
}

/** In-process async driver (Node tests, or main-thread fallback without OPFS). */
export function wasmDriver(db: Database): SqlDriver {
  const w = new WasmSql(db);
  return {
    exec: async (sql, params) => w.exec(sql, params),
    query: async <T extends Row>(sql: string, params?: SqlValue[]) => w.query(sql, params) as T[],
    batch: async (s) => w.batch(s),
    close: async () => w.close(),
  };
}

/** A fresh in-memory database (tests and the memory platform). */
export async function memoryDriver(): Promise<SqlDriver> {
  const { default: init } = await import('@sqlite.org/sqlite-wasm');
  const sqlite3 = await init();
  return wasmDriver(new sqlite3.oo1.DB(':memory:', 'c'));
}
