import { entityTable } from './tables';

// Numbered migrations (ARCHITECTURE.md §4, ADR-018). Never edit one that has
// shipped; add a new one. Each runs in its own transaction.

export interface Migration {
  readonly version: number;
  readonly name: string;
  readonly sql: string;
}

/**
 * The entity types that existed when migration 1 was written. Frozen: a type
 * added later gets its table from a new migration, and a test fails until it
 * does.
 */
const TYPES_V1 = [
  'area', 'tag', 'link',
  'inboxItem', 'project', 'task', 'goal', 'milestone',
  'event', 'timeBlock',
  'habit', 'habitLog', 'routine', 'routineRun', 'weeklyReview',
  'focusSession', 'timeEntry',
  'account', 'category', 'transaction', 'budget', 'bill', 'savingsGoal', 'fxRate',
  'healthLog', 'metricDef', 'journalEntry', 'journalPrompt',
  'note', 'resource', 'deck', 'card', 'reviewLog',
  'document', 'shoppingList', 'shoppingItem', 'asset', 'maintenancePlan',
  'person', 'importantDate', 'interaction', 'relationship', 'giftIdea',
  'planProposal', 'insight',
  'settings',
] as const; // prettier-ignore

/**
 * Indexes on `data` fields that list and planner queries filter or sort by.
 * Expressions must be written exactly like this in queries for SQLite to use
 * them.
 */
const INDEXES_V1: Record<string, string[]> = {
  task: ['status', 'dueDate', 'projectId', 'areaId', 'parentId'],
  project: ['areaId'],
  milestone: ['goalId'],
  event: ['start'],
  timeBlock: ['start'],
  habitLog: ['habitId', 'date'],
  routineRun: ['routineId', 'date'],
  focusSession: ['start'],
  timeEntry: ['start'],
  transaction: ['accountId', 'date'],
  budget: ['month'],
  bill: ['nextDue'],
  healthLog: ['date', 'metric'],
  journalEntry: ['date'],
  card: ['deckId'],
  reviewLog: ['cardId'],
  shoppingItem: ['listId'],
  importantDate: ['personId'],
  interaction: ['date'],
  giftIdea: ['personId'],
};

export const dataField = (field: string) => `json_extract(data, '$.${field}')`;

function entityTableSql(type: string): string {
  const t = entityTable(type);
  const indexes = (INDEXES_V1[type] ?? []).map(
    (f) => `CREATE INDEX ${t}__${f} ON ${t} (${dataField(f)});`,
  );
  return [
    `CREATE TABLE ${t} (
      id TEXT PRIMARY KEY NOT NULL,
      schema INTEGER NOT NULL,
      hlc TEXT NOT NULL,
      field_hlc TEXT NOT NULL,
      deleted_at TEXT,
      created_at TEXT NOT NULL,
      device_id TEXT NOT NULL,
      data TEXT NOT NULL,
      extra TEXT
    );`,
    `CREATE INDEX ${t}__live ON ${t} (deleted_at);`,
    ...indexes,
  ].join('\n');
}

export const MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    name: 'entity tables, sync bookkeeping, search',
    sql: [
      ...TYPES_V1.map(entityTableSql),
      // SYNC.md §4. Device-local; none of this is ever pushed.
      `CREATE TABLE sync_meta (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL);`,
      `CREATE TABLE sync_remote (
        path TEXT PRIMARY KEY NOT NULL,
        sha TEXT NOT NULL,
        kind TEXT NOT NULL CHECK (kind IN ('blob', 'tree'))
      );`,
      `CREATE TABLE sync_base (record_id TEXT PRIMARY KEY NOT NULL, type TEXT NOT NULL, envelope TEXT NOT NULL);`,
      `CREATE TABLE change_log (record_id TEXT PRIMARY KEY NOT NULL, type TEXT NOT NULL, hlc TEXT NOT NULL);`,
      // Remote files this device can't use (SYNC.md §10, ADR-013): kept, listed
      // under Settings → Sync → Problems, never deleted.
      `CREATE TABLE sync_kept (
        path TEXT PRIMARY KEY NOT NULL,
        blob_sha TEXT NOT NULL,
        record_id TEXT,
        reason TEXT NOT NULL,
        raw TEXT,
        issues TEXT NOT NULL,
        seen_at TEXT NOT NULL
      );`,
      // Full-text search (ADR-018). search_doc gives each record a stable rowid,
      // so updating one record's index entry doesn't scan the FTS table.
      `CREATE TABLE search_doc (
        rowid INTEGER PRIMARY KEY,
        type TEXT NOT NULL,
        id TEXT NOT NULL,
        UNIQUE (type, id)
      );`,
      `CREATE VIRTUAL TABLE search_fts USING fts5(
        title, body,
        tokenize = 'unicode61 remove_diacritics 2'
      );`,
    ].join('\n'),
  },
];
