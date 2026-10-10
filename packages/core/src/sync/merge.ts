// Field-level 3-way merge of record envelopes, SYNC.md §6.
//
// Rules (per `data` field, plus `deletedAt`):
// - changed on one side only → that side
// - scalar changed on both → higher fieldHlc; ties → larger serialized value
// - set fields → base + (oursAdded ∪ theirsAdded) − (oursRemoved ∪ theirsRemoved)
// - ordered lists of {id, order} → merged per item id, an edited item beats a removal
// - long text → diff3; overlapping hunks are kept as a fenced conflict block and
//   `data.hasConflict` is set
// - delete vs edit → the edit wins and the record is restored
//
// The function is commutative in (ours, theirs) and idempotent
// (merge(b, x, x) = x); `merge.test.ts` checks both with fast-check.

import { diff3Merge } from 'node-diff3';
import type { Envelope } from '../entities/envelope';
import { DELETED_KEY } from '../entities/envelope';
import { entityDef } from '../entities/registry';

type Json = unknown;

/** Stable JSON: object keys sorted, so equal values serialize identically. */
export function stableStringify(v: Json): string {
  if (v === undefined) return 'undefined';
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(',')}]`;
  const obj = v as Record<string, unknown>;
  const keys = Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(',')}}`;
}

export const deepEqual = (a: Json, b: Json): boolean => stableStringify(a) === stableStringify(b);

const maxStr = (a: string, b: string): string => (a >= b ? a : b);

export const CONFLICT_START = '<<<<<<< conflict';
export const CONFLICT_SEP = '=======';
export const CONFLICT_END = '>>>>>>> end';

export interface MergeOutcome {
  envelope: Envelope;
  /** True when a delete lost to an edit (the UI shows a "restored" toast). */
  restored: boolean;
  /** True when a text merge produced a conflict block. */
  textConflict: boolean;
}

export function merge(base: Envelope | null, ours: Envelope, theirs: Envelope): Envelope {
  return mergeDetailed(base, ours, theirs).envelope;
}

export function mergeDetailed(
  base: Envelope | null,
  ours: Envelope,
  theirs: Envelope,
): MergeOutcome {
  const def = entityDef(ours.type) ?? entityDef(theirs.type);
  const sets = new Set(def?.sets ?? []);
  const lists = new Set(def?.lists ?? []);
  const texts = new Set(def?.texts ?? []);

  const bData = base?.data ?? {};
  const keys = new Set([
    ...Object.keys(bData),
    ...Object.keys(ours.data),
    ...Object.keys(theirs.data),
  ]);
  const data: Record<string, unknown> = {};
  const fieldHlc: Record<string, string> = {};
  let textConflict = false;

  for (const k of [...keys].sort()) {
    const b = bData[k];
    const o = ours.data[k];
    const t = theirs.data[k];
    const ho = ours.fieldHlc[k] ?? '';
    const ht = theirs.fieldHlc[k] ?? '';
    let v: unknown;
    let h: string;
    if (deepEqual(o, t)) {
      v = o;
      h = maxStr(ho, ht);
    } else if (deepEqual(o, b)) {
      v = t;
      h = ht;
    } else if (deepEqual(t, b)) {
      v = o;
      h = ho;
    } else {
      h = maxStr(ho, ht);
      if (sets.has(k) && isArrOrNil(o) && isArrOrNil(t) && isArrOrNil(b)) {
        v = mergeSet(b ?? [], o ?? [], t ?? []);
      } else if (
        lists.has(k) &&
        isItemList(o) &&
        isItemList(t) &&
        (b === undefined || isItemList(b))
      ) {
        v = mergeList(b ?? [], o, t, ho, ht);
      } else if (texts.has(k) && typeof o === 'string' && typeof t === 'string') {
        const r = mergeText(typeof b === 'string' ? b : '', o, t, ho, ht);
        v = r.text;
        if (r.conflict) textConflict = true;
      } else {
        v = pickScalar(o, t, ho, ht);
      }
    }
    if (v !== undefined) data[k] = v;
    if (h) fieldHlc[k] = h;
  }
  if (textConflict) {
    data['hasConflict'] = true;
    fieldHlc['hasConflict'] = maxStr(ours.hlc, theirs.hlc);
  }

  // --- deletedAt ---
  const bd = base?.deletedAt ?? null;
  const od = ours.deletedAt;
  const td = theirs.deletedAt;
  let deletedAt: string | null;
  let restored = false;
  if (od === td) {
    deletedAt = od;
  } else if (od !== null && td !== null) {
    deletedAt = maxStr(od, td);
  } else {
    // Exactly one side is deleted.
    const deletedSide = od !== null ? ours : theirs;
    const liveSide = od !== null ? theirs : ours;
    if (bd !== null) {
      // The live side undeleted it: a restore is an edit, so it wins.
      deletedAt = null;
    } else if (dataChanged(bData, liveSide.data) && !deepEqual(liveSide.data, deletedSide.data)) {
      deletedAt = null;
      restored = true;
    } else {
      deletedAt = deletedSide.deletedAt;
    }
  }
  const hd = maxStr(ours.fieldHlc[DELETED_KEY] ?? '', theirs.fieldHlc[DELETED_KEY] ?? '');
  if (hd) fieldHlc[DELETED_KEY] = hd;

  return {
    envelope: {
      id: ours.id,
      type: ours.type,
      schema: Math.max(ours.schema, theirs.schema),
      hlc: maxStr(ours.hlc, theirs.hlc),
      fieldHlc,
      deletedAt,
      createdAt: ours.createdAt <= theirs.createdAt ? ours.createdAt : theirs.createdAt,
      data,
    },
    restored,
    textConflict,
  };
}

function dataChanged(base: Record<string, unknown>, d: Record<string, unknown>): boolean {
  return !deepEqual(base, d);
}

function pickScalar(o: unknown, t: unknown, ho: string, ht: string): unknown {
  if (ho !== ht) return ho > ht ? o : t;
  return stableStringify(o) >= stableStringify(t) ? o : t;
}

const isArrOrNil = (v: unknown): v is unknown[] | undefined => v === undefined || Array.isArray(v);

// --- sets -------------------------------------------------------------------

export function mergeSet(base: unknown[], ours: unknown[], theirs: unknown[]): unknown[] {
  const key = stableStringify;
  const bk = new Set(base.map(key));
  const ok = new Set(ours.map(key));
  const tk = new Set(theirs.map(key));
  const removed = new Set([...bk].filter((k) => !ok.has(k) || !tk.has(k)));
  const out: unknown[] = [];
  const seen = new Set<string>();
  for (const v of base) {
    const k = key(v);
    if (!removed.has(k) && !seen.has(k)) {
      out.push(v);
      seen.add(k);
    }
  }
  const added = new Map<string, unknown>();
  for (const v of [...ours, ...theirs]) {
    const k = key(v);
    if (!bk.has(k) && !seen.has(k)) added.set(k, v);
  }
  for (const k of [...added.keys()].sort()) out.push(added.get(k));
  return out;
}

// --- ordered lists ----------------------------------------------------------

interface Item {
  id: string;
  order?: string;
  [k: string]: unknown;
}

function isItemList(v: unknown): v is Item[] {
  return (
    Array.isArray(v) &&
    v.every((x) => typeof x === 'object' && x !== null && typeof (x as Item).id === 'string')
  );
}

export function mergeList(
  base: Item[],
  ours: Item[],
  theirs: Item[],
  ho: string,
  ht: string,
): Item[] {
  const bm = new Map(base.map((i) => [i.id, i]));
  const om = new Map(ours.map((i) => [i.id, i]));
  const tm = new Map(theirs.map((i) => [i.id, i]));
  const ids = new Set([...bm.keys(), ...om.keys(), ...tm.keys()]);
  const out: Item[] = [];
  for (const id of ids) {
    const b = bm.get(id);
    const o = om.get(id);
    const t = tm.get(id);
    if (o && t) {
      if (deepEqual(o, t) || deepEqual(t, b)) out.push(o);
      else if (deepEqual(o, b)) out.push(t);
      else out.push(pickScalar(o, t, ho, ht) as Item);
    } else if (o || t) {
      const only = (o ?? t) as Item;
      // Added on one side, or removed on the other: keep it if it was added or edited.
      if (!b || !deepEqual(only, b)) out.push(only);
    }
  }
  return out.sort((a, b) => {
    const ao = a.order ?? '';
    const bo = b.order ?? '';
    if (ao !== bo) return ao < bo ? -1 : 1;
    return a.id < b.id ? -1 : 1; // ids are unique within a merged list
  });
}

// --- text -------------------------------------------------------------------

export function mergeText(
  base: string,
  ours: string,
  theirs: string,
  ho: string,
  ht: string,
): { text: string; conflict: boolean } {
  // Order the two sides canonically so the result doesn't depend on which device merges.
  const oursFirst = ho !== ht ? ho > ht : ours >= theirs;
  const a = oursFirst ? ours : theirs;
  const b = oursFirst ? theirs : ours;
  const regions = diff3Merge(a.split('\n'), base.split('\n'), b.split('\n'), {
    excludeFalseConflicts: true,
  }) as ({ ok: string[] } | { conflict: { a: string[]; o: string[]; b: string[] } })[];
  const lines: string[] = [];
  let conflict = false;
  for (const r of regions) {
    if ('ok' in r) lines.push(...r.ok);
    else {
      conflict = true;
      lines.push(CONFLICT_START, ...r.conflict.a, CONFLICT_SEP, ...r.conflict.b, CONFLICT_END);
    }
  }
  return { text: lines.join('\n'), conflict };
}
