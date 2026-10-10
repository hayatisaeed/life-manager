// The repository layer (ARCHITECTURE.md §4): CRUD over the generic `records`
// table that stamps HLCs per field, writes the change log, keeps the FTS index
// up to date and notifies live-query subscribers.

import type { EntityData, EntityType, Envelope, Env, Hlc, HlcState, Rec } from '@lm/core';
import {
  DELETED_KEY,
  HlcClock,
  deepEqual,
  entityDef,
  initialHlc,
  instantFromMs,
  isEntityType,
  parseEnvelope,
  ulid,
  validateData,
} from '@lm/core';
import type { Row, SqlDriver, SqlStatement, SqlValue } from '@lm/platform';
import { Mutex } from '@lm/platform';
import { migrate } from './migrations';

export type Patch<T extends EntityType> = {
  [K in keyof EntityData<T>]?: EntityData<T>[K] | undefined;
};

export interface ListOptions {
  /** SQL condition; reference fields with `json_extract(data, '$.field')` or the `f()` helper. */
  where?: string;
  params?: SqlValue[];
  orderBy?: string;
  limit?: number;
  includeDeleted?: boolean;
}

/** `json_extract(data, '$.path')` — keeps hand-written queries short. */
export const f = (path: string): string => `json_extract(data, '$.${path}')`;

export interface ChangeEvent {
  types: Set<string>;
  ids: Set<string>;
  /** True when the change came from sync rather than a local edit. */
  remote: boolean;
}

type Listener = (e: ChangeEvent) => void;

interface RecordRow extends Row {
  id: string;
  type: string;
  schema: number;
  hlc: string;
  field_hlc: string;
  deleted_at: string | null;
  created_at: string;
  data: string;
}

export class ReadOnlyRecordError extends Error {
  constructor(id: string) {
    super(`Record ${id} was written by a newer app version and is read-only here`);
    this.name = 'ReadOnlyRecordError';
  }
}

export class NotFoundError extends Error {
  constructor(id: string) {
    super(`Record not found: ${id}`);
    this.name = 'NotFoundError';
  }
}

export function rowToEnvelope(r: RecordRow): Envelope {
  return {
    id: r.id,
    type: r.type,
    schema: r.schema,
    hlc: r.hlc,
    fieldHlc: JSON.parse(r.field_hlc) as Record<string, string>,
    deletedAt: r.deleted_at,
    createdAt: r.created_at,
    data: JSON.parse(r.data) as Record<string, unknown>,
  };
}

/** Text indexed for full-text search: the title field plus long-text fields and tags. */
function searchText(env: Envelope): { title: string; body: string } | null {
  const def = entityDef(env.type);
  if (!def || env.deletedAt || env.type === 'settings') return null;
  const str = (v: unknown) => (typeof v === 'string' ? v : '');
  const title = def.title ? str(env.data[def.title]) : '';
  const parts = (def.texts ?? []).map((k) => str(env.data[k]));
  const tags = env.data['tags'];
  if (Array.isArray(tags)) parts.push(tags.filter((t) => typeof t === 'string').join(' '));
  for (const k of ['text', 'transcript', 'summary', 'payee', 'back', 'author', 'company']) {
    if (k !== def.title) parts.push(str(env.data[k]));
  }
  const body = parts.filter(Boolean).join('\n');
  if (!title && !body) return null;
  return { title, body };
}

function writeStatements(env: Envelope, dirty: boolean): SqlStatement[] {
  const stmts: SqlStatement[] = [
    {
      sql: `INSERT INTO records (id, type, schema, hlc, field_hlc, deleted_at, created_at, data)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET type = excluded.type, schema = excluded.schema,
              hlc = excluded.hlc, field_hlc = excluded.field_hlc, deleted_at = excluded.deleted_at,
              created_at = excluded.created_at, data = excluded.data`,
      params: [
        env.id,
        env.type,
        env.schema,
        env.hlc,
        JSON.stringify(env.fieldHlc),
        env.deletedAt,
        env.createdAt,
        JSON.stringify(env.data),
      ],
    },
    {
      sql: 'DELETE FROM search WHERE rowid = (SELECT rid FROM records WHERE id = ?)',
      params: [env.id],
    },
  ];
  const s = searchText(env);
  if (s) {
    stmts.push({
      sql: 'INSERT INTO search (rowid, title, body) SELECT rid, ?, ? FROM records WHERE id = ?',
      params: [s.title, s.body, env.id],
    });
  }
  if (dirty) {
    stmts.push({
      sql: 'INSERT INTO change_log (id, hlc) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET hlc = excluded.hlc',
      params: [env.id, env.hlc],
    });
  }
  return stmts;
}

/** Accumulates writes so several records commit atomically (one SQLite transaction). */
export class Writer {
  readonly envelopes = new Map<string, Envelope>();
  readonly statements: SqlStatement[] = [];
  readonly types = new Set<string>();

  constructor(private readonly store: Store) {}

  private async current(id: string): Promise<Envelope | null> {
    return this.envelopes.get(id) ?? (await this.store.getEnvelope(id));
  }

  private stage(env: Envelope): void {
    this.envelopes.set(env.id, env);
    this.types.add(env.type);
    this.statements.push(...writeStatements(env, true));
  }

  async create<T extends EntityType>(
    type: T,
    data: EntityData<T>,
    opts: { id?: string } = {},
  ): Promise<Rec<T>> {
    const id = opts.id ?? ulid(this.store.env);
    if (await this.current(id)) throw new Error(`Record already exists: ${id}`);
    const def = entityDef(type);
    if (!def) throw new Error(`Unknown entity type: ${type}`);
    const clean = validateData(type, data);
    const hlc = this.store.clock.now();
    const fieldHlc: Record<string, string> = {};
    for (const k of Object.keys(clean)) fieldHlc[k] = hlc;
    const env: Envelope = {
      id,
      type,
      schema: def.schema,
      hlc,
      fieldHlc,
      deletedAt: null,
      createdAt: instantFromMs(this.store.env.now()),
      data: clean,
    };
    this.stage(env);
    return env as unknown as Rec<T>;
  }

  async update<T extends EntityType>(type: T, id: string, patch: Patch<T>): Promise<Rec<T>> {
    const cur = await this.current(id);
    if (!cur || cur.type !== type) throw new NotFoundError(id);
    const def = entityDef(type);
    if (!def || cur.schema > def.schema) throw new ReadOnlyRecordError(id);
    const p = patch as Record<string, unknown>;
    const next = Object.fromEntries(
      [...new Set([...Object.keys(cur.data), ...Object.keys(p)])]
        .map((k) => [k, k in p ? p[k] : cur.data[k]] as const)
        .filter(([, v]) => v !== undefined),
    );
    const clean = validateData(type, next);
    const changed = new Set(
      [...Object.keys(cur.data), ...Object.keys(clean)].filter(
        (k) => !deepEqual(cur.data[k], clean[k]),
      ),
    );
    if (changed.size === 0) return cur as unknown as Rec<T>;
    const hlc = this.store.clock.now();
    const fieldHlc = { ...cur.fieldHlc };
    for (const k of changed) fieldHlc[k] = hlc;
    const env: Envelope = { ...cur, hlc, fieldHlc, data: clean };
    this.stage(env);
    return env as unknown as Rec<T>;
  }

  /** Soft delete (tombstone, SYNC.md §9). */
  async remove(id: string): Promise<void> {
    const cur = await this.current(id);
    if (!cur || cur.deletedAt) return;
    const hlc = this.store.clock.now();
    this.stage({
      ...cur,
      hlc,
      deletedAt: instantFromMs(this.store.env.now()),
      fieldHlc: { ...cur.fieldHlc, [DELETED_KEY]: hlc },
    });
  }

  async restore(id: string): Promise<void> {
    const cur = await this.current(id);
    if (!cur || !cur.deletedAt) return;
    const hlc = this.store.clock.now();
    this.stage({ ...cur, hlc, deletedAt: null, fieldHlc: { ...cur.fieldHlc, [DELETED_KEY]: hlc } });
  }
}

export class Store {
  readonly clock: HlcClock;
  private readonly listeners = new Set<{ types: Set<string> | null; cb: Listener }>();
  private readonly mutex = new Mutex();

  private constructor(
    readonly driver: SqlDriver,
    readonly env: Env,
    readonly deviceId: string,
    hlc: HlcState,
  ) {
    this.clock = new HlcClock(hlc, env.now);
  }

  static async open(driver: SqlDriver, env: Env): Promise<Store> {
    await migrate(driver);
    const kv = async (k: string) =>
      (await driver.query<{ value: string }>('SELECT value FROM device_kv WHERE key = ?', [k]))[0]
        ?.value;
    let deviceId = await kv('deviceId');
    if (!deviceId) {
      deviceId = ulid(env).slice(-10);
      await driver.exec('INSERT INTO device_kv (key, value) VALUES (?, ?)', ['deviceId', deviceId]);
    }
    const saved = await kv('hlc');
    const hlc = saved ? (JSON.parse(saved) as HlcState) : initialHlc(deviceId);
    return new Store(driver, env, deviceId, { ...hlc, deviceId });
  }

  // --- reads ----------------------------------------------------------------

  async getEnvelope(id: string): Promise<Envelope | null> {
    const rows = await this.driver.query<RecordRow>('SELECT * FROM records WHERE id = ?', [id]);
    return rows[0] ? rowToEnvelope(rows[0]) : null;
  }

  async get<T extends EntityType>(type: T, id: string): Promise<Rec<T> | null> {
    const e = await this.getEnvelope(id);
    if (!e || e.type !== type || e.deletedAt) return null;
    return e as unknown as Rec<T>;
  }

  async list<T extends EntityType>(type: T, o: ListOptions = {}): Promise<Rec<T>[]> {
    const conds = ['type = ?'];
    if (!o.includeDeleted) conds.push('deleted_at IS NULL');
    if (o.where) conds.push(`(${o.where})`);
    const sql = `SELECT * FROM records WHERE ${conds.join(' AND ')}${o.orderBy ? ` ORDER BY ${o.orderBy}` : ''}${
      o.limit ? ` LIMIT ${Math.floor(o.limit)}` : ''
    }`;
    const rows = await this.driver.query<RecordRow>(sql, [type, ...(o.params ?? [])]);
    return rows.map((r) => rowToEnvelope(r) as unknown as Rec<T>);
  }

  async count(type: EntityType, where?: string, params: SqlValue[] = []): Promise<number> {
    const rows = await this.driver.query<{ n: number }>(
      `SELECT count(*) AS n FROM records WHERE type = ? AND deleted_at IS NULL${where ? ` AND (${where})` : ''}`,
      [type, ...params],
    );
    return rows[0]?.n ?? 0;
  }

  /** Full-text search across all record types (FTS5). */
  async search(
    query: string,
    limit = 50,
  ): Promise<{ id: string; type: string; title: string; snippet: string }[]> {
    const terms = query
      .split(/\s+/)
      .map((t) => t.replace(/["*^:()]/g, ''))
      .filter(Boolean);
    if (!terms.length) return [];
    const match = terms.map((t) => `"${t}"*`).join(' ');
    return this.driver.query(
      `SELECT r.id AS id, r.type AS type, search.title AS title,
              snippet(search, 1, '', '', '…', 12) AS snippet
       FROM search JOIN records r ON r.rid = search.rowid
       WHERE search MATCH ? AND r.deleted_at IS NULL
       ORDER BY rank LIMIT ?`,
      [match, limit],
    );
  }

  // --- writes ---------------------------------------------------------------

  /** Run several writes atomically. Reads inside `fn` see the writer's staged records. */
  transact<R>(fn: (w: Writer) => Promise<R>): Promise<R> {
    return this.mutex.run(async () => {
      const w = new Writer(this);
      const result = await fn(w);
      if (w.statements.length) {
        await this.driver.batch([...w.statements, this.hlcStatement()]);
        this.emit({ types: w.types, ids: new Set(w.envelopes.keys()), remote: false });
      }
      return result;
    });
  }

  create<T extends EntityType>(
    type: T,
    data: EntityData<T>,
    opts: { id?: string } = {},
  ): Promise<Rec<T>> {
    return this.transact((w) => w.create(type, data, opts));
  }

  update<T extends EntityType>(type: T, id: string, patch: Patch<T>): Promise<Rec<T>> {
    return this.transact((w) => w.update(type, id, patch));
  }

  remove(id: string): Promise<void> {
    return this.transact((w) => w.remove(id));
  }

  restore(id: string): Promise<void> {
    return this.transact((w) => w.restore(id));
  }

  private hlcStatement(): SqlStatement {
    return {
      sql: 'INSERT INTO device_kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      params: ['hlc', JSON.stringify(this.clock.snapshot())],
    };
  }

  // --- sync-facing API (packages/sync) ----------------------------------------

  /** Observe a remote HLC so later local edits sort after it (SYNC.md §3). */
  observe(hlc: Hlc): void {
    this.clock.observe(hlc);
  }

  /**
   * Write envelopes produced by sync (remote records or merge results) plus
   * extra bookkeeping statements, atomically. `dirty` ids stay in the change log.
   */
  applySync(
    items: { envelope: Envelope; dirty: boolean }[],
    extra: SqlStatement[] = [],
    opts: { clearDirty?: string[] } = {},
  ): Promise<void> {
    return this.syncTransaction(async () => ({
      items,
      extra,
      clearDirty: (opts.clearDirty ?? []).map((id) => ({ id })),
    }));
  }

  /**
   * Like `applySync`, but `fn` runs under the store lock so it can read local
   * state and merge without racing a concurrent local edit (SYNC.md §5).
   * `clearDirty` entries with an `hlc` are only cleared if the record hasn't
   * been edited again since that HLC was pushed.
   */
  syncTransaction(
    fn: () => Promise<{
      items: { envelope: Envelope; dirty: boolean }[];
      extra?: SqlStatement[];
      clearDirty?: { id: string; hlc?: string }[];
    }>,
  ): Promise<void> {
    return this.mutex.run(async () => {
      const { items, extra = [], clearDirty = [] } = await fn();
      const stmts: SqlStatement[] = [];
      for (const it of items) stmts.push(...writeStatements(it.envelope, it.dirty));
      for (const c of clearDirty) {
        stmts.push(
          c.hlc === undefined
            ? { sql: 'DELETE FROM change_log WHERE id = ?', params: [c.id] }
            : { sql: 'DELETE FROM change_log WHERE id = ? AND hlc = ?', params: [c.id, c.hlc] },
        );
      }
      stmts.push(...extra, this.hlcStatement());
      await this.driver.batch(stmts);
      if (items.length) {
        this.emit({
          types: new Set(items.map((i) => i.envelope.type)),
          ids: new Set(items.map((i) => i.envelope.id)),
          remote: true,
        });
      }
    });
  }

  /** Run bookkeeping-only statements under the store lock. */
  runExclusive<R>(fn: () => Promise<R>): Promise<R> {
    return this.mutex.run(fn);
  }

  async dirty(): Promise<{ id: string; hlc: string }[]> {
    return this.driver.query('SELECT id, hlc FROM change_log ORDER BY id');
  }

  // --- live queries -------------------------------------------------------------

  subscribe(types: readonly string[] | null, cb: Listener): () => void {
    const l = { types: types ? new Set(types) : null, cb };
    this.listeners.add(l);
    return () => {
      this.listeners.delete(l);
    };
  }

  /** Notify subscribers about an out-of-band change (e.g. device_kv or external events). */
  notify(types: string[]): void {
    this.emit({ types: new Set(types), ids: new Set(), remote: false });
  }

  private emit(e: ChangeEvent): void {
    for (const l of [...this.listeners]) {
      if (!l.types || [...e.types].some((t) => l.types?.has(t))) {
        try {
          l.cb(e);
        } catch (err) {
          console.error('store listener failed', err);
        }
      }
    }
  }

  // --- device-local key/value -------------------------------------------------

  async getDevice<T>(key: string): Promise<T | null> {
    const r = await this.driver.query<{ value: string }>(
      'SELECT value FROM device_kv WHERE key = ?',
      [key],
    );
    return r[0] ? (JSON.parse(r[0].value) as T) : null;
  }

  async setDevice(key: string, value: unknown): Promise<void> {
    await this.mutex.run(() =>
      this.driver.exec(
        'INSERT INTO device_kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
        [`${key}`, JSON.stringify(value)],
      ),
    );
    this.notify([`device:${key}`]);
  }
}

/** Validate a record read from anywhere outside the store (imports, sync). */
export function checkEnvelope(raw: unknown): ReturnType<typeof parseEnvelope> {
  return parseEnvelope(raw);
}

export { isEntityType };
