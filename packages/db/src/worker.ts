import sqlite3InitModule from '@sqlite.org/sqlite-wasm';
import type { SqlValue } from './driver';
const scope = self as unknown as DedicatedWorkerGlobalScope;
const database = sqlite3InitModule().then(async (sqlite) => {
  const pool = await sqlite.installOpfsSAHPoolVfs({
    name: 'life-manager',
    directory: '/life-manager',
    initialCapacity: 6,
  });
  return new pool.OpfsSAHPoolDb('/life-manager.sqlite3');
});
scope.onmessage = (event: MessageEvent<{ id: number; sql: string; bind: SqlValue[] }>) => {
  const { id, sql, bind } = event.data;
  void database
    .then((db) => {
      if (sql === 'close') {
        db.close();
        scope.postMessage({ id, rows: [] });
        return;
      }
      const rows = db.exec(sql, { bind, rowMode: 'object', returnValue: 'resultRows' });
      scope.postMessage({ id, rows });
    })
    .catch(() =>
      scope.postMessage({
        id,
        error:
          'Local storage unavailable. Close other Life Manager tabs and use a browser with persistent storage.',
      }),
    );
};
