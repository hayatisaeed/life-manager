// Main-thread proxy for the SQLite worker.

import type { Row, SqlDriver, SqlStatement, SqlValue } from '../types';

export interface WebDatabase extends SqlDriver {
  /** False when OPFS isn't available and data lives only in memory. */
  persistent: boolean;
}

export async function openWebDatabase(name: string): Promise<WebDatabase> {
  const worker = new Worker(new URL('./sqlite.worker.ts', import.meta.url), { type: 'module' });
  let nextId = 1;
  const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  worker.onmessage = (
    e: MessageEvent<{ id: number; ok: boolean; result?: unknown; error?: string }>,
  ) => {
    const p = pending.get(e.data.id);
    if (!p) return;
    pending.delete(e.data.id);
    if (e.data.ok) p.resolve(e.data.result);
    else p.reject(new Error(e.data.error ?? 'SQLite error'));
  };
  const call = (msg: Record<string, unknown>): Promise<unknown> =>
    new Promise((resolve, reject) => {
      const id = nextId++;
      pending.set(id, { resolve, reject });
      worker.postMessage({ ...msg, id });
    });
  const { persistent } = (await call({ op: 'open', name })) as { persistent: boolean };
  return {
    persistent,
    exec: async (sql: string, params?: SqlValue[]) => {
      await call({ op: 'exec', sql, params });
    },
    query: async <T extends Row>(sql: string, params?: SqlValue[]) =>
      (await call({ op: 'query', sql, params })) as T[],
    batch: async (statements: SqlStatement[]) => {
      await call({ op: 'batch', statements });
    },
    close: async () => {
      await call({ op: 'close' });
      worker.terminate();
    },
  };
}
