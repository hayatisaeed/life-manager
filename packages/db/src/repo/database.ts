import {
  ENTITIES,
  HybridLogicalClock,
  createUlidGenerator,
  decodeRecord,
  parseEntityData,
  parseHlc,
  type Clock,
  type DecodeResult,
  type EntityData,
  type EntityDef,
  type EntityRecord,
  type EntityType,
  type Hlc,
  type HlcState,
  type KeptReason,
  type Rng,
  type Ulid,
} from '@lm/core';
import type { SqlDriver, SqlExecutor, SqlValue } from '../driver/types';
import { migrate } from '../schema/migrate';
import { dataField } from '../schema/migrations';
import { entityTable } from '../schema/tables';
import { SEARCHABLE, extractSearchText, toMatchQuery } from './search-text';

// Local repository API (ROADMAP P0.5, ARCHITECTURE.md §4, ADR-018). Every local
// write stamps the HLC, records the id in change_log for the next sync, keeps
// the search index current and notifies live queries, all in one transaction.

const ENVELOPE_KEYS = new Set([
  'id',
  'type',
  'schema',
  'hlc',
  'fieldHlc',
  'deletedAt',
  'createdAt',
  'data',
]);

/** A stored row that no longer decodes, e.g. after a downgrade. It stays in the table untouched. */
export interface RowProblem {
  type: EntityType;
  id: string;
  reason: KeptReason;
  issues: string[];
}

export interface DatabaseOptions {
  driver: SqlDriver;
  /** Wall clock in ms. Injected so tests are deterministic. */
  clock: Clock;
  /** Uniform [0, 1), backed by `crypto.getRandomValues` in the apps. */
  rng: Rng;
  /** Rows that fail to decode are skipped by reads and reported here. */
  onProblem?: (problem: RowProblem) => void;
}

export interface ListOptions<T extends EntityType> {
  /** Equality filters on top-level data fields. */
  where?: Partial<Record<keyof EntityData<T> & string, SqlValue>>;
  /** A data field, or `createdAt`. Ties are broken by id. */
  orderBy?: (keyof EntityData<T> & string) | 'createdAt';
  desc?: boolean;
  limit?: number;
  includeDeleted?: boolean;
}

/** A patch: a field set to `undefined` is removed (only valid for optional fields). */
export type Patch<T extends EntityType> = {
  [K in keyof EntityData<T>]?: EntityData<T>[K] | undefined;
};

export interface SearchHit {
  type: EntityType;
  id: Ulid;
}

export interface ChangeLogEntry {
  recordId: Ulid;
  type: EntityType;
  hlc: Hlc;
}

type Listener = (types: ReadonlySet<EntityType>) => void;

interface EntityRow {
  [key: string]: SqlValue;
  id: string;
  schema: number;
  hlc: string;
  field_hlc: string;
  deleted_at: string | null;
  created_at: string;
  data: string;
  extra: string | null;
}

export class RecordNotFoundError extends Error {
  override name = 'RecordNotFoundError';
}

const FIELD = /^[A-Za-z_][A-Za-z0-9_]*$/;

export class LmDatabase {
  private readonly listeners = new Set<{ types: ReadonlySet<EntityType>; fn: Listener }>();
  private readonly newId: () => Ulid;

  private constructor(
    private readonly driver: SqlDriver,
    private readonly clock: Clock,
    private readonly hlc: HybridLogicalClock,
    private readonly onProblem: (p: RowProblem) => void,
    rng: Rng,
  ) {
    this.newId = createUlidGenerator(clock, rng);
  }

  /** Migrates the database, then loads (or creates) this device's id and HLC state. */
  static async open(options: DatabaseOptions): Promise<LmDatabase> {
    const { driver, clock, rng } = options;
    const instant = () => new Date(clock()).toISOString();
    await migrate(driver, instant);
    const meta = new Map(
      (await driver.all<{ key: string; value: string }>('SELECT key, value FROM sync_meta')).map(
        (r) => [r.key, r.value],
      ),
    );
    let deviceId = meta.get('deviceId');
    if (deviceId === undefined) {
      deviceId = randomDeviceId(rng);
      await driver.run('INSERT INTO sync_meta (key, value) VALUES (?, ?)', ['deviceId', deviceId]);
    }
    const saved = meta.get('hlc');
    const state = saved === undefined ? undefined : (JSON.parse(saved) as HlcState);
    const hlc = new HybridLogicalClock(deviceId, clock, state);
    return new LmDatabase(driver, clock, hlc, options.onProblem ?? (() => undefined), rng);
  }

  get deviceId(): string {
    return this.hlc.deviceId;
  }

  close(): Promise<void> {
    this.listeners.clear();
    return this.driver.close();
  }

  // --- reads ---------------------------------------------------------------

  async get<T extends EntityType>(
    type: T,
    id: string,
    { includeDeleted = false } = {},
  ): Promise<EntityRecord<T> | null> {
    const rows = await this.driver.all<EntityRow>(
      `SELECT * FROM ${table(type)} WHERE id = ?${includeDeleted ? '' : ' AND deleted_at IS NULL'}`,
      [id],
    );
    const row = rows[0];
    return row ? this.decode(type, row) : null;
  }

  async list<T extends EntityType>(
    type: T,
    options: ListOptions<T> = {},
  ): Promise<EntityRecord<T>[]> {
    const def = defOf(type);
    const clauses: string[] = [];
    const params: SqlValue[] = [];
    if (!options.includeDeleted) clauses.push('deleted_at IS NULL');
    for (const [field, value] of Object.entries(options.where ?? {}) as [string, SqlValue][]) {
      checkField(def, type, field);
      if (value === null) {
        clauses.push(`${dataField(field)} IS NULL`);
      } else {
        clauses.push(`${dataField(field)} = ?`);
        params.push(value);
      }
    }
    let order = 'id';
    if (options.orderBy === 'createdAt') {
      order = 'created_at';
    } else if (options.orderBy !== undefined) {
      checkField(def, type, options.orderBy);
      order = dataField(options.orderBy);
    }
    const dir = options.desc ? 'DESC' : 'ASC';
    let sql = `SELECT * FROM ${table(type)}`;
    if (clauses.length > 0) sql += ` WHERE ${clauses.join(' AND ')}`;
    // DATA-MODEL.md §1: ties sort by id with plain code-unit comparison.
    sql += ` ORDER BY ${order} ${dir}, id ${dir}`;
    if (options.limit !== undefined) {
      sql += ' LIMIT ?';
      params.push(options.limit);
    }
    const rows = await this.driver.all<EntityRow>(sql, params);
    return rows.flatMap((row) => this.decode(type, row) ?? []);
  }

  /** Full-text search over titles and long text, every word as a prefix, best match first. */
  async search(
    query: string,
    { types, limit = 50 }: { types?: EntityType[]; limit?: number } = {},
  ) {
    const match = toMatchQuery(query);
    if (match === null) return [];
    const params: SqlValue[] = [match];
    let filter = '';
    if (types && types.length > 0) {
      filter = ` AND d.type IN (${types.map(() => '?').join(', ')})`;
      params.push(...types);
    }
    params.push(limit);
    // bm25 weights: a hit in the title counts three times a hit in the body.
    return this.driver.all<SearchHit & { [k: string]: SqlValue }>(
      `SELECT d.type AS type, d.id AS id FROM search_fts
       JOIN search_doc d ON d.rowid = search_fts.rowid
       WHERE search_fts MATCH ?${filter}
       ORDER BY bm25(search_fts, 3.0, 1.0), d.id LIMIT ?`,
      params,
    ) as Promise<SearchHit[]>;
  }

  /** Records changed locally since the last successful push (SYNC.md §4). */
  async changeLog(): Promise<ChangeLogEntry[]> {
    const rows = await this.driver.all<{ record_id: string; type: string; hlc: string }>(
      'SELECT record_id, type, hlc FROM change_log ORDER BY hlc, record_id',
    );
    return rows.map((r) => ({ recordId: r.record_id, type: r.type as EntityType, hlc: r.hlc }));
  }

  // --- writes --------------------------------------------------------------

  async create<T extends EntityType>(
    type: T,
    data: EntityData<T>,
    { id }: { id?: Ulid } = {},
  ): Promise<EntityRecord<T>> {
    const parsed = parseEntityData(type, data);
    return this.write([type], async (tx) => {
      const recordId = id ?? this.newId();
      const exists = await tx.all(`SELECT 1 FROM ${table(type)} WHERE id = ?`, [recordId]);
      if (exists.length > 0) throw new Error(`${type} ${recordId} already exists`);
      const stamp = this.hlc.now();
      const record = {
        id: recordId,
        type,
        schema: defOf(type).version,
        hlc: stamp,
        fieldHlc: {},
        deletedAt: null,
        createdAt: this.instant(),
        data: parsed,
      } as EntityRecord<T>;
      await this.store(tx, record);
      return record;
    });
  }

  /**
   * Applies a patch. Only fields whose value actually changes get a new field
   * HLC, so a concurrent edit to another field merges cleanly (SYNC.md §6).
   * Returns the record unchanged, without a write, if nothing changed.
   */
  async update<T extends EntityType>(
    type: T,
    id: string,
    patch: Patch<T>,
  ): Promise<EntityRecord<T>> {
    return this.write([type], async (tx) => {
      const current = await this.load(tx, type, id);
      if (current.deletedAt !== null) throw new Error(`${type} ${id} is deleted; restore it first`);
      // Built with fromEntries, not assignment, so a key such as `__proto__`
      // stays an ordinary key (ADR-013).
      const patched = new Map<string, unknown>(Object.entries(current.data));
      for (const [key, value] of Object.entries(patch)) {
        if (value === undefined) patched.delete(key);
        else patched.set(key, value);
      }
      const data = parseEntityData(type, Object.fromEntries(patched));
      const changed = [...new Set([...Object.keys(current.data), ...Object.keys(data)])].filter(
        (k) =>
          stableJson((current.data as Record<string, unknown>)[k]) !==
          stableJson((data as Record<string, unknown>)[k]),
      );
      if (changed.length === 0) return { unchanged: current };
      const stamp = this.hlc.now();
      const record = {
        ...current,
        hlc: stamp,
        fieldHlc: { ...current.fieldHlc, ...Object.fromEntries(changed.map((k) => [k, stamp])) },
        data,
      } as EntityRecord<T>;
      await this.store(tx, record);
      return record;
    }).then(unwrapUnchanged);
  }

  /** Marks a record deleted. The tombstone syncs; the row stays (SYNC.md §9). */
  delete(type: EntityType, id: string): Promise<void> {
    return this.setDeleted(type, id, true);
  }

  restore(type: EntityType, id: string): Promise<void> {
    return this.setDeleted(type, id, false);
  }

  private async setDeleted(type: EntityType, id: string, deleted: boolean): Promise<void> {
    await this.write([type], async (tx) => {
      const current = await this.load(tx, type, id);
      if ((current.deletedAt !== null) === deleted) return { unchanged: current };
      const record = {
        ...current,
        hlc: this.hlc.now(),
        deletedAt: deleted ? this.instant() : null,
      };
      await this.store(tx, record);
      return record;
    });
  }

  // --- live queries --------------------------------------------------------

  /** Calls `listener` after every committed write that touched one of `types`. */
  subscribe(types: readonly EntityType[], listener: Listener): () => void {
    const entry = { types: new Set(types), fn: listener };
    this.listeners.add(entry);
    return () => this.listeners.delete(entry);
  }

  /**
   * Runs `query` now and again after every write to `types`, passing each
   * result to `onResult`. Results that arrive out of order are dropped.
   */
  liveQuery<R>(
    types: readonly EntityType[],
    query: (db: LmDatabase) => Promise<R>,
    onResult: (result: R) => void,
    onError: (error: unknown) => void,
  ): () => void {
    let latest = 0;
    let active = true;
    const run = () => {
      const seq = ++latest;
      query(this).then(
        (result) => {
          if (active && seq === latest) onResult(result);
        },
        (error: unknown) => {
          if (active && seq === latest) onError(error);
        },
      );
    };
    const unsubscribe = this.subscribe(types, run);
    run();
    return () => {
      active = false;
      unsubscribe();
    };
  }

  // --- internals -----------------------------------------------------------

  private instant(): string {
    return new Date(this.clock()).toISOString();
  }

  private async write<R>(types: EntityType[], fn: (tx: SqlExecutor) => Promise<R>): Promise<R> {
    // A rolled-back write still advanced the in-memory clock. That's harmless:
    // HLCs only need to be unique and increasing, not gap-free.
    const result = await this.driver.transaction(async (tx) => {
      const value = await fn(tx);
      if (!isUnchanged(value)) {
        await tx.run('INSERT OR REPLACE INTO sync_meta (key, value) VALUES (?, ?)', [
          'hlc',
          JSON.stringify(this.hlc.state()),
        ]);
      }
      return value;
    });
    if (!isUnchanged(result)) this.notify(types);
    return result;
  }

  /** Listeners run after the commit, in a microtask, never inside the transaction. */
  private notify(types: EntityType[]): void {
    const changed: ReadonlySet<EntityType> = new Set(types);
    queueMicrotask(() => {
      for (const { types: wanted, fn } of [...this.listeners]) {
        if (types.some((t) => wanted.has(t))) fn(changed);
      }
    });
  }

  private async load<T extends EntityType>(
    tx: SqlExecutor,
    type: T,
    id: string,
  ): Promise<EntityRecord<T>> {
    const row = (await tx.all<EntityRow>(`SELECT * FROM ${table(type)} WHERE id = ?`, [id]))[0];
    const record = row ? this.decode(type, row) : null;
    if (!record) throw new RecordNotFoundError(`${type} ${id} not found`);
    return record;
  }

  private decode<T extends EntityType>(type: T, row: EntityRow): EntityRecord<T> | null {
    const raw = {
      ...(row.extra ? (JSON.parse(row.extra) as Record<string, unknown>) : {}),
      id: row.id,
      type,
      schema: row.schema,
      hlc: row.hlc,
      fieldHlc: JSON.parse(row.field_hlc) as unknown,
      deletedAt: row.deleted_at,
      createdAt: row.created_at,
      data: JSON.parse(row.data) as unknown,
    };
    const result: DecodeResult = decodeRecord(raw);
    if (result.status === 'ok') return result.record as EntityRecord<T>;
    this.onProblem({ type, id: row.id, reason: result.reason, issues: result.issues });
    return null;
  }

  private async store(tx: SqlExecutor, record: StoredRecord): Promise<void> {
    const extra = Object.fromEntries(Object.entries(record).filter(([k]) => !ENVELOPE_KEYS.has(k)));
    await tx.run(
      `INSERT OR REPLACE INTO ${table(record.type)}
        (id, schema, hlc, field_hlc, deleted_at, created_at, device_id, data, extra)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        record.id,
        record.schema,
        record.hlc,
        JSON.stringify(record.fieldHlc),
        record.deletedAt,
        record.createdAt,
        parseHlc(record.hlc).deviceId,
        JSON.stringify(record.data),
        Object.keys(extra).length > 0 ? JSON.stringify(extra) : null,
      ],
    );
    await tx.run('INSERT OR REPLACE INTO change_log (record_id, type, hlc) VALUES (?, ?, ?)', [
      record.id,
      record.type,
      record.hlc,
    ]);
    await this.index(tx, record);
  }

  private async index(tx: SqlExecutor, record: StoredRecord): Promise<void> {
    const fields = Object.hasOwn(SEARCHABLE, record.type) ? SEARCHABLE[record.type] : undefined;
    if (!fields) return;
    await tx.run('INSERT OR IGNORE INTO search_doc (type, id) VALUES (?, ?)', [
      record.type,
      record.id,
    ]);
    const doc = await tx.all<{ rowid: number }>(
      'SELECT rowid FROM search_doc WHERE type = ? AND id = ?',
      [record.type, record.id],
    );
    const rowid = doc[0]?.rowid ?? null;
    await tx.run('DELETE FROM search_fts WHERE rowid = ?', [rowid]);
    if (record.deletedAt !== null) return;
    const { title, body } = extractSearchText(fields, record.data as Record<string, unknown>);
    await tx.run('INSERT INTO search_fts (rowid, title, body) VALUES (?, ?, ?)', [
      rowid,
      title,
      body,
    ]);
  }
}

// --- helpers ---------------------------------------------------------------

/** The shape every `EntityRecord<T>` has, without the per-type union. */
interface StoredRecord {
  [extra: string]: unknown;
  id: string;
  type: EntityType;
  schema: number;
  hlc: Hlc;
  fieldHlc: Record<string, Hlc>;
  deletedAt: string | null;
  createdAt: string;
  data: object;
}

interface Unchanged<R> {
  unchanged: R;
}

function isUnchanged(value: unknown): value is Unchanged<unknown> {
  return typeof value === 'object' && value !== null && 'unchanged' in value;
}

function unwrapUnchanged<R>(value: R | Unchanged<R>): R {
  return isUnchanged(value) ? (value.unchanged as R) : value;
}

function defOf(type: EntityType): EntityDef {
  return (ENTITIES as Record<string, EntityDef>)[type] as EntityDef;
}

function table(type: EntityType): string {
  if (!Object.hasOwn(ENTITIES, type)) throw new Error(`Unknown entity type "${type}"`);
  return entityTable(type);
}

function checkField(def: EntityDef, type: string, field: string): void {
  // The field name goes into SQL text, so it must be a known identifier.
  if (!FIELD.test(field) || !Object.hasOwn(def.shape, field)) {
    throw new Error(`${type} has no field "${field}"`);
  }
}

function randomDeviceId(rng: Rng): string {
  const alphabet = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  return Array.from({ length: 16 }, () => alphabet[Math.floor(rng() * 32)] ?? '0').join('');
}

/** JSON with sorted keys, to compare values regardless of key order. */
function stableJson(value: unknown): string | undefined {
  return JSON.stringify(value, (_k, v: unknown) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(
          Object.entries(v as Record<string, unknown>).sort(([a], [b]) =>
            a < b ? -1 : a > b ? 1 : 0,
          ),
        )
      : v,
  );
}
