import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { defineEntity, type EntityDef } from '../entities/define';
import { canonical } from './canonical';
import { mergeLoose as mergeRecords, type LooseRecord as EntityRecord } from './test-helpers';

// Property tests for the merge laws in SYNC.md §6. A test entity has one field
// of each merge kind; values come from small pools so the sides collide often.

const mix = defineEntity(
  { a: z.unknown(), opt: z.unknown(), s: z.unknown(), t: z.unknown(), l: z.unknown() },
  { merge: { s: 'set', t: 'text', l: 'list' } },
);
const entities: Record<string, EntityDef> = { mix };
const ID = '01J9ZQ4X2K8M3N5P6R7S8T9V0W';
const FIELDS = ['a', 'opt', 's', 't', 'l', '_unknown'] as const;

const scalar = fc.constantFrom<unknown>('x', 'y', 'z', 1, 2);
const set = fc.subarray(['a', 'b', 'c', 'd']);
const text = fc
  .array(fc.constantFrom('l1', 'l2', 'l3', 'l4'), { maxLength: 5 })
  .map((l) => l.join('\n'));
const list = fc.uniqueArray(
  fc.record({
    id: fc.constantFrom('i1', 'i2', 'i3'),
    title: fc.constantFrom('p', 'q'),
    order: fc.constantFrom('a0', 'a1', 'a2'),
  }),
  { selector: (i) => i.id, maxLength: 3 },
);
const unknownMap = fc.dictionary(fc.constantFrom('u', 'v'), scalar, { maxKeys: 2 });
const VALUE = {
  a: scalar,
  opt: fc.option(scalar, { nil: undefined }),
  s: set,
  t: text,
  l: list,
  _unknown: unknownMap,
};

const at = (minute: number, device: string) =>
  `2026-10-09T10:${String(minute).padStart(2, '0')}:00.000Z-0000-${device}`;
const instant = (minute: number) => `2026-10-09T11:${String(minute).padStart(2, '0')}:00.000Z`;

const baseRecord = fc
  .record({
    a: VALUE.a,
    opt: VALUE.opt,
    s: VALUE.s,
    t: VALUE.t,
    l: VALUE.l,
    _unknown: VALUE._unknown,
    deleted: fc.boolean(),
    conflicted: fc.boolean(),
  })
  .map(({ deleted, conflicted, ...fields }): EntityRecord => {
    const data = Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined));
    return {
      id: ID,
      type: 'mix',
      schema: 1,
      hlc: at(0, 'base'),
      fieldHlc: Object.fromEntries(Object.keys(data).map((k) => [k, at(0, 'base')])),
      deletedAt: deleted ? instant(0) : null,
      createdAt: '2026-10-09T09:00:00.000Z',
      ...(conflicted ? { conflicts: ['t'] } : {}),
      data,
    } as EntityRecord;
  });

/** A later edit of `base` by `device`: some fields change, possibly a delete or restore. */
const editOf = (base: EntityRecord, device: string) =>
  fc
    .record({
      minute: fc.integer({ min: 1, max: 9 }),
      changes: fc.record(
        Object.fromEntries(
          FIELDS.map((f) => [f, fc.option(VALUE[f], { nil: undefined, freq: 2 })]),
        ),
        { requiredKeys: [] },
      ),
      remove: fc.subarray(['opt', 't'] as const),
      deletion: fc.constantFrom('keep', 'delete', 'restore'),
      resolve: fc.boolean(),
    })
    .map(({ minute, changes, remove, deletion, resolve }): EntityRecord => {
      const h = at(minute, device);
      const removed = new Set<string>(remove);
      const data: Record<string, unknown> = Object.fromEntries(
        Object.entries({ ...base.data }).filter(([key]) => !removed.has(key)),
      );
      const fieldHlc: Record<string, string> = { ...base.fieldHlc };
      for (const [key, value] of Object.entries(changes)) {
        if (value === undefined || removed.has(key)) continue;
        data[key] = value;
        fieldHlc[key] = h;
      }
      for (const key of removed) fieldHlc[key] = h;
      const record: Record<string, unknown> = { ...base, hlc: h, fieldHlc, data };
      if (deletion === 'delete') record['deletedAt'] = instant(minute);
      if (deletion === 'restore') record['deletedAt'] = null;
      if (resolve) delete record['conflicts'];
      return record as EntityRecord;
    });

const scenario = baseRecord.chain((base) =>
  fc.tuple(fc.constant(base), editOf(base, 'devA'), editOf(base, 'devB'), editOf(base, 'devC')),
);

const merge = (b: EntityRecord | null, o: EntityRecord, t: EntityRecord) =>
  mergeRecords(b, o, t, entities);
/** Key order and set order aside, the same record. */
const sameRecord = (a: EntityRecord, b: EntityRecord) => expect(canonical(a)).toBe(canonical(b));

describe('merge laws (property)', () => {
  it('is commutative, byte for byte', () => {
    fc.assert(
      fc.property(scenario, fc.boolean(), ([base, ours, theirs], noBase) => {
        const b = noBase ? null : base;
        expect(JSON.stringify(merge(b, ours, theirs))).toBe(JSON.stringify(merge(b, theirs, ours)));
      }),
      { numRuns: 2000 },
    );
  });

  it('is idempotent: merging a record with itself returns it', () => {
    fc.assert(
      fc.property(scenario, ([base, x]) => {
        const result = merge(base, x, x);
        sameRecord(result.record, x);
        expect(result.restored).toBe(false);
      }),
      { numRuns: 1000 },
    );
  });

  it('applies a one-sided change unchanged', () => {
    fc.assert(
      fc.property(scenario, ([base, x]) => {
        sameRecord(merge(base, base, x).record, x);
        sameRecord(merge(base, x, base).record, x);
      }),
      { numRuns: 1000 },
    );
  });

  it('converges: devices that exchange edits agree, and a second sync changes nothing', () => {
    fc.assert(
      fc.property(scenario, ([base, a, b]) => {
        // SYNC.md §5: each device merges the other's version against the base.
        const onA = merge(base, a, b).record;
        const onB = merge(base, b, a).record;
        expect(JSON.stringify(onA)).toBe(JSON.stringify(onB));
        // Next cycle: A's sync_base is now b, and B pushed the same merge.
        sameRecord(merge(b, onA, onB).record, onA);
      }),
      { numRuns: 1000 },
    );
  });

  it('never loses a set element or list item that one side added', () => {
    fc.assert(
      fc.property(scenario, ([base, a, b]) => {
        const merged = merge(base, a, b).record.data as Record<string, unknown>;
        const before = new Set((base.data as Record<string, unknown[]>)['s']);
        for (const side of [a, b]) {
          for (const v of (side.data as Record<string, unknown[]>)['s'] ?? []) {
            if (!before.has(v)) expect(merged['s']).toContain(v);
          }
        }
        const ids = (r: unknown) => new Set((r as { id: string }[]).map((i) => i.id));
        const baseIds = ids((base.data as Record<string, unknown>)['l']);
        const mergedIds = ids(merged['l']);
        for (const side of [a, b]) {
          for (const id of ids((side.data as Record<string, unknown>)['l'])) {
            if (!baseIds.has(id)) expect(mergedIds.has(id)).toBe(true);
          }
        }
      }),
      { numRuns: 1000 },
    );
  });

  it('keeps every line either side wrote in long text', () => {
    fc.assert(
      fc.property(scenario, ([base, a, b]) => {
        const merged = String(
          (merge(base, a, b).record.data as Record<string, unknown>)['t'] ?? '',
        );
        const baseLines = new Set(
          String((base.data as Record<string, unknown>)['t'] ?? '').split('\n'),
        );
        for (const side of [a, b]) {
          const lines = String((side.data as Record<string, unknown>)['t'] ?? '').split('\n');
          for (const line of lines)
            if (!baseLines.has(line)) expect(merged.split('\n')).toContain(line);
        }
      }),
      { numRuns: 1000 },
    );
  });

  it('a record stays deleted only when no side edited it while live', () => {
    fc.assert(
      fc.property(scenario, ([base, a, b]) => {
        const { record, restored } = merge(base, a, b);
        const editedLive = (r: EntityRecord) =>
          r.deletedAt === null && canonical(r.data) !== canonical(base.data);
        if (editedLive(a) || editedLive(b)) expect(record.deletedAt).toBeNull();
        if (restored)
          expect(a.deletedAt !== null || b.deletedAt !== null || base.deletedAt !== null).toBe(
            true,
          );
      }),
      { numRuns: 1000 },
    );
  });
});
