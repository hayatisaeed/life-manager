// Entry point of the web SQLite worker (ADR-011, ADR-018). The app starts it
// with `new Worker(new URL('@lm/db/sqlite.worker', import.meta.url), { type: 'module' })`
// and passes it to `openWorkerDriver`.
import { openOpfsRawSql } from './opfs';
import { serveSql } from '../driver/worker-host';
import type { MessagePortLike } from '../driver/worker-protocol';

declare const self: MessagePortLike;

serveSql(self, openOpfsRawSql);
