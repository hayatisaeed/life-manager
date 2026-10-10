// Numbered schema migrations (ARCHITECTURE.md §4). Append only; never edit a
// shipped migration.

import type { SqlDriver } from '@lm/platform';

export interface Migration {
  version: number;
  sql: string[];
}

/** Per-type expression indexes over the generic records table (ADR-011). */
const idx = (name: string, type: string, exprs: string[]) =>
  `CREATE INDEX IF NOT EXISTS ${name} ON records(${exprs
    .map((p) => `json_extract(data, '$.${p}')`)
    .join(', ')}) WHERE type = '${type}'`;

export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    sql: [
      `CREATE TABLE records (
        rid INTEGER PRIMARY KEY AUTOINCREMENT,
        id TEXT NOT NULL UNIQUE,
        type TEXT NOT NULL,
        schema INTEGER NOT NULL,
        hlc TEXT NOT NULL,
        field_hlc TEXT NOT NULL,
        deleted_at TEXT,
        created_at TEXT NOT NULL,
        data TEXT NOT NULL
      )`,
      `CREATE INDEX records_type ON records(type, deleted_at)`,
      idx('rec_task_status_due', 'task', ['status', 'dueDate']),
      idx('rec_task_project', 'task', ['projectId']),
      idx('rec_task_parent', 'task', ['parentId']),
      idx('rec_event_start', 'event', ['start']),
      idx('rec_block_start', 'timeBlock', ['start']),
      idx('rec_habitlog', 'habitLog', ['habitId', 'date']),
      idx('rec_tx_date', 'transaction', ['date']),
      idx('rec_tx_account', 'transaction', ['accountId']),
      idx('rec_health', 'healthLog', ['date', 'metric']),
      idx('rec_journal_date', 'journalEntry', ['date']),
      idx('rec_card_deck', 'card', ['deckId']),
      idx('rec_interaction_date', 'interaction', ['date']),
      idx('rec_shopping_list', 'shoppingItem', ['listId']),
      idx('rec_link_to', 'link', ['to.id']),
      idx('rec_link_from', 'link', ['from.id']),
      `CREATE VIRTUAL TABLE search USING fts5(title, body, tokenize = 'unicode61 remove_diacritics 2')`,
      // Sync bookkeeping (SYNC.md §4).
      `CREATE TABLE change_log (id TEXT PRIMARY KEY, hlc TEXT NOT NULL)`,
      `CREATE TABLE sync_base (id TEXT PRIMARY KEY, envelope TEXT NOT NULL)`,
      // `meta` is transport-specific per-path state (GitLab: the file's last commit id).
      `CREATE TABLE sync_remote (path TEXT PRIMARY KEY, sha TEXT NOT NULL, kind TEXT NOT NULL, meta TEXT)`,
      `CREATE TABLE sync_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)`,
      `CREATE TABLE sync_problems (path TEXT PRIMARY KEY, reason TEXT NOT NULL, sha TEXT, at TEXT NOT NULL)`,
      // Device-local state (never synced, DATA-MODEL.md §14).
      `CREATE TABLE device_kv (key TEXT PRIMARY KEY, value TEXT NOT NULL)`,
      `CREATE TABLE blobs (
        hash TEXT PRIMARY KEY,
        bytes BLOB NOT NULL,
        mime TEXT NOT NULL,
        size INTEGER NOT NULL,
        state TEXT NOT NULL,
        created_at TEXT NOT NULL
      )`,
      `CREATE TABLE external_events (
        connector_id TEXT NOT NULL,
        external_id TEXT NOT NULL,
        etag TEXT,
        start TEXT NOT NULL,
        end TEXT NOT NULL,
        data TEXT NOT NULL,
        PRIMARY KEY (connector_id, external_id)
      )`,
      `CREATE INDEX external_events_start ON external_events(start)`,
    ],
  },
];

export async function migrate(driver: SqlDriver): Promise<number> {
  await driver.exec('CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)');
  const rows = await driver.query<{ version: number }>(
    'SELECT max(version) AS version FROM schema_version',
  );
  let current = rows[0]?.version ?? 0;
  for (const m of MIGRATIONS) {
    if (m.version <= current) continue;
    await driver.batch([
      ...m.sql.map((sql) => ({ sql })),
      { sql: 'INSERT INTO schema_version (version) VALUES (?)', params: [m.version] },
    ]);
    current = m.version;
  }
  return current;
}
