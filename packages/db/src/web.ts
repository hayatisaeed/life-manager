import { serializedDriver } from './driver';
import type { SqlDriver, SqlValue } from './driver';
export async function createWebDriver(): Promise<SqlDriver> {
  const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
  let nextId = 0;
  const pending = new Map<
    number,
    { resolve: (rows: Record<string, SqlValue>[]) => void; reject: (error: Error) => void }
  >();
  worker.onmessage = (
    event: MessageEvent<{ id: number; rows?: Record<string, SqlValue>[]; error?: string }>,
  ) => {
    const request = pending.get(event.data.id);
    if (!request) return;
    pending.delete(event.data.id);
    if (event.data.error) request.reject(new Error(event.data.error));
    else request.resolve(event.data.rows ?? []);
  };
  worker.onerror = () => {
    for (const request of pending.values())
      request.reject(new Error('Local database worker failed'));
    pending.clear();
  };
  const execute: SqlDriver['query'] = (sql, bind = []) =>
    new Promise((resolve, reject) => {
      const id = nextId++;
      pending.set(id, { resolve, reject });
      worker.postMessage({ id, sql, bind });
    });
  const driver = serializedDriver(execute, async () => {
    await execute('close');
    worker.terminate();
  });
  try {
    await driver.query('SELECT 1');
    return driver;
  } catch (error) {
    worker.terminate();
    throw error;
  }
}
