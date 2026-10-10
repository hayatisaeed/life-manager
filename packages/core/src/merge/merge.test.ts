import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { defineEntity, type EntityDef } from '../entities/define';
import { FIXTURES, SAMPLE } from '../entities/test-fixtures';
import { MergeError } from './merge';
import { mergeLoose as mergeRecords, type LooseRecord as EntityRecord } from './test-helpers';
import { CONFLICT_END, CONFLICT_SEPARATOR, CONFLICT_START, mergeText } from './text';

const T0 = '2026-10-09T10:00:00.000Z-0000-base';
const hlc = (minute: number, device: string) =>
  `2026-10-09T10:${String(minute).padStart(2, '0')}:00.000Z-0000-${device}`;

const task = (
  patch: Partial<EntityRecord> & { data?: Record<string, unknown> } = {},
): EntityRecord =>
  ({
    id: SAMPLE.ID,
    type: 'task',
    schema: 1,
    hlc: T0,
    fieldHlc: {},
    deletedAt: null,
    createdAt: SAMPLE.AT,
    ...patch,
    data: { ...FIXTURES.task, ...patch.data },
  }) as EntityRecord;

/** An edit of `base` by `device` at `minute`: stamps the changed fields' HLCs. */
const edit = (
  base: EntityRecord,
  device: string,
  minute: number,
  data: Record<string, unknown>,
  extra: Partial<EntityRecord> = {},
): EntityRecord => {
  const h = hlc(minute, device);
  return {
    ...base,
    ...extra,
    hlc: h,
    fieldHlc: { ...base.fieldHlc, ...Object.fromEntries(Object.keys(data).map((k) => [k, h])) },
    data: { ...base.data, ...data },
  } as EntityRecord;
};

/** Merges both ways round and checks they agree byte for byte. */
const merge = (base: EntityRecord | null, ours: EntityRecord, theirs: EntityRecord) => {
  const a = mergeRecords(base, ours, theirs);
  const b = mergeRecords(base, theirs, ours);
  expect(JSON.stringify(b)).toBe(JSON.stringify(a));
  return a;
};

const base = task();

describe('SYNC.md §6 rules', () => {
  it('takes a field changed on one side only', () => {
    const ours = edit(base, 'devA', 5, { title: 'Call dad' });
    const theirs = edit(base, 'devB', 6, { priority: 1 });
    const { record } = merge(base, ours, theirs);
    expect(record.data).toMatchObject({ title: 'Call dad', priority: 1 });
    expect(record.fieldHlc).toEqual({ title: hlc(5, 'devA'), priority: hlc(6, 'devB') });
    expect(record.hlc).toBe(hlc(6, 'devB'));
  });

  it('gives a scalar changed on both sides to the later field HLC', () => {
    const ours = edit(base, 'devA', 9, { title: 'Later' });
    const theirs = edit(base, 'devB', 5, { title: 'Earlier' });
    expect(merge(base, ours, theirs).record.data.title).toBe('Later');
  });

  it('breaks an HLC tie by the larger device id', () => {
    const ours = edit(base, 'devA', 5, { title: 'From A' });
    const theirs = edit(base, 'devB', 5, { title: 'From B' });
    expect(merge(base, ours, theirs).record.data.title).toBe('From B');
  });

  it('breaks a full tie (same HLC, different value) by value', () => {
    const ours = edit(base, 'devA', 5, { title: 'a' });
    const theirs = { ...ours, data: { ...ours.data, title: 'b' } } as EntityRecord;
    expect(merge(base, ours, theirs).record.data.title).toBe('b');
  });

  it('falls back to the record HLC for fields without a field HLC', () => {
    const ours = {
      ...base,
      hlc: hlc(9, 'devA'),
      data: { ...base.data, title: 'A' },
    } as EntityRecord;
    const theirs = edit(base, 'devB', 5, { title: 'B' });
    expect(merge(base, ours, theirs).record.data.title).toBe('A');
  });

  it('merges sets: base + all additions − all removals', () => {
    const [t1, t2, t3, t4] = [
      '01J9ZQ4X2K8M3N5P6R7S8T9V01',
      '01J9ZQ4X2K8M3N5P6R7S8T9V02',
      '01J9ZQ4X2K8M3N5P6R7S8T9V03',
      '01J9ZQ4X2K8M3N5P6R7S8T9V04',
    ];
    const b = task({ data: { tags: [t1, t2] } });
    const ours = edit(b, 'devA', 5, { tags: [t2, t3] }); // −t1 +t3
    const theirs = edit(b, 'devB', 6, { tags: [t1, t2, t4] }); // +t4
    expect(merge(b, ours, theirs).record.data.tags).toEqual([t2, t3, t4]);
  });

  it('merges ordered lists by item id and sorts by (order, id)', () => {
    const step = (id: string, title: string, order: string) => ({ id, title, order });
    const [s1, s2, s3, s4] = [
      '01J9ZQ4X2K8M3N5P6R7S8T9V01',
      '01J9ZQ4X2K8M3N5P6R7S8T9V02',
      '01J9ZQ4X2K8M3N5P6R7S8T9V03',
      '01J9ZQ4X2K8M3N5P6R7S8T9V04',
    ];
    const routine = {
      ...base,
      type: 'routine',
      data: {
        ...FIXTURES.routine,
        steps: [step(s1, 'Stretch', 'a0'), step(s2, 'Water', 'a1'), step(s3, 'Read', 'a2')],
      },
    } as EntityRecord;
    const ours = edit(routine, 'devA', 5, {
      // Renames s1, moves s3 first, deletes s2.
      steps: [step(s3, 'Read', 'Zz'), step(s1, 'Stretch well', 'a0')],
    });
    const theirs = edit(routine, 'devB', 6, {
      // Edits s2 (so its deletion loses), retitles s1, adds s4.
      steps: [
        step(s1, 'Stretch!', 'a0'),
        step(s2, 'Water 500ml', 'a1'),
        step(s3, 'Read', 'a2'),
        step(s4, 'Plan', 'a3'),
      ],
    });
    expect(merge(routine, ours, theirs).record.data.steps).toEqual([
      step(s3, 'Read', 'Zz'),
      step(s1, 'Stretch!', 'a0'), // both retitled: devB is later
      step(s2, 'Water 500ml', 'a1'),
      step(s4, 'Plan', 'a3'),
    ]);
  });

  it('drops an item property one side removed when both edited the item', () => {
    const id = FIXTURES.routine.steps[0]?.id ?? '';
    const routine = { ...base, type: 'routine', data: { ...FIXTURES.routine } } as EntityRecord;
    const ours = edit(routine, 'devA', 5, { steps: [{ id, title: 'Stretch', order: 'a0' }] });
    const theirs = edit(routine, 'devB', 6, {
      steps: [{ id, title: 'Long stretch', durationMin: 5, order: 'a0' }],
    });
    expect(merge(routine, ours, theirs).record.data.steps).toEqual([
      { id, title: 'Long stretch', order: 'a0' },
    ]);
  });

  it('removes a list item deleted on one side and untouched on the other', () => {
    const steps = FIXTURES.routine.steps;
    const routine = { ...base, type: 'routine', data: { ...FIXTURES.routine } } as EntityRecord;
    const ours = edit(routine, 'devA', 5, { steps: [] });
    const theirs = edit(routine, 'devB', 6, { name: 'Morning!' });
    expect(merge(routine, ours, theirs).record.data).toMatchObject({ steps: [], name: 'Morning!' });
    expect(steps).toHaveLength(1);
  });

  it('merges long text with diff3', () => {
    const b = task({ data: { notes: 'one\ntwo\nthree' } });
    const ours = edit(b, 'devA', 5, { notes: 'ONE\ntwo\nthree' });
    const theirs = edit(b, 'devB', 6, { notes: 'one\ntwo\nTHREE' });
    const result = merge(b, ours, theirs);
    expect(result.record.data.notes).toBe('ONE\ntwo\nTHREE');
    expect(result.newConflicts).toEqual([]);
    expect(result.record.conflicts).toBeUndefined();
  });

  it('keeps both versions of overlapping text edits, older first, and flags the field', () => {
    const b = task({ data: { notes: 'one\ntwo' } });
    const ours = edit(b, 'devA', 9, { notes: 'one\nmine' });
    const theirs = edit(b, 'devB', 5, { notes: 'one\ntheirs' });
    const result = merge(b, ours, theirs);
    expect(result.record.data.notes).toBe(
      ['one', CONFLICT_START, 'theirs', CONFLICT_SEPARATOR, 'mine', CONFLICT_END].join('\n'),
    );
    expect(result.newConflicts).toEqual(['notes']);
    expect(result.record.conflicts).toEqual(['notes']);
  });

  it('keeps an optional text field absent when one side cleared it and the other left it', () => {
    const review = {
      ...base,
      type: 'weeklyReview',
      data: { ...FIXTURES.weeklyReview, highlights: 'x' },
    } as EntityRecord;
    const { highlights: _, ...cleared } = review.data as Record<string, unknown>;
    const ours = { ...edit(review, 'devA', 5, {}), data: cleared } as EntityRecord;
    const theirs = edit(review, 'devB', 6, { highlights: '' });
    expect(merge(review, ours, theirs).record.data).not.toHaveProperty('highlights');
  });

  it('keeps edits to an optional text field that the other side removed', () => {
    const review = {
      ...base,
      type: 'weeklyReview',
      data: { ...FIXTURES.weeklyReview, highlights: 'a\nb' },
    } as EntityRecord;
    const { highlights: _, ...cleared } = review.data as Record<string, unknown>;
    const ours = { ...edit(review, 'devA', 5, {}), data: cleared } as EntityRecord;
    const theirs = edit(review, 'devB', 6, { highlights: 'a\nb\nc' });
    expect(merge(review, ours, theirs).record.data).toHaveProperty('highlights');
  });

  it('restores a record deleted on one side and edited on the other', () => {
    const ours = edit(base, 'devA', 5, {}, { deletedAt: '2026-10-09T10:05:00.000Z' });
    const theirs = edit(base, 'devB', 6, { title: 'Still needed' });
    const result = merge(base, ours, theirs);
    expect(result.record.deletedAt).toBeNull();
    expect(result.restored).toBe(true);
    expect(result.record.data.title).toBe('Still needed');
  });

  it('deletes a record deleted on one side and untouched on the other', () => {
    const ours = edit(base, 'devA', 5, {}, { deletedAt: '2026-10-09T10:05:00.000Z' });
    const theirs = { ...base };
    expect(merge(base, ours, theirs)).toMatchObject({
      restored: false,
      record: { deletedAt: '2026-10-09T10:05:00.000Z' },
    });
  });

  it('keeps the first deletion when both sides delete', () => {
    const ours = edit(base, 'devA', 5, {}, { deletedAt: '2026-10-09T10:07:00.000Z' });
    const theirs = edit(base, 'devB', 6, {}, { deletedAt: '2026-10-09T10:05:00.000Z' });
    expect(merge(base, ours, theirs).record.deletedAt).toBe('2026-10-09T10:05:00.000Z');
  });

  it('lets an undelete win over a re-delete of a deleted base', () => {
    const deleted = task({ deletedAt: '2026-10-09T10:01:00.000Z' });
    const ours = edit(deleted, 'devA', 5, {}, { deletedAt: null });
    const theirs = edit(deleted, 'devB', 6, {}, { deletedAt: '2026-10-09T10:06:00.000Z' });
    expect(merge(deleted, ours, theirs).record.deletedAt).toBeNull();
  });

  it('treats a missing base as an empty one', () => {
    const ours = task({ hlc: hlc(5, 'devA'), data: { title: 'A' } });
    const theirs = task({
      hlc: hlc(6, 'devB'),
      data: { title: 'B' },
      deletedAt: '2026-10-09T10:06:00.000Z',
    });
    const result = merge(null, ours, theirs);
    expect(result.record.data.title).toBe('B');
    // With no base, both sides count as edits, so the record stays alive.
    expect(result.record.deletedAt).toBeNull();
  });
});

describe('data that must never be lost', () => {
  it('merges _unknown fields per key', () => {
    const b = task({ data: { _unknown: { a: 1, b: 1 } } });
    const ours = edit(b, 'devA', 5, { _unknown: { a: 2, b: 1 } });
    const theirs = edit(b, 'devB', 6, { _unknown: { a: 1, c: 3 } });
    expect(merge(b, ours, theirs).record.data._unknown).toEqual({ a: 2, c: 3 });
  });

  it('merges envelope keys from newer clients per key', () => {
    const b = task();
    const ours = { ...edit(b, 'devA', 5, {}), pinnedBy: 'x' } as EntityRecord;
    const theirs = { ...edit(b, 'devB', 6, {}), color: 'red' } as EntityRecord;
    expect(merge(b, ours, theirs).record).toMatchObject({ pinnedBy: 'x', color: 'red' });
  });

  it('keeps __proto__ keys as data', () => {
    const unknown = JSON.parse('{"__proto__":{"x":1}}') as Record<string, unknown>;
    const ours = edit(base, 'devA', 5, { _unknown: unknown });
    const result = merge(base, ours, base).record.data._unknown;
    expect(Object.getOwnPropertyDescriptor(result, '__proto__')?.value).toEqual({ x: 1 });
  });

  it('merges the conflict list as a set, so resolving a conflict sticks', () => {
    const b = task({ conflicts: ['notes'] });
    const ours = edit(b, 'devA', 5, { notes: 'resolved' }, { conflicts: [] });
    const theirs = edit(b, 'devB', 6, { title: 'x' });
    expect(merge(b, ours, theirs).record.conflicts).toBeUndefined();
  });

  it('reports merged data that breaks a cross-field rule but keeps it', () => {
    const b = task({ data: { dueDate: '2026-10-10', dueTime: undefined } });
    delete (b.data as Record<string, unknown>)['dueTime'];
    const { dueDate: _, ...noDue } = b.data as Record<string, unknown>;
    const ours = { ...edit(b, 'devA', 5, {}), data: noDue } as EntityRecord;
    const theirs = edit(b, 'devB', 6, { dueTime: '09:00' });
    const result = merge(b, ours, theirs);
    expect(result.record.data).toMatchObject({ dueTime: '09:00' });
    expect(result.issues).toEqual(['(root): dueTime needs a dueDate']);
  });
});

describe('malformed values fall back to the scalar rule', () => {
  const loose = defineEntity(
    { s: z.unknown(), l: z.unknown(), t: z.unknown() },
    { merge: { s: 'set', l: 'list', t: 'text' } },
  );
  const entities: Record<string, EntityDef> = { loose };
  const rec = (data: Record<string, unknown>, h = T0) =>
    ({ ...base, type: 'loose', hlc: h, data }) as EntityRecord;

  it.each([
    ['s', 'not a set'],
    ['l', [1, 2]],
    ['t', 42],
  ])('%s', (field, bad) => {
    const b = rec({});
    const ours = rec({ [field]: bad }, hlc(5, 'devA'));
    const theirs = rec({ [field]: field === 't' ? 'text' : [] }, hlc(6, 'devB'));
    const a = mergeRecords(b, ours, theirs, entities);
    expect(mergeRecords(b, theirs, ours, entities)).toEqual(a);
    expect(a.record.data[field]).toEqual(field === 't' ? 'text' : []);
    const lateBad = mergeRecords(b, rec({ [field]: bad }, hlc(7, 'devA')), theirs, entities);
    expect(lateBad.record.data[field]).toEqual(bad);
  });

  it('accepts a malformed base value', () => {
    const b = rec({ s: 'x', l: 'x', t: 1 });
    const ours = rec({ s: ['a'], l: [{ id: 'a', order: 'a0' }], t: 'x' }, hlc(5, 'devA'));
    const theirs = rec({ s: ['b'], l: [{ id: 'b', order: 'a1' }], t: 'y' }, hlc(6, 'devB'));
    expect(mergeRecords(b, ours, theirs, entities).record.data).toEqual({
      s: ['a', 'b'],
      l: [
        { id: 'a', order: 'a0' },
        { id: 'b', order: 'a1' },
      ],
      t: 'y',
    });
  });
});

describe('errors', () => {
  it('refuses to merge different records or schemas', () => {
    expect(() => mergeRecords(base, base, { ...base, id: SAMPLE.ID2 })).toThrow(MergeError);
    expect(() => mergeRecords({ ...base, schema: 2 }, base, base)).toThrow(MergeError);
    expect(() => mergeRecords(null, base, { ...base, type: 'note' } as EntityRecord)).toThrow(
      MergeError,
    );
  });
  it('refuses unknown types', () => {
    const odd = { ...base, type: 'hologram' } as EntityRecord;
    expect(() => mergeRecords(null, odd, odd)).toThrow(/Unknown type/);
  });
});

describe('mergeText', () => {
  it('handles insertions at both ends and an empty base', () => {
    expect(mergeText('b', 'a\nb', 'b\nc').text).toBe('a\nb\nc');
    expect(mergeText('', 'x', 'x')).toEqual({ text: 'x', conflict: false });
  });
});
