import { createSyncStore } from './sync-store';
import type { SyncStore } from './sync-store';
export * from './sync-store';
import { entitySchemas, parseRecord, tickHlc, parseHlc, formatHlc, editText } from '@lm/core';
import type { Envelope, EntityType, ClockState } from '@lm/core';
import type { SqlDriver, SqlValue } from './driver';
export * from './driver';
export * from './web';
const longText = new Set([
  'body',
  'notes',
  'content',
  'why',
  'done',
  'slipped',
  'next',
  'highlights',
  'rationale',
  'narrative',
]);
export interface Repository {
  sync: SyncStore;
  list(type?: EntityType, includeDeleted?: boolean): Promise<Envelope[]>;
  get(id: string): Promise<Envelope | null>;
  put(type: EntityType, id: string, data: Envelope['data'], unset?: string[]): Promise<Envelope>;
  remove(id: string): Promise<void>;
  restore(id: string): Promise<void>;
  search(query: string): Promise<Envelope[]>;
  subscribe(listener: () => void): () => void;
  export(): Promise<string>;
  close(): Promise<void>;
}
export async function createRepository(
  driver: SqlDriver,
  options: { deviceId: string; now: () => number },
): Promise<Repository> {
  await driver.transaction(async (db) => {
    await db.query('CREATE TABLE IF NOT EXISTS migrations (version INTEGER PRIMARY KEY)');
    const rows = await db.query('SELECT max(version) AS version FROM migrations');
    if ((rows[0]?.version ?? 0) === 0) {
      await db.query(
        'CREATE TABLE records (id TEXT PRIMARY KEY, type TEXT NOT NULL, envelope TEXT NOT NULL, deleted_at TEXT)',
      );
      await db.query('CREATE INDEX records_type ON records(type, deleted_at)');
      await db.query('CREATE TABLE change_log (id TEXT PRIMARY KEY, hlc TEXT NOT NULL)');
      await db.query('CREATE TABLE sync_base (id TEXT PRIMARY KEY, envelope TEXT NOT NULL)');
      await db.query('CREATE TABLE sync_remote (path TEXT PRIMARY KEY, sha TEXT NOT NULL)');
      await db.query('CREATE TABLE sync_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
      await db.query('CREATE VIRTUAL TABLE search_index USING fts5(id UNINDEXED, content)');
      for (const type of Object.keys(entitySchemas))
        await db.query(
          `CREATE VIEW "${type}" AS SELECT id, envelope, json_extract(envelope, '$.data') AS data FROM records WHERE type = '${type}' AND deleted_at IS NULL`,
        );
      await db.query('INSERT INTO migrations(version) VALUES(1)');
    }
    if (Number(rows[0]?.version ?? 0) < 2) {
      await db.query(
        'CREATE TABLE sync_problems (path TEXT NOT NULL, reason TEXT NOT NULL, ciphertext BLOB NOT NULL, resolved INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(path,ciphertext))',
      );
      await db.query(
        'CREATE TABLE record_origins (id TEXT PRIMARY KEY, ever_synced INTEGER NOT NULL)',
      );
      await db.query('INSERT INTO migrations(version) VALUES(2)');
    }
  });
  let clock: ClockState = { millis: 0, counter: 0, deviceId: options.deviceId };
  const stored = await driver.query("SELECT value FROM sync_meta WHERE key='hlc'");
  if (typeof stored[0]?.value === 'string')
    clock = { ...parseHlc(stored[0].value), deviceId: options.deviceId };
  const listeners = new Set<() => void>();
  const notify = () => {
    for (const listener of listeners) listener();
  };
  const decode = (rows: Record<string, SqlValue>[]) =>
    rows.map((row) => {
      if (typeof row.envelope !== 'string') throw new Error('Invalid local record');
      return parseRecord(JSON.parse(row.envelope)).record;
    });
  const save = async (db: Pick<SqlDriver, 'query'>, record: Envelope) => {
    await db.query(
      'INSERT INTO records(id,type,envelope,deleted_at) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET envelope=excluded.envelope, deleted_at=excluded.deleted_at',
      [record.id, record.type, JSON.stringify(record), record.deletedAt],
    );
    await db.query(
      'INSERT INTO change_log(id,hlc) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET hlc=excluded.hlc',
      [record.id, record.hlc],
    );
    await db.query('DELETE FROM search_index WHERE id=?', [record.id]);
    if (!record.deletedAt)
      await db.query('INSERT INTO search_index(id,content) VALUES(?,?)', [
        record.id,
        Object.values(record.data)
          .filter((value) => typeof value === 'string')
          .join(' '),
      ]);
    await db.query(
      "INSERT INTO sync_meta(key,value) VALUES('hlc',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
      [record.hlc],
    );
  };
  const stamp = async (db: Pick<SqlDriver, 'query'>) => {
    const stored = await db.query("SELECT value FROM sync_meta WHERE key='hlc'");
    if (typeof stored[0]?.value === 'string')
      clock = { ...parseHlc(stored[0].value), deviceId: options.deviceId };
    clock = tickHlc(clock, options.now());
    return formatHlc(clock);
  };
  const get = async (id: string) =>
    decode(await driver.query('SELECT envelope FROM records WHERE id=?', [id]))[0] ?? null;
  const tombstone = async (id: string, deleted: boolean) => {
    await driver.transaction(async (db) => {
      const old = decode(await db.query('SELECT envelope FROM records WHERE id=?', [id]))[0];
      if (!old) throw new Error('Record not found');
      if (parseRecord(old).kind !== 'known') throw new Error('Update required for this record');
      const hlc = await stamp(db);
      await save(db, { ...old, hlc, deletedAt: deleted ? hlc.slice(0, 24) : null });
    });
    notify();
  };
  return {
    sync: createSyncStore(driver, options, notify),
    list: async (type, includeDeleted = false) =>
      decode(
        await driver.query(
          `SELECT envelope FROM records WHERE ${includeDeleted ? '1=1' : 'deleted_at IS NULL'}${type ? ' AND type=?' : ''} ORDER BY json_extract(envelope, '$.data.order'), id DESC`,
          type ? [type] : [],
        ),
      ),
    get,
    put: async (type, id, data, unset = []) => {
      const result = await driver.transaction(async (db) => {
        const previous = decode(await db.query('SELECT envelope FROM records WHERE id=?', [id]))[0];
        if (previous && (previous.type !== type || parseRecord(previous).kind !== 'known'))
          throw new Error('Cannot replace unknown record');
        const hlc = await stamp(db),
          instant = hlc.slice(0, 24);
        let record: Envelope = previous ?? {
          id,
          type,
          schema: 1,
          hlc,
          fieldHlc: {},
          createdAt: instant,
          deletedAt: null,
          data: {},
        };
        const removed = new Set(unset);
        record = {
          ...record,
          data: Object.fromEntries(
            Object.entries(record.data).filter(([key]) => !removed.has(key)),
          ),
          fieldHlc: { ...record.fieldHlc, ...Object.fromEntries(unset.map((key) => [key, hlc])) },
        };
        for (const [key, value] of Object.entries(data)) {
          if (JSON.stringify(record.data[key]) === JSON.stringify(value)) continue;
          if (longText.has(key) && typeof value === 'string' && previous) {
            const edited = editText(previous, key, value, hlc);
            record = {
              ...record,
              data: { ...record.data, [key]: value },
              fieldHlc: { ...record.fieldHlc, [key]: hlc },
              textVersions: { ...record.textVersions, [key]: edited.textVersions?.[key] ?? [] },
            };
          } else
            record = {
              ...record,
              data: { ...record.data, [key]: value },
              fieldHlc: { ...record.fieldHlc, [key]: hlc },
            };
        }
        record = { ...record, hlc, data: { ...record.data, ...data } };
        const parsed = parseRecord(record);
        if (parsed.kind !== 'known') throw new Error('Unknown record');
        await save(db, parsed.record);
        if (!previous)
          await db.query('INSERT INTO record_origins(id,ever_synced) VALUES(?,0)', [id]);
        return parsed.record;
      });
      notify();
      return result;
    },
    remove: (id) => tombstone(id, true),
    restore: (id) => tombstone(id, false),
    search: async (query) => {
      const safe = query
        .trim()
        .split(/\s+/)
        .filter(Boolean)
        .map((part) => `"${part.replaceAll('"', '""')}"`)
        .join(' AND ');
      if (!safe) return [];
      return decode(
        await driver.query(
          'SELECT r.envelope FROM search_index s JOIN records r ON r.id=s.id WHERE search_index MATCH ? AND r.deleted_at IS NULL ORDER BY rank',
          [safe],
        ),
      );
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    export: async () =>
      JSON.stringify(
        {
          format: 'life-manager-export',
          version: 1,
          records: decode(await driver.query('SELECT envelope FROM records ORDER BY id')),
          preservedCiphertext: await driver.query(
            'SELECT path,reason,hex(ciphertext) AS ciphertextHex,resolved FROM sync_problems ORDER BY path, ciphertext',
          ),
        },
        null,
        2,
      ),
    close: () => driver.close(),
  };
}
