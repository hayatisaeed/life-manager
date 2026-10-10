import { CONNECTION_PRAGMAS, loadSqlite, wasmRawSql } from '../driver/wasm';
import type { RawSql } from '../driver/types';

/**
 * A persistent database on the `opfs-sahpool` VFS (ADR-011). Only works inside
 * a dedicated worker, and only one connection per origin can hold the pool.
 */
export async function openOpfsRawSql(fileName: string): Promise<RawSql> {
  const s = await loadSqlite();
  const pool = await s.installOpfsSAHPoolVfs({ name: 'lm-sahpool' });
  // The pool pre-allocates a fixed number of file slots (6 by default), and a
  // database needs one for itself and one for its journal.
  await pool.reserveMinimumCapacity(pool.getFileCount() + 4);
  const db = new pool.OpfsSAHPoolDb(fileName);
  db.exec(CONNECTION_PRAGMAS);
  return wasmRawSql(db);
}
