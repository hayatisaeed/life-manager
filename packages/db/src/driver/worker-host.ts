import type { MessagePortLike, WorkerRequest, WorkerResponse } from './worker-protocol';
import type { RawSql } from './types';

/**
 * Runs inside the SQLite worker. The client already serializes calls, so the
 * host just executes them in arrival order.
 */
export function serveSql(port: MessagePortLike, open: (fileName: string) => Promise<RawSql>): void {
  let db: RawSql | null = null;
  let queue: Promise<unknown> = Promise.resolve();

  const handle = async (req: WorkerRequest): Promise<unknown> => {
    if (req.op === 'open') {
      // A page that reconnects (or a test opening a fresh file) replaces the
      // previous connection rather than leaking it.
      if (db) await db.close();
      db = null;
      db = await open(req.fileName);
      return null;
    }
    if (!db) throw new Error('database is not open');
    switch (req.op) {
      case 'run':
        return db.run(req.sql, req.params);
      case 'all':
        return db.all(req.sql, req.params);
      case 'script':
        return db.script(req.sql);
      case 'close': {
        const closing = db;
        db = null;
        return closing.close();
      }
    }
  };

  port.addEventListener('message', (event) => {
    const req = event.data as WorkerRequest;
    queue = queue.then(async () => {
      let response: WorkerResponse;
      try {
        response = { id: req.id, ok: true, result: await handle(req) };
      } catch (error) {
        response = {
          id: req.id,
          ok: false,
          message: error instanceof Error ? error.message : String(error),
        };
      }
      port.postMessage(response);
    });
  });
}
