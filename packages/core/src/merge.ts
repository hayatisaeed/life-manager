import { combineTextGraphs, appendTextVersion, renderTextGraph } from './text-versions';
import type { TextGraph } from './text-versions';
export { mergeText } from './merge-text';
import { compareHlc } from './clock';
import type { Envelope } from './entities';
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
/** Stable serialization gives deterministic tie-breaking independent of insertion order. */
export function canonical(value: unknown): string {
  if (value === undefined) return 'undefined';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  return `{${Object.entries(value)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
    .join(',')}}`;
}
const same = (a: unknown, b: unknown) => canonical(a) === canonical(b);
const setFields = new Set([
  'tags',
  'personIds',
  'followUpTaskIds',
  'completedStepIds',
  'acceptedBlockIds',
  'remindDaysBefore',
]);
const textFields = new Set([
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
export function mergeSet(
  base: readonly Json[],
  ours: readonly Json[],
  theirs: readonly Json[],
): Json[] {
  const original = new Map(base.map((v) => [canonical(v), v]));
  const a = new Map(ours.map((v) => [canonical(v), v]));
  const b = new Map(theirs.map((v) => [canonical(v), v]));
  return [...new Set([...a.keys(), ...b.keys()])]
    .sort()
    .filter((key) => !original.has(key) || (a.has(key) && b.has(key)))
    .map((key) => (a.has(key) ? (a.get(key) as Json) : (b.get(key) as Json)));
}

function scalar(
  base: Json | undefined,
  ours: Json | undefined,
  theirs: Json | undefined,
  aClock: string,
  bClock: string,
): Json | undefined {
  if (same(ours, theirs)) return ours;
  if (same(base, ours)) return theirs;
  if (same(base, theirs)) return ours;
  const comparison = compareHlc(aClock, bClock);
  return comparison > 0
    ? ours
    : comparison < 0
      ? theirs
      : canonical(ours) > canonical(theirs)
        ? ours
        : theirs;
}
/** SYNC.md §6: three-way merge. Does not mutate its inputs or invent a local clock tick. */
export function mergeRecords(
  base: Envelope | undefined,
  ours: Envelope,
  theirs: Envelope,
): Envelope {
  if (
    ours.id !== theirs.id ||
    ours.type !== theirs.type ||
    ours.schema !== theirs.schema ||
    (base && (base.id !== ours.id || base.type !== ours.type || base.schema !== ours.schema))
  )
    throw new Error('Incompatible record merge');
  const aNewer =
    compareHlc(ours.hlc, theirs.hlc) > 0 ||
    (ours.hlc === theirs.hlc && canonical(ours) > canonical(theirs));
  const winner = aNewer ? ours : theirs;
  const result: Envelope = {
    ...winner,
    data: {},
    fieldHlc: {},
    textVersions: {},
    createdAt: ours.createdAt < theirs.createdAt ? ours.createdAt : theirs.createdAt,
  };
  let conflict = false;
  const fields = [
    ...new Set([
      ...Object.keys(base?.data ?? {}),
      ...Object.keys(ours.data),
      ...Object.keys(theirs.data),
    ]),
  ].sort();
  for (const key of fields) {
    const original = base?.data[key] as Json | undefined;
    const a = ours.data[key] as Json | undefined;
    const b = theirs.data[key] as Json | undefined;
    const aClock = ours.fieldHlc[key] ?? ours.hlc;
    const bClock = theirs.fieldHlc[key] ?? theirs.hlc;
    let value: Json | undefined;
    if (setFields.has(key) && Array.isArray(a) && Array.isArray(b))
      value = mergeSet(Array.isArray(original) ? original : [], a, b);
    else if (textFields.has(key) && typeof a === 'string' && typeof b === 'string') {
      const graph = combineTextGraphs(graphFor(ours, key, base), graphFor(theirs, key, base));
      const merged = renderTextGraph(graph);
      value = merged.value;
      conflict ||= merged.conflict;
      if (result.textVersions)
        Object.defineProperty(result.textVersions, key, {
          value: graph,
          writable: true,
          enumerable: true,
          configurable: true,
        });
    } else if (key === 'steps' && Array.isArray(a) && Array.isArray(b))
      value = mergeSteps(Array.isArray(original) ? original : [], a, b, aClock, bClock);
    else value = scalar(original, a, b, aClock, bClock);
    if (value !== undefined)
      Object.defineProperty(result.data, key, {
        value,
        writable: true,
        enumerable: true,
        configurable: true,
      });
    const mergedClock =
      same(a, original) && !same(b, original)
        ? bClock
        : same(b, original) && !same(a, original)
          ? aClock
          : compareHlc(aClock, bClock) >= 0
            ? aClock
            : bClock;
    Object.defineProperty(result.fieldHlc, key, {
      value: mergedClock,
      writable: true,
      enumerable: true,
      configurable: true,
    });
  }
  if (conflict) {
    result.data.hasConflict = true;
    result.fieldHlc.hasConflict = winner.hlc;
  }
  // An unchanged live record does not resurrect a tombstone; a concurrent edit does.
  if ((ours.deletedAt === null) !== (theirs.deletedAt === null)) {
    const live = ours.deletedAt === null ? ours : theirs;
    const deleted = ours.deletedAt === null ? theirs : ours;
    result.deletedAt =
      !base || !same(live.data, base.data) || base.deletedAt !== null ? null : deleted.deletedAt;
  } else if (ours.deletedAt && theirs.deletedAt)
    result.deletedAt = ours.deletedAt > theirs.deletedAt ? ours.deletedAt : theirs.deletedAt;
  if (!conflict && 'hasConflict' in result.data) result.data.hasConflict = false;
  if (Object.keys(result.textVersions ?? {}).length === 0) delete result.textVersions;
  return result;
}
function graphFor(record: Envelope, key: string, base?: Envelope): TextGraph {
  const value = record.data[key];
  if (typeof value !== 'string') return [];
  const clock = record.fieldHlc[key] ?? record.hlc;
  const existing = record.textVersions?.[key];
  if (existing) {
    if (renderTextGraph(existing).value === value) return existing;
    return appendTextVersion(existing, clock, value);
  }
  const old = base?.data[key];
  if (base && typeof old === 'string') {
    const original = graphFor(base, key);
    return old === value ? original : appendTextVersion(original, clock, value);
  }
  return [{ clock, value, parents: [] }];
}
/** A local write must update provenance before its rendered text replaces the old value. */
export function editText(record: Envelope, key: string, value: string, clock: string): Envelope {
  if (!textFields.has(key)) throw new Error('Not a long text field');
  if (compareHlc(clock, record.hlc) <= 0) throw new Error('Local edit clock must advance');
  const graph = appendTextVersion(graphFor(record, key), clock, value);
  return {
    ...record,
    hlc: clock,
    fieldHlc: { ...record.fieldHlc, [key]: clock },
    data: { ...record.data, [key]: value },
    textVersions: { ...record.textVersions, [key]: graph },
  };
}
function mergeSteps(
  base: Json[],
  ours: Json[],
  theirs: Json[],
  aClock: string,
  bClock: string,
): Json[] {
  const index = (items: Json[]) =>
    new Map(
      items.map((item) => {
        if (!item || Array.isArray(item) || typeof item !== 'object' || typeof item.id !== 'string')
          throw new Error('Invalid ordered item');
        return [item.id, item] as const;
      }),
    );
  const original = index(base),
    a = index(ours),
    b = index(theirs);
  const result: Json[] = [];
  for (const id of [...new Set([...a.keys(), ...b.keys()])].sort()) {
    const old = original.get(id),
      av = a.get(id),
      bv = b.get(id);
    if (av && bv) {
      const value: Record<string, Json> = {};
      for (const key of new Set([
        ...Object.keys(old ?? {}),
        ...Object.keys(av),
        ...Object.keys(bv),
      ])) {
        const selected = scalar(old?.[key], av[key], bv[key], aClock, bClock);
        if (selected !== undefined)
          Object.defineProperty(value, key, {
            value: selected,
            writable: true,
            enumerable: true,
            configurable: true,
          });
      }
      result.push(value);
    } else if (!old || !same(old, av ?? bv)) result.push((av ?? bv) as Json);
  }
  return result.sort((a, b) => {
    const ak = canonical((a as Record<string, Json>).order),
      bk = canonical((b as Record<string, Json>).order);
    return ak < bk
      ? -1
      : ak > bk
        ? 1
        : canonical(a) < canonical(b)
          ? -1
          : canonical(a) > canonical(b)
            ? 1
            : 0;
  });
}
