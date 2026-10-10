// Edge cases that keep merge/HLC/recurrence at 100% branch coverage (ROADMAP P0.3 AC).
import { describe, expect, it } from 'vitest';
import type { Envelope } from '../src';
import { maxHlc, merge, mergeList, occurrencesBetween } from '../src';

const e = (
  data: Record<string, unknown>,
  fieldHlc: Record<string, string>,
  extra: Partial<Envelope> = {},
): Envelope => ({
  id: 'X',
  type: 'task',
  schema: 1,
  hlc: 'h',
  fieldHlc,
  deletedAt: null,
  createdAt: '2026-01-02T00:00:00.000Z',
  data,
  ...extra,
});

describe('edges', () => {
  it('maxHlc picks the larger first argument', () => {
    expect(maxHlc('b', 'a')).toBe('b');
  });
  it('yearly with several months sorts them', () => {
    expect(
      occurrencesBetween(
        { calendar: 'gregorian', freq: 'yearly', interval: 1, mode: 'fixed', byMonth: [12, 3] },
        '2026-01-05',
        '2026-01-01',
        '2026-12-31',
      ),
    ).toEqual(['2026-03-05', '2026-12-05']);
  });
  it('set/list/text fields absent from base or one side', () => {
    const o = e({ tags: ['a'], notes: 'x' }, { tags: 'h1', notes: 'h1' });
    const t = e(
      { notes: 'y' },
      { tags: 'h2', notes: 'h2' },
      { createdAt: '2026-01-01T00:00:00.000Z' },
    );
    const m = merge(e({ notes: 5 }, {}), o, t);
    expect(m.data['tags']).toEqual(['a']);
    expect(m.createdAt).toBe('2026-01-01T00:00:00.000Z');
    const t2 = e({ tags: ['b'] }, { tags: 'h2' });
    expect(merge(null, o, t2).data['tags']).toEqual(['a', 'b']);
    const ro = e({ steps: [{ id: 'a' }] }, { steps: 'h1' }, { type: 'routine' });
    const rt = e({ steps: [{ id: 'b' }] }, { steps: 'h2' }, { type: 'routine' });
    expect(merge(null, ro, rt).data['steps']).toEqual([{ id: 'a' }, { id: 'b' }]);
  });
  it('window starting after dtstart and a set missing on one side', () => {
    expect(
      occurrencesBetween(
        { calendar: 'gregorian', freq: 'daily', interval: 1, mode: 'fixed' },
        '2026-01-01',
        '2026-01-03',
        '2026-01-04',
      ),
    ).toEqual(['2026-01-03', '2026-01-04']);
    const b = e({ tags: ['x'] }, { tags: 'h0' });
    const o = e({}, { tags: 'h1' });
    const t = e({ tags: ['x', 'y'] }, { tags: 'h2' });
    expect(merge(b, o, t).data['tags']).toEqual(['y']);
    expect(merge(b, t, o).data['tags']).toEqual(['y']);
  });
  it('scalar tie picks the larger value regardless of side', () => {
    const o = e({ title: 'a' }, { title: 'h' });
    const t = e({ title: 'b' }, { title: 'h' });
    expect(merge(null, o, t).data['title']).toBe('b');
    expect(merge(null, t, o).data['title']).toBe('b');
  });
  it('list items with equal order sort by id', () => {
    expect(
      mergeList(
        [],
        [
          { id: 'b', order: 'a' },
          { id: 'a', order: 'a' },
          { id: 'c', order: 'a' },
        ],
        [],
        'h',
        'h',
      ).map((i) => i.id),
    ).toEqual(['a', 'b', 'c']);
  });
});
