/**
 * What the database layer needs from SQLite, on every platform (ARCHITECTURE.md
 * §4). Values are limited to text, numbers and null: every platform plugin can
 * bind those, and nothing we store needs a BLOB (attachments live in files).
 */
export type SqlValue = string | number | null;
export type Row = Record<string, SqlValue>;

export interface SqlExecutor {
  /** Runs one statement and returns how many rows it changed. */
  run(sql: string, params?: readonly SqlValue[]): Promise<{ changes: number }>;
  /** Runs one query and returns its rows as objects keyed by column name. */
  all<T extends Row = Row>(sql: string, params?: readonly SqlValue[]): Promise<T[]>;
  /** Runs several statements without parameters (migrations). */
  script(sql: string): Promise<void>;
}

export interface SqlDriver extends SqlExecutor {
  /**
   * Runs `fn` in one transaction. Calls made outside `fn` wait until it ends,
   * so nothing interleaves. Rolls back and rethrows if `fn` throws.
   */
  transaction<T>(fn: (tx: SqlExecutor) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

/** The minimum a platform must provide. `createSerialDriver` adds ordering and transactions. */
export type RawSql = SqlExecutor & { close(): Promise<void> };

export class SqlError extends Error {
  override name = 'SqlError';
}
