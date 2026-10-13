import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  CalendarDate,
  PersianCalendar,
  toCalendar,
  GregorianCalendar,
} from '@internationalized/date';
import {
  createIdGenerator,
  orderBetween,
  tickHlc,
  parseHlc,
  formatHlc,
  compareHlc,
  entitySchemas,
  localDateSchema,
  moneySchema,
  parseRecord,
  upgradeRecord,
  mergeRecords,
  mergeSet,
  mergeText,
  canonical,
  nextOccurrence,
  occurrences,
} from './index';
import type { Envelope, Recurrence } from './index';
const stamp = (counter: number, deviceId = 'a') => formatHlc({ millis: 1000, counter, deviceId });
const record = (data: Envelope['data'], counter = 0, deviceId = 'a'): Envelope => ({
  id: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
  type: 'note',
  schema: 1,
  hlc: stamp(counter, deviceId),
  fieldHlc: Object.fromEntries(Object.keys(data).map((key) => [key, stamp(counter, deviceId)])),
  deletedAt: null,
  createdAt: '1970-01-01T00:00:01.000Z',
  data,
});
const rule = (overrides: Partial<Recurrence> = {}): Recurrence => ({
  calendar: 'gregorian',
  freq: 'daily',
  interval: 1,
  mode: 'fixed',
  ...overrides,
});
const jalali = (y: number, m: number, d: number) =>
  toCalendar(new CalendarDate(new PersianCalendar(), y, m, d), new GregorianCalendar()).toString();
describe('HLC and IDs', () => {
  it('increments on rollback, remote receive and overflow', () => {
    const local = { millis: 1000, counter: 3, deviceId: 'a' };
    expect(tickHlc(local, 900).counter).toBe(4);
    expect(tickHlc(local, 2000).counter).toBe(0);
    expect(tickHlc(local, 500, { ...local, counter: 10 }).counter).toBe(11);
    expect(tickHlc(local, 500, { ...local, millis: 2000, counter: 10 }).counter).toBe(11);
    expect(tickHlc({ ...local, counter: 65535 }, 0)).toEqual({
      millis: 1001,
      counter: 0,
      deviceId: 'a',
    });
  });
  it('rejects malformed clocks', () => {
    for (const value of ['', '2026-02-30T00:00:00.000Z-0000-a', '2026-01-01T00:00:00.000Z-ffff-'])
      expect(() => parseHlc(value)).toThrow();
    expect(() => formatHlc({ millis: -1, counter: 0, deviceId: 'a' })).toThrow();
  });
  it('ticks above both local and received clocks for arbitrary rollback', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 1e12 }),
        fc.integer({ min: 0, max: 1e12 }),
        fc.integer({ min: 0, max: 1e12 }),
        fc.integer({ min: 0, max: 65535 }),
        (a, b, now, counter) => {
          const local = { millis: a, counter, deviceId: 'a' },
            remote = { millis: b, counter, deviceId: 'b' };
          const next = formatHlc(tickHlc(local, now, remote));
          expect(compareHlc(next, formatHlc(local))).toBe(1);
          expect(compareHlc(next, formatHlc(remote))).toBe(1);
        },
      ),
      { numRuns: 1000 },
    );
  });
  it('generates monotonic ULIDs with an injected source', () => {
    expect(createIdGenerator(() => 0.5)(0).startsWith('0000000000')).toBe(true);
    const generate = createIdGenerator(() => 0.5);
    const a = generate(1000),
      b = generate(1000),
      c = generate(900);
    expect(a < b && b < c).toBe(true);
    expect(() => generate(-1)).toThrow();
    expect(() => createIdGenerator(() => 1)(1000)).toThrow();
  });
  it('inserts an order key between adjacent items', () => {
    const a = orderBetween(null, null),
      b = orderBetween(a, null),
      middle = orderBetween(a, b);
    expect(a < middle && middle < b).toBe(true);
  });
});
describe('schemas and evolution', () => {
  it('rejects invalid dates, decimal money and invalid states', () => {
    expect(localDateSchema.safeParse('2026-02-30').success).toBe(false);
    expect(localDateSchema.safeParse('2024-02-29').success).toBe(true);
    expect(moneySchema.safeParse({ amount: 1.1, currency: 'USD' }).success).toBe(false);
    expect(
      moneySchema.safeParse({ amount: Number.MAX_SAFE_INTEGER + 1, currency: 'USD' }).success,
    ).toBe(false);
    expect(entitySchemas.task.safeParse({ title: 'Task', status: 'unknown' }).success).toBe(false);
  });
  it('validates known records and preserves unknown data and newer records', () => {
    const note = record({
      title: 'Title',
      content: 'text',
      tags: [],
      pinned: false,
      future: { x: 1 },
    });
    expect(parseRecord(note).record.data.future).toEqual({ x: 1 });
    const transaction = {
      ...record({
        accountId: note.id,
        date: '2026-10-13',
        amount: { amount: 1, currency: 'USD', future: 'keep' },
        notes: '',
        tags: [],
      }),
      type: 'transaction',
    };
    expect(parseRecord(transaction).record.data.amount).toEqual(transaction.data.amount);
    expect(parseRecord({ ...note, schema: 2 }).kind).toBe('preserved');
    expect(parseRecord({ ...note, type: 'future' }).kind).toBe('preserved');
    expect(() => parseRecord(record({ title: 3 }))).toThrow();
  });
  it('preserves removed fields during schema upgrades without mutating the original', () => {
    const note = record({ title: 'Old', legacy: 'keep' });
    const updated = upgradeRecord(note, 2, new Map([[1, () => ({ title: 'New' })]]));
    expect(updated.data._unknown).toEqual({ legacy: 'keep' });
    expect(note.data.title).toBe('Old');
    expect(() => upgradeRecord(note, 3, new Map())).toThrow();
    expect(() => upgradeRecord({ ...note, schema: 3 }, 2, new Map())).toThrow();
  });
});
describe('three-way merge', () => {
  it('merges independent fields and chooses newer concurrent scalar edits', () => {
    const base = record({ title: 'old', pinned: false });
    const a = record({ title: 'new', pinned: false }, 1);
    const b = record({ title: 'old', pinned: true }, 2, 'b');
    expect(mergeRecords(base, a, b).data).toEqual({ title: 'new', pinned: true });
    expect(mergeRecords(base, a, record({ title: 'latest', pinned: false }, 3)).data.title).toBe(
      'latest',
    );
  });
  it('keeps overlapping text, combines disjoint hunks and is symmetric', () => {
    expect(mergeText('a\nb\nc', 'A\nb\nc', 'a\nb\nC')).toEqual({
      value: 'A\nb\nC',
      conflict: false,
    });
    const merged = mergeText('old', 'first', 'second');
    expect(merged.conflict).toBe(true);
    expect(merged.value).toContain('first');
    expect(merged.value).toContain('second');
    expect(mergeText('old', 'second', 'first')).toEqual(merged);
  });
  it('removes sets from either side and keeps concurrent additions', () => {
    expect(mergeSet(['a', 'b'], ['b', 'c'], ['a', 'b', 'd'])).toEqual(['b', 'c', 'd']);
  });
  it('restores edits but respects deletes against unchanged records', () => {
    const base = record({ title: 'old' });
    const deleted = { ...record({ title: 'old' }, 2), deletedAt: '1970-01-01T00:00:02.000Z' };
    expect(mergeRecords(base, base, deleted).deletedAt).toBe(deleted.deletedAt);
    expect(mergeRecords(base, record({ title: 'edit' }, 1), deleted).deletedAt).toBeNull();
    expect(mergeRecords(base, deleted, deleted).deletedAt).toBe(deleted.deletedAt);
  });
  it('merges routine step edits by ID and preserves an edit against removal', () => {
    const base = record({
      steps: [
        { id: 'a', title: 'old', order: 'a0' },
        { id: 'b', title: 'b', order: 'a1' },
      ],
    });
    const a = record({ steps: [{ id: 'a', title: 'edit', order: 'a0' }] }, 1);
    const b = record({ steps: [{ id: 'b', title: 'b', order: 'a1' }] }, 2);
    expect(mergeRecords(base, a, b).data.steps).toEqual([{ id: 'a', title: 'edit', order: 'a0' }]);
  });
  it('is commutative and idempotent under random concurrent edits', () => {
    fc.assert(
      fc.property(
        fc.string(),
        fc.string(),
        fc.string(),
        fc.uniqueArray(fc.string()),
        fc.uniqueArray(fc.string()),
        (old, a, b, tagsA, tagsB) => {
          const base = record({ title: old, content: old, tags: [] });
          const ours = record({ title: a, content: a, tags: tagsA }, 1);
          const theirs = record({ title: b, content: b, tags: tagsB }, 2, 'b');
          expect(canonical(mergeRecords(base, ours, theirs))).toBe(
            canonical(mergeRecords(base, theirs, ours)),
          );
          const merged = mergeRecords(base, ours, theirs);
          expect(canonical(mergeRecords(base, merged, merged))).toBe(canonical(merged));
        },
      ),
      { numRuns: 1000 },
    );
  });
  it('converges for scalar updates regardless of delivery order', () => {
    fc.assert(
      fc.property(fc.array(fc.string(), { minLength: 2, maxLength: 20 }), (values) => {
        const base = record({ title: 'base' });
        const edits = values.map((title, i) => record({ title }, i + 1, `d${i}`));
        const forward = edits.reduce((acc, edit) => mergeRecords(base, acc, edit), base);
        const reverse = [...edits]
          .reverse()
          .reduce((acc, edit) => mergeRecords(base, acc, edit), base);
        expect(canonical(forward)).toBe(canonical(reverse));
      }),
      { numRuns: 1000 },
    );
  });
});
describe('recurrence', () => {
  it('respects intervals, count and inclusive until', () => {
    expect([...occurrences(rule({ interval: 3, count: 3 }), '2026-10-13')]).toEqual([
      '2026-10-13',
      '2026-10-16',
      '2026-10-19',
    ]);
    expect([...occurrences(rule({ until: '2026-10-15' }), '2026-10-13')]).toEqual([
      '2026-10-13',
      '2026-10-14',
      '2026-10-15',
    ]);
    expect(nextOccurrence(rule({ count: 1 }), '2026-10-13', '2026-10-13')).toBeNull();
  });
  it('skips invalid month days and handles leap years', () => {
    expect([...occurrences(rule({ freq: 'monthly', count: 3 }), '2026-01-31')]).toEqual([
      '2026-01-31',
      '2026-03-31',
      '2026-05-31',
    ]);
    expect([...occurrences(rule({ freq: 'yearly', count: 2 }), '2024-02-29')]).toEqual([
      '2024-02-29',
      '2028-02-29',
    ]);
  });
  it('handles weekdays, negative month days and set positions', () => {
    expect([
      ...occurrences(
        rule({ freq: 'monthly', byWeekday: [2], bySetPos: [2], count: 3 }),
        '2026-01-01',
      ),
    ]).toEqual(['2026-01-13', '2026-02-10', '2026-03-10']);
    expect([
      ...occurrences(rule({ freq: 'monthly', byMonthDay: [-1], count: 2 }), '2026-01-01'),
    ]).toEqual(['2026-01-31', '2026-02-28']);
    expect([
      ...occurrences(rule({ freq: 'weekly', byWeekday: [1, 3], count: 3 }), '2026-10-13'),
    ]).toEqual(['2026-10-14', '2026-10-19', '2026-10-21']);
  });
  it('does Jalali arithmetic across Nowruz and Esfand', () => {
    expect([
      ...occurrences(
        rule({ calendar: 'jalali', freq: 'monthly', byMonthDay: [-1], count: 3 }),
        jalali(1403, 11, 1),
      ),
    ]).toEqual([jalali(1403, 11, 30), jalali(1403, 12, 30), jalali(1404, 1, 31)]);
    expect(
      nextOccurrence(
        rule({ calendar: 'jalali', freq: 'yearly' }),
        jalali(1403, 1, 1),
        jalali(1403, 1, 1),
      ),
    ).toBe(jalali(1404, 1, 1));
  });
  it('anchors afterCompletion to completion and tracks consumed instances', () => {
    expect(
      nextOccurrence(rule({ interval: 3, mode: 'afterCompletion' }), '2026-10-01', '2026-10-13', {
        completedAt: '2026-10-13',
      }),
    ).toBe('2026-10-16');
    expect(
      nextOccurrence(rule({ mode: 'afterCompletion', count: 2 }), '2026-10-01', '2026-10-13', {
        completedAt: '2026-10-13',
        completedCount: 2,
      }),
    ).toBeNull();
    expect(() => [...occurrences(rule({ mode: 'afterCompletion' }), '2026-10-13')]).toThrow(
      'Completion date',
    );
  });
  it('returns strictly ordered valid dates in either calendar', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('gregorian' as const, 'jalali' as const),
        fc.constantFrom('daily' as const, 'weekly' as const, 'monthly' as const, 'yearly' as const),
        fc.integer({ min: 1, max: 10 }),
        (calendar, freq, interval) => {
          const dates = [
            ...occurrences(rule({ calendar, freq, interval, count: 20 }), '2026-10-13'),
          ];
          expect(dates).toHaveLength(20);
          dates.forEach((date, i) => {
            expect(localDateSchema.safeParse(date).success).toBe(true);
            if (i) expect(date > (dates[i - 1] ?? '')).toBe(true);
          });
        },
      ),
      { numRuns: 200 },
    );
  });
});
