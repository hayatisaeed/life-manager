import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  addDays,
  addMonths,
  dateToJdn,
  daysInMonth,
  diffDays,
  fromCalendar,
  isJalaliLeap,
  isLocalDate,
  jdnToDate,
  monthKey,
  monthRange,
  msOfUtcDate,
  startOfWeek,
  toCalendar,
  utcDateOfMs,
  weekday,
} from '../src';

describe('gregorian day numbers', () => {
  it('round-trips and matches Date.UTC', () => {
    fc.assert(
      fc.property(fc.integer({ min: -100_000, max: 100_000 }), (n) => {
        const d = addDays('2000-01-01', n);
        expect(dateToJdn(d) - dateToJdn('2000-01-01')).toBe(n);
        expect(utcDateOfMs(msOfUtcDate(d))).toBe(d);
        expect(new Date(msOfUtcDate(d)).toISOString().slice(0, 10)).toBe(d);
      }),
    );
  });
  it('weekday: 0 = Sunday', () => {
    expect(weekday('2026-10-11')).toBe(0);
    expect(weekday('2026-10-10')).toBe(6);
    expect(weekday('1970-01-01')).toBe(4);
  });
  it('startOfWeek', () => {
    expect(startOfWeek('2026-10-10', 1)).toBe('2026-10-05');
    expect(startOfWeek('2026-10-10', 6)).toBe('2026-10-10');
    expect(startOfWeek('2026-10-11', 6)).toBe('2026-10-10');
  });
  it('diffDays and validation', () => {
    expect(diffDays('2026-03-01', '2026-02-01')).toBe(28);
    expect(isLocalDate('2024-02-29')).toBe(true);
    expect(isLocalDate('2023-02-29')).toBe(false);
    expect(isLocalDate('2023-13-01')).toBe(false);
    expect(isLocalDate('20230101')).toBe(false);
    expect(() => dateToJdn('nope')).toThrow();
  });
});

describe('jalali', () => {
  it('known Nowruz dates', () => {
    expect(fromCalendar('jalali', { y: 1403, m: 1, d: 1 })).toBe('2024-03-20');
    expect(fromCalendar('jalali', { y: 1404, m: 1, d: 1 })).toBe('2025-03-21');
    expect(fromCalendar('jalali', { y: 1405, m: 1, d: 1 })).toBe('2026-03-21');
    expect(fromCalendar('jalali', { y: 1405, m: 7, d: 1 })).toBe('2026-09-23');
    expect(toCalendar('jalali', '2026-10-10')).toEqual({ y: 1405, m: 7, d: 18 });
  });
  it('leap years and month lengths', () => {
    expect(isJalaliLeap(1403)).toBe(true);
    expect(isJalaliLeap(1404)).toBe(false);
    expect(daysInMonth('jalali', 1403, 12)).toBe(30);
    expect(daysInMonth('jalali', 1404, 12)).toBe(29);
    expect(daysInMonth('jalali', 1404, 6)).toBe(31);
    expect(daysInMonth('jalali', 1404, 7)).toBe(30);
    expect(daysInMonth('gregorian', 2024, 2)).toBe(29);
    expect(daysInMonth('gregorian', 1900, 2)).toBe(28);
    expect(daysInMonth('gregorian', 2000, 2)).toBe(29);
    expect(daysInMonth('gregorian', 2026, 4)).toBe(30);
  });
  it('round-trips every day across 300 years', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 110_000 }), (n) => {
        const d = addDays('1900-01-01', n);
        const j = toCalendar('jalali', d);
        expect(fromCalendar('jalali', j)).toBe(d);
        expect(j.d).toBeLessThanOrEqual(daysInMonth('jalali', j.y, j.m));
        // consecutive days advance by exactly one jalali day
        const next = toCalendar('jalali', addDays(d, 1));
        if (next.d !== 1) expect(next.d).toBe(j.d + 1);
      }),
    );
  });
  it('rejects out-of-range years', () => {
    expect(() => fromCalendar('jalali', { y: 4000, m: 1, d: 1 })).toThrow();
  });
});

describe('months', () => {
  it('addMonths clamps', () => {
    expect(addMonths('gregorian', '2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('gregorian', '2026-03-15', -3)).toBe('2025-12-15');
    expect(addMonths('jalali', fromCalendar('jalali', { y: 1404, m: 6, d: 31 }), 1)).toBe(
      fromCalendar('jalali', { y: 1404, m: 7, d: 30 }),
    );
  });
  it('monthKey and monthRange', () => {
    expect(monthKey('gregorian', '2026-10-10')).toBe('2026-10');
    expect(monthKey('jalali', '2026-10-10')).toBe('1405-07');
    expect(monthRange('jalali', '1405-07')).toEqual({ start: '2026-09-23', end: '2026-10-22' });
    expect(monthRange('gregorian', '2026-02')).toEqual({ start: '2026-02-01', end: '2026-02-28' });
    expect(jdnToDate(dateToJdn('2026-02-28') + 1)).toBe('2026-03-01');
  });
});
