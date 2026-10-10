import type { RawSql, SqlDriver, SqlExecutor, SqlValue } from './types';

/**
 * Wraps a platform's raw SQL access in a single queue. Every platform here
 * reaches SQLite through async calls (a worker, a Tauri IPC call, a Capacitor
 * bridge), so without the queue a statement from elsewhere in the app could
 * land inside an open transaction.
 */
export function createSerialDriver(raw: RawSql): SqlDriver {
  let tail: Promise<unknown> = Promise.resolve();
  let closed = false;

  const enqueue = <T>(job: () => Promise<T>): Promise<T> => {
    if (closed) return Promise.reject(new Error('database is closed'));
    const result = tail.then(job);
    // The next job waits for this one whether it succeeds or fails.
    tail = result.catch(() => undefined);
    return result;
  };

  return {
    run: (sql: string, params?: readonly SqlValue[]) => enqueue(() => raw.run(sql, params)),
    all: (sql, params) => enqueue(() => raw.all(sql, params)),
    script: (sql) => enqueue(() => raw.script(sql)),
    transaction: <T>(fn: (tx: SqlExecutor) => Promise<T>) =>
      enqueue(async () => {
        // IMMEDIATE takes the write lock up front, so a transaction never
        // fails half-way with SQLITE_BUSY after it has read.
        await raw.run('BEGIN IMMEDIATE');
        let active = true;
        const tx: SqlExecutor = {
          run: (sql, params) => (active ? raw.run(sql, params) : finished()),
          all: (sql, params) => (active ? raw.all(sql, params) : finished()),
          script: (sql) => (active ? raw.script(sql) : finished()),
        };
        try {
          const value = await fn(tx);
          await raw.run('COMMIT');
          return value;
        } catch (error) {
          await raw.run('ROLLBACK').catch(() => undefined);
          throw error;
        } finally {
          active = false;
        }
      }),
    close: () =>
      enqueue(async () => {
        closed = true;
        await raw.close();
      }),
  };
}

function finished(): never {
  throw new Error('transaction already finished');
}
