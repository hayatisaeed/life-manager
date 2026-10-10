import { createSerialDriver } from './serial';
import { SqlError, type RawSql, type Row, type SqlDriver, type SqlValue } from './types';
import type { MessagePortLike, WorkerRequest, WorkerResponse } from './worker-protocol';

type Pending = { resolve: (value: unknown) => void; reject: (error: Error) => void };
type Request = WorkerRequest extends infer R
  ? R extends { id: number }
    ? Omit<R, 'id'>
    : never
  : never;

/**
 * Main-thread side of the web driver: SQLite runs in a dedicated worker on
 * `opfs-sahpool` (ADR-011). `worker` is the Worker running `sqlite.worker.ts`.
 */
export async function openWorkerDriver(
  worker: MessagePortLike,
  fileName: string,
): Promise<SqlDriver> {
  let nextId = 1;
  const pending = new Map<number, Pending>();
  worker.addEventListener('message', (event) => {
    const res = event.data as WorkerResponse;
    const p = pending.get(res.id);
    if (!p) return;
    pending.delete(res.id);
    if (res.ok) p.resolve(res.result);
    else p.reject(new SqlError(res.message));
  });
  const call = (req: Request): Promise<unknown> =>
    new Promise((resolve, reject) => {
      const id = nextId++;
      pending.set(id, { resolve, reject });
      worker.postMessage({ ...req, id });
    });

  await call({ op: 'open', fileName });
  const raw: RawSql = {
    run: async (sql, params) =>
      (await call({ op: 'run', sql, params: [...(params ?? [])] })) as { changes: number },
    all: async <T extends Row>(sql: string, params?: readonly SqlValue[]) =>
      (await call({ op: 'all', sql, params: [...(params ?? [])] })) as T[],
    script: async (sql) => {
      await call({ op: 'script', sql });
    },
    close: async () => {
      await call({ op: 'close' });
    },
  };
  return createSerialDriver(raw);
}
