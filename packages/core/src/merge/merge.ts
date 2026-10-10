import type { EntityDef, MergeKind } from '../entities/define';
import type { EntityRecord } from '../entities/envelope';
import { ENTITIES } from '../entities/registry';
import type { Hlc } from '../hlc';
import { canonical, compareStrings, same } from './canonical';
import { mergeText } from './text';

// Three-way record merge, docs/SYNC.md §6. `merge(base, ours, theirs)` gives
// the same result as `merge(base, theirs, ours)`: every choice between the
// two sides is made by HLC, then by canonical value, never by argument
// position. Merging a record with itself returns it unchanged.

export class MergeError extends Error {
  override name = 'MergeError';
}

export interface MergeResult {
  record: EntityRecord;
  /** A deletion was undone because the other side edited the record. The UI shows "restored". */
  restored: boolean;
  /** Fields that got a new text-conflict block in this merge. */
  newConflicts: string[];
  /**
   * Validation issues in the merged data. A field-wise merge of two valid
   * records can break a cross-field rule (one side clears `dueDate` while the
   * other sets `dueTime`). The record is still returned whole, because data
   * is never dropped; the caller surfaces the issues.
   */
  issues: string[];
}

interface Side {
  readonly value: unknown;
  readonly hlc: Hlc;
}

const own = <T>(map: Readonly<Record<string, T>> | undefined, key: string): T | undefined =>
  map !== undefined && Object.hasOwn(map, key) ? map[key] : undefined;

const sortedKeys = (...maps: (Readonly<Record<string, unknown>> | undefined)[]) =>
  [...new Set(maps.flatMap((m) => (m ? Object.keys(m) : [])))].sort(compareStrings);

const isMap = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v);

/** Sets a key as plain data, even `__proto__` (see entities/envelope.ts). */
function put(target: Record<string, unknown>, key: string, value: unknown): void {
  Object.defineProperty(target, key, {
    value,
    enumerable: true,
    writable: true,
    configurable: true,
  });
}

const maxString = (a: string, b: string) => (a < b ? b : a);
const minString = (a: string, b: string) => (a < b ? a : b);

/** Orders two conflicting sides: the older first, by HLC, then by value. */
function order(o: Side, t: Side): [Side, Side] {
  if (o.hlc !== t.hlc) return o.hlc < t.hlc ? [o, t] : [t, o];
  return canonical(o.value) <= canonical(t.value) ? [o, t] : [t, o];
}

/** Both sides changed a scalar: the later write wins. */
const newer = (o: Side, t: Side) => order(o, t)[1].value;

/** The shared first step of every rule: a value changed on one side only wins. */
function oneSided(base: unknown, o: unknown, t: unknown): { value: unknown } | null {
  if (same(o, t)) return { value: o };
  if (same(o, base)) return { value: t };
  if (same(t, base)) return { value: o };
  return null;
}

function mergeScalar(base: unknown, o: Side, t: Side): unknown {
  return (oneSided(base, o.value, t.value) ?? { value: newer(o, t) }).value;
}

/** Arrays compared by element value: base + all additions − all removals. */
function mergeSet(base: unknown, o: Side, t: Side): unknown {
  if (!Array.isArray(o.value) || !Array.isArray(t.value)) return newer(o, t);
  const b = new Set((Array.isArray(base) ? base : []).map(canonical));
  const os = new Set(o.value.map(canonical));
  const ts = new Set(t.value.map(canonical));
  const result = new Map<string, unknown>();
  for (const v of [...o.value, ...t.value]) {
    const key = canonical(v);
    // Kept unless one side removed it from the base.
    if (!b.has(key) || (os.has(key) && ts.has(key))) result.set(key, v);
  }
  return [...result.keys()].sort(compareStrings).map((k) => result.get(k));
}

/** Long text: diff3, keeping both versions where the edits overlap. */
function mergeLongText(base: unknown, o: Side, t: Side): { value: unknown; conflict: boolean } {
  const isText = (v: unknown) => v === undefined || typeof v === 'string';
  if (!isText(base) || !isText(o.value) || !isText(t.value))
    return { value: newer(o, t), conflict: false };
  const [first, second] = order(o, t);
  const merged = mergeText(
    (base as string | undefined) ?? '',
    (first.value as string | undefined) ?? '',
    (second.value as string | undefined) ?? '',
  );
  // Cleared on one side and untouched text on the other: stay absent.
  const absent = merged.text === '' && (o.value === undefined || t.value === undefined);
  return { value: absent ? undefined : merged.text, conflict: merged.conflict };
}

type Item = Record<string, unknown> & { id: string };
const isItemList = (v: unknown): v is Item[] =>
  Array.isArray(v) && v.every((i) => isMap(i) && typeof i['id'] === 'string');

/** Ordered lists of `{id, order, …}`: merged item by item, then sorted by (order, id). */
function mergeList(base: unknown, o: Side, t: Side): unknown {
  if (!isItemList(o.value) || !isItemList(t.value)) return newer(o, t);
  const byId = (items: Item[]) => new Map(items.map((i) => [i.id, i]));
  const b = byId(isItemList(base) ? base : []);
  const os = byId(o.value);
  const ts = byId(t.value);
  const merged: Item[] = [];
  for (const id of sortedKeys(Object.fromEntries(os), Object.fromEntries(ts))) {
    const bi = b.get(id);
    const oi = os.get(id);
    const ti = ts.get(id);
    const simple = oneSided(bi, oi, ti);
    if (simple) {
      if (simple.value !== undefined) merged.push(simple.value as Item);
    } else if (oi === undefined || ti === undefined) {
      // Removed on one side, edited on the other: the edit wins.
      merged.push((oi ?? ti) as Item);
    } else {
      const item: Record<string, unknown> = {};
      for (const key of sortedKeys(bi, oi, ti)) {
        const v = mergeScalar(
          own(bi, key),
          { value: oi[key], hlc: o.hlc },
          { value: ti[key], hlc: t.hlc },
        );
        if (v !== undefined) put(item, key, v);
      }
      merged.push(item as Item);
    }
  }
  const orderOf = (i: Item) => String(i['order']);
  return merged.sort(
    (x, y) => compareStrings(orderOf(x), orderOf(y)) || compareStrings(x.id, y.id),
  );
}

/** Free-form maps (`_unknown`, extra envelope keys): per key, scalar rule on the record HLCs. */
function mergeMap(
  base: Readonly<Record<string, unknown>> | undefined,
  o: Readonly<Record<string, unknown>> | undefined,
  t: Readonly<Record<string, unknown>> | undefined,
  oHlc: Hlc,
  tHlc: Hlc,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of sortedKeys(base, o, t)) {
    const v = mergeScalar(
      own(base, key),
      { value: own(o, key), hlc: oHlc },
      { value: own(t, key), hlc: tHlc },
    );
    if (v !== undefined) put(out, key, v);
  }
  return out;
}

function mergeField(
  kind: MergeKind | 'scalar',
  base: unknown,
  o: Side,
  t: Side,
): { value: unknown; conflict: boolean } {
  const simple = oneSided(base, o.value, t.value);
  if (simple) return { ...simple, conflict: false };
  switch (kind) {
    case 'text':
      return mergeLongText(base, o, t);
    case 'set':
      return { value: mergeSet(base, o, t), conflict: false };
    case 'list':
      return { value: mergeList(base, o, t), conflict: false };
    case 'scalar':
      return { value: newer(o, t), conflict: false };
  }
}

/**
 * Deletion (SYNC.md §6): deleted on one side and edited on the other, the
 * edit wins; deleted on both, it stays deleted.
 */
function mergeDeletion(
  base: EntityRecord | null,
  ours: EntityRecord,
  theirs: EntityRecord,
): { deletedAt: string | null; restored: boolean } {
  const b = base?.deletedAt ?? null;
  const [o, t] = [ours.deletedAt, theirs.deletedAt];
  let deletedAt: string | null;
  if (o === t) deletedAt = o;
  else if (o === b) deletedAt = t;
  else if (t === b) deletedAt = o;
  // Both changed it: re-deleted on both sides keeps the first deletion;
  // restored on one side wins.
  else deletedAt = o !== null && t !== null ? minString(o, t) : null;

  const editedLive = (side: EntityRecord) =>
    side.deletedAt === null && (base === null || !same(side.data, base.data));
  if (deletedAt !== null && (editedLive(ours) || editedLive(theirs))) {
    return { deletedAt: null, restored: true };
  }
  return { deletedAt, restored: false };
}

const ENVELOPE_KEYS = new Set([
  'id',
  'type',
  'schema',
  'hlc',
  'fieldHlc',
  'deletedAt',
  'createdAt',
  'data',
  'conflicts',
]);

const extraKeys = (record: EntityRecord | null) =>
  record === null
    ? undefined
    : Object.fromEntries(Object.entries(record).filter(([key]) => !ENVELOPE_KEYS.has(key)));

/**
 * Merges two versions of one record against their common base. `base` is
 * null when the record is new on both sides.
 *
 * All three records must be decoded and upgraded to the same schema first.
 * Records that couldn't be decoded are never merged; they are kept as they are.
 */
export function mergeRecords(
  base: EntityRecord | null,
  ours: EntityRecord,
  theirs: EntityRecord,
  entities: Readonly<Record<string, EntityDef>> = ENTITIES,
): MergeResult {
  for (const r of base ? [base, theirs] : [theirs]) {
    if (r.id !== ours.id || r.type !== ours.type || r.schema !== ours.schema) {
      throw new MergeError('Only versions of the same record at the same schema can be merged');
    }
  }
  const def = own(entities, ours.type);
  if (!def) throw new MergeError(`Unknown type "${ours.type}"`);

  const fieldHlc: Record<string, Hlc> = {};
  for (const key of sortedKeys(ours.fieldHlc, theirs.fieldHlc)) {
    fieldHlc[key] = maxString(own(ours.fieldHlc, key) ?? '', own(theirs.fieldHlc, key) ?? '');
  }

  const data: Record<string, unknown> = {};
  const newConflicts: string[] = [];
  for (const key of sortedKeys(base?.data, ours.data, theirs.data)) {
    if (key === '_unknown') continue;
    const side = (r: EntityRecord): Side => ({
      value: own(r.data, key),
      hlc: own(r.fieldHlc, key) ?? r.hlc,
    });
    const kind = own(def.merge, key) ?? 'scalar';
    const { value, conflict } = mergeField(kind, own(base?.data, key), side(ours), side(theirs));
    if (value !== undefined) put(data, key, value);
    if (conflict) newConflicts.push(key);
  }
  const unknown = mergeMap(
    base?.data._unknown,
    ours.data._unknown,
    theirs.data._unknown,
    ours.hlc,
    theirs.hlc,
  );
  // Both sides having an (empty) `_unknown` keeps it, so merging a record with itself is a no-op.
  if (Object.keys(unknown).length > 0 || (ours.data._unknown && theirs.data._unknown)) {
    data['_unknown'] = unknown;
  }

  const conflictSet = mergeField(
    'set',
    base?.conflicts ?? [],
    { value: ours.conflicts ?? [], hlc: ours.hlc },
    { value: theirs.conflicts ?? [], hlc: theirs.hlc },
  ).value as string[];
  const conflicts = [...new Set([...conflictSet, ...newConflicts])].sort(compareStrings);

  const { deletedAt, restored } = mergeDeletion(base, ours, theirs);
  const record = {
    ...mergeMap(extraKeys(base), extraKeys(ours), extraKeys(theirs), ours.hlc, theirs.hlc),
    id: ours.id,
    type: ours.type,
    schema: ours.schema,
    hlc: maxString(ours.hlc, theirs.hlc),
    fieldHlc,
    deletedAt,
    createdAt: minString(ours.createdAt, theirs.createdAt),
    data,
    ...(conflicts.length > 0 ? { conflicts } : {}),
  } as EntityRecord;

  const parsed = def.data.safeParse(data);
  const issues = parsed.success
    ? []
    : parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`);
  return { record, restored, newConflicts, issues };
}
