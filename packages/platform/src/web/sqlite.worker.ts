// Web SQLite worker: sqlite-wasm with the `opfs-sahpool` VFS (ADR-011), which
// persists in OPFS without needing COOP/COEP headers. Falls back to an
// in-memory database (with a warning flag) when OPFS is unavailable.

import init from '@sqlite.org/sqlite-wasm';
import { WasmSql } from '../wasm-sql';
import type { SqlStatement, SqlValue } from '../types';

type Req =
  | { id: number; op: 'open'; name: string }
  | { id: number; op: 'exec'; sql: string; params?: SqlValue[] }
  | { id: number; op: 'query'; sql: string; params?: SqlValue[] }
  | { id: number; op: 'batch'; statements: SqlStatement[] }
  | { id: number; op: 'close' };

let db: WasmSql | null = null;
const scope = self as unknown as {
  onmessage: ((e: MessageEvent<Req>) => void) | null;
  postMessage(m: unknown): void;
};

async function open(name: string): Promise<{ persistent: boolean }> {
  const sqlite3 = await init();
  try {
    const pool = await sqlite3.installOpfsSAHPoolVfs({
      name: 'lm-sahpool',
      directory: '/lm-sahpool',
    });
    db = new WasmSql(new pool.OpfsSAHPoolDb(`/${name}.sqlite3`));
    return { persistent: true };
  } catch {
    db = new WasmSql(new sqlite3.oo1.DB(':memory:', 'c'));
    return { persistent: false };
  }
}

scope.onmessage = (e) => {
  const req = e.data;
  void (async () => {
    try {
      let result: unknown = null;
      if (req.op === 'open') result = await open(req.name);
      else {
        if (!db) throw new Error('database not open');
        if (req.op === 'exec') db.exec(req.sql, req.params);
        else if (req.op === 'query') result = db.query(req.sql, req.params);
        else if (req.op === 'batch') db.batch(req.statements);
        else if (req.op === 'close') {
          db.close();
          db = null;
        }
      }
      scope.postMessage({ id: req.id, ok: true, result });
    } catch (err) {
      scope.postMessage({
        id: req.id,
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  })();
};
