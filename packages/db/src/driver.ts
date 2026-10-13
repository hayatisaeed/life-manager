export type SqlValue = null | string | number | bigint | Uint8Array | Int8Array | ArrayBuffer;
export interface SqlDriver {
  query(sql: string, bind?: SqlValue[]): Promise<Record<string, SqlValue>[]>;
  transaction<T>(run: (driver: Pick<SqlDriver, 'query'>) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}
export function serializedDriver(
  execute: SqlDriver['query'],
  dispose: () => Promise<void>,
): SqlDriver {
  let queue: Promise<unknown> = Promise.resolve();
  function serial<T>(run: () => Promise<T>): Promise<T> {
    const result = queue.then(run);
    queue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
  return {
    query: (sql, bind) => serial(() => execute(sql, bind)),
    transaction: (run) =>
      serial(async () => {
        await execute('BEGIN IMMEDIATE');
        try {
          const result = await run({ query: execute });
          await execute('COMMIT');
          return result;
        } catch (error) {
          await execute('ROLLBACK');
          throw error;
        }
      }),
    close: () => serial(dispose),
  };
}
