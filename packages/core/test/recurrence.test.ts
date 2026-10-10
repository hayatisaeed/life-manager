import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import type { Recurrence } from '../src';
import {
  addDays,
  advanceRecurrence,
  fromCalendar,
  nextAfterCompletion,
  nextOccurrence,
  occurrencesBetween,
  toCalendar,
  weekday,
} from '../src';

const R = (r: Partial<Recurrence>): Recurrence => ({
  calendar: 'gregorian',
  freq: 'daily',
  interval: 1,
  mode: 'fixed',
  ...r,
});

describe('recurrence (gregorian)', () => {
  it('daily with interval and count', () => {
    expect(
      occurrencesBetween(R({ interval: 3, count: 4 }), '2026-10-01', '2026-01-01', '2026-12-31'),
    ).toEqual(['2026-10-01', '2026-10-04', '2026-10-07', '2026-10-10']);
  });
  it('daily filtered by weekday/month/monthday', () => {
    const wk = occurrencesBetween(
      R({ byWeekday: [1, 3] }),
      '2026-10-01',
      '2026-10-01',
      '2026-10-14',
    );
    expect(wk).toEqual(['2026-10-05', '2026-10-07', '2026-10-12', '2026-10-14']);
    expect(
      occurrencesBetween(R({ byMonth: [11] }), '2026-10-30', '2026-10-30', '2026-11-02'),
    ).toEqual(['2026-11-01', '2026-11-02']);
    expect(
      occurrencesBetween(R({ byMonthDay: [-1] }), '2026-01-01', '2026-01-01', '2026-03-31'),
    ).toEqual(['2026-01-31', '2026-02-28', '2026-03-31']);
  });
  it('weekly on several days, every 2 weeks', () => {
    const r = R({ freq: 'weekly', interval: 2, byWeekday: [1, 5] });
    expect(occurrencesBetween(r, '2026-10-05', '2026-10-01', '2026-10-31')).toEqual([
      '2026-10-05',
      '2026-10-09',
      '2026-10-19',
      '2026-10-23',
    ]);
    // default weekday = dtstart's
    expect(
      occurrencesBetween(R({ freq: 'weekly' }), '2026-10-07', '2026-10-01', '2026-10-21'),
    ).toEqual(['2026-10-07', '2026-10-14', '2026-10-21']);
  });
  it('weekly with byMonth and setPos', () => {
    const r = R({ freq: 'weekly', byWeekday: [1, 2, 3, 4, 5], bySetPos: [-1] });
    expect(occurrencesBetween(r, '2026-10-05', '2026-10-01', '2026-10-18')).toEqual([
      '2026-10-09',
      '2026-10-16',
    ]);
    expect(
      occurrencesBetween(
        R({ freq: 'weekly', byMonth: [11] }),
        '2026-10-26',
        '2026-10-01',
        '2026-11-10',
      ),
    ).toEqual(['2026-11-02', '2026-11-09']);
  });
  it('monthly by monthday skips invalid dates', () => {
    expect(
      occurrencesBetween(R({ freq: 'monthly' }), '2026-01-31', '2026-01-01', '2026-05-31'),
    ).toEqual(['2026-01-31', '2026-03-31', '2026-05-31']);
    expect(
      occurrencesBetween(
        R({ freq: 'monthly', byMonthDay: [1, -1] }),
        '2026-02-01',
        '2026-02-01',
        '2026-03-31',
      ),
    ).toEqual(['2026-02-01', '2026-02-28', '2026-03-01', '2026-03-31']);
  });
  it('monthly 2nd Tuesday and last Friday', () => {
    expect(
      occurrencesBetween(
        R({ freq: 'monthly', byWeekday: [2], bySetPos: [2] }),
        '2026-01-01',
        '2026-01-01',
        '2026-03-31',
      ),
    ).toEqual(['2026-01-13', '2026-02-10', '2026-03-10']);
    expect(
      occurrencesBetween(
        R({ freq: 'monthly', byWeekday: [5], bySetPos: [-1] }),
        '2026-01-01',
        '2026-01-01',
        '2026-02-28',
      ),
    ).toEqual(['2026-01-30', '2026-02-27']);
    // every Monday of the month without setPos; byMonthDay ∩ byWeekday ("Friday the 13th")
    expect(
      occurrencesBetween(
        R({ freq: 'monthly', byWeekday: [1] }),
        '2026-02-01',
        '2026-02-01',
        '2026-02-28',
      ),
    ).toHaveLength(4);
    expect(
      occurrencesBetween(
        R({ freq: 'monthly', byWeekday: [5], byMonthDay: [13] }),
        '2026-01-01',
        '2026-01-01',
        '2026-12-31',
      ),
    ).toEqual(['2026-02-13', '2026-03-13', '2026-11-13']);
    expect(
      occurrencesBetween(
        R({ freq: 'monthly', byMonth: [3] }),
        '2026-01-05',
        '2026-01-01',
        '2027-12-31',
      ),
    ).toEqual(['2026-03-05', '2027-03-05']);
    expect(
      occurrencesBetween(
        R({ freq: 'monthly', bySetPos: [9], byWeekday: [1] }),
        '2026-01-01',
        '2026-01-01',
        '2026-03-01',
      ),
    ).toEqual([]);
  });
  it('yearly', () => {
    expect(
      occurrencesBetween(R({ freq: 'yearly' }), '2024-02-29', '2024-01-01', '2032-12-31'),
    ).toEqual(['2024-02-29', '2028-02-29', '2032-02-29']);
    expect(
      occurrencesBetween(
        R({ freq: 'yearly', byMonth: [11], byWeekday: [4], bySetPos: [4] }),
        '2026-01-01',
        '2026-01-01',
        '2027-12-31',
      ),
    ).toEqual(['2026-11-26', '2027-11-25']);
    expect(
      occurrencesBetween(
        R({ freq: 'yearly', byMonthDay: [1] }),
        '2026-10-01',
        '2026-10-01',
        '2026-12-31',
      ),
    ).toEqual(['2026-10-01', '2026-11-01', '2026-12-01']);
  });
  it('until and limit', () => {
    expect(
      occurrencesBetween(R({ until: '2026-10-03' }), '2026-10-01', '2026-10-01', '2026-12-31'),
    ).toHaveLength(3);
    expect(
      occurrencesBetween(R({}), '2026-10-01', '2026-10-01', '2030-12-31', { limit: 5 }),
    ).toHaveLength(5);
  });
  it('impossible rules terminate', () => {
    expect(
      nextOccurrence(
        R({ freq: 'monthly', byMonthDay: [31], byMonth: [2] }),
        '2026-01-01',
        '2026-01-01',
      ),
    ).toBeNull();
    expect(
      nextOccurrence(R({ byMonth: [2], byMonthDay: [30] }), '2026-01-01', '2026-01-01'),
    ).toBeNull();
  });
  it('nextOccurrence', () => {
    expect(nextOccurrence(R({ freq: 'weekly' }), '2026-10-07', '2026-10-07')).toBe('2026-10-14');
    expect(nextOccurrence(R({ count: 1 }), '2026-10-07', '2026-10-07')).toBeNull();
  });
  it('every occurrence matches its weekday filter (property)', () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.integer({ min: 0, max: 6 }), { minLength: 1, maxLength: 7 }),
        fc.integer({ min: 1, max: 4 }),
        fc.integer({ min: 0, max: 3000 }),
        (days, interval, off) => {
          const start = addDays('2020-01-01', off);
          const occ = occurrencesBetween(
            R({ freq: 'weekly', interval, byWeekday: days }),
            start,
            start,
            addDays(start, 120),
          );
          for (const d of occ) expect(days).toContain(weekday(d));
          for (let i = 1; i < occ.length; i++) expect(occ[i]! > occ[i - 1]!).toBe(true);
        },
      ),
    );
  });
});

describe('recurrence (jalali)', () => {
  it('15th of every Jalali month', () => {
    const r = R({ calendar: 'jalali', freq: 'monthly' });
    const start = fromCalendar('jalali', { y: 1405, m: 6, d: 15 });
    const occ = occurrencesBetween(
      r,
      start,
      start,
      fromCalendar('jalali', { y: 1405, m: 9, d: 1 }),
    );
    expect(occ.map((d) => toCalendar('jalali', d))).toEqual([
      { y: 1405, m: 6, d: 15 },
      { y: 1405, m: 7, d: 15 },
      { y: 1405, m: 8, d: 15 },
    ]);
  });
  it('last day of Esfand handles leap years', () => {
    const r = R({ calendar: 'jalali', freq: 'yearly', byMonth: [12], byMonthDay: [-1] });
    const occ = occurrencesBetween(r, '2024-01-01', '2024-01-01', '2026-12-31');
    expect(occ.map((d) => toCalendar('jalali', d))).toEqual([
      { y: 1402, m: 12, d: 29 },
      { y: 1403, m: 12, d: 30 },
      { y: 1404, m: 12, d: 29 },
    ]);
  });
  it('31st only in the first six months', () => {
    const r = R({ calendar: 'jalali', freq: 'monthly', byMonthDay: [31] });
    const start = fromCalendar('jalali', { y: 1405, m: 1, d: 1 });
    expect(
      occurrencesBetween(r, start, start, fromCalendar('jalali', { y: 1405, m: 12, d: 29 })),
    ).toHaveLength(6);
  });
});

describe('afterCompletion and advance', () => {
  it('nextAfterCompletion per freq', () => {
    expect(nextAfterCompletion(R({ mode: 'afterCompletion', interval: 3 }), '2026-10-10')).toBe(
      '2026-10-13',
    );
    expect(nextAfterCompletion(R({ mode: 'afterCompletion', freq: 'weekly' }), '2026-10-10')).toBe(
      '2026-10-17',
    );
    expect(nextAfterCompletion(R({ mode: 'afterCompletion', freq: 'monthly' }), '2026-01-31')).toBe(
      '2026-02-28',
    );
    expect(nextAfterCompletion(R({ mode: 'afterCompletion', freq: 'yearly' }), '2024-02-29')).toBe(
      '2025-02-28',
    );
    expect(
      nextAfterCompletion(R({ mode: 'afterCompletion', until: '2026-10-11' }), '2026-10-10'),
    ).toBe('2026-10-11');
    expect(
      nextAfterCompletion(R({ mode: 'afterCompletion', until: '2026-10-10' }), '2026-10-10'),
    ).toBeNull();
  });
  it('advanceRecurrence decrements count and ends', () => {
    const a = advanceRecurrence(R({ freq: 'weekly', count: 3 }), '2026-10-07', '2026-10-09');
    expect(a).toEqual({ due: '2026-10-14', rule: R({ freq: 'weekly', count: 2 }) });
    expect(advanceRecurrence(R({ count: 1 }), '2026-10-07', '2026-10-07')).toBeNull();
    expect(
      advanceRecurrence(R({ mode: 'afterCompletion', interval: 2 }), '2026-10-07', '2026-10-09')
        ?.due,
    ).toBe('2026-10-11');
    expect(advanceRecurrence(R({ until: '2026-10-07' }), '2026-10-07', '2026-10-07')).toBeNull();
    expect(advanceRecurrence(R({}), '2026-10-07', '2026-10-07')?.rule).toEqual(R({}));
  });
});
