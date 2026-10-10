// @lm/db: SQLite schema, migrations, repositories, live queries and search
// (ARCHITECTURE.md §4, ADR-018).
export { createSerialDriver } from './driver/serial';
export {
  SqlError,
  type RawSql,
  type Row,
  type SqlDriver,
  type SqlExecutor,
  type SqlValue,
} from './driver/types';
// The in-memory driver (tests) is '@lm/db/memory', so the main thread of an
// app doesn't bundle the sqlite-wasm loader; only the worker needs it.
export { openWorkerDriver } from './driver/worker-client';
export type { MessagePortLike } from './driver/worker-protocol';
export { createTauriDriver, type TauriSqlDatabase } from './driver/tauri';
export { createCapacitorDriver, type CapacitorSqliteConnection } from './driver/capacitor';
export { DatabaseTooNewError, migrate } from './schema/migrate';
export { MIGRATIONS, type Migration } from './schema/migrations';
export {
  LmDatabase,
  RecordNotFoundError,
  type ChangeLogEntry,
  type DatabaseOptions,
  type KeptFile,
  type SyncTx,
  type ListOptions,
  type Patch,
  type RowProblem,
  type SearchHit,
} from './repo/database';
// AttachmentStore is imported from '@lm/db/attachments' so apps don't load
// libsodium at startup just by opening the database.
