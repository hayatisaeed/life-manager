import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { recurrence as recurrenceSchema } from '../entities/primitives';
import {
  CALENDARS,
  fromLocalDate,
  RecurrenceError,
  toLocalDate,
  weekdayOf,
  type CalendarSystem,
} from './calendar';
import { nextInstance, occurrences, type Recurrence } from './engine';

const MON = { weekStart: 1 };
const SAT = { weekStart: 6 };
/** Rule fields as tests write them, with `as const` literals allowed. */
type RuleInput = {
  readonly [K in keyof Recurrence]?: Recurrence[K] extends number[] | undefined
    ? readonly number[]
    : Recurrence[K];
};
const rule = (r: RuleInput): Recurrence =>
  ({ calendar: 'gregorian', freq: 'daily', interval: 1, mode: 'fixed', ...r }) as Recurrence;
const all = (r: RuleInput, start: string, to: string, options = MON) =>
  occurrences(rule(r), start, { from: start, to }, options);

describe('calendars', () => {
  it('converts known Jalali dates', () => {
    const j = (y: number, m: number, d: number) => toLocalDate(CALENDARS.jalali.toJdn({ y, m, d }));
    expect(j(1403, 1, 1)).toBe('2024-03-20');
    expect(j(1403, 12, 30)).toBe('2025-03-20'); // 1403 is a leap year
    expect(j(1404, 1, 1)).toBe('2025-03-21');
    expect(j(1405, 7, 18)).toBe('2026-10-10');
    expect(CALENDARS.jalali.monthLength(1404, 12)).toBe(29);
    expect(CALENDARS.jalali.toYmd(fromLocalDate('2026-03-21'))).toEqual({ y: 1405, m: 1, d: 1 });
  });

  it('matches Date.UTC for Gregorian days and weekdays (property)', () => {
    fc.assert(
      fc.property(fc.integer({ min: -60_000, max: 60_000 }), (offset) => {
        const ms = Date.UTC(2000, 0, 1) + offset * 86_400_000;
        const iso = new Date(ms).toISOString().slice(0, 10);
        const jdn = fromLocalDate(iso);
        expect(toLocalDate(jdn)).toBe(iso);
        expect(weekdayOf(jdn)).toBe(new Date(ms).getUTCDay());
        const { y, m } = CALENDARS.gregorian.toYmd(jdn);
        expect(CALENDARS.gregorian.monthLength(y, m)).toBe(
          new Date(Date.UTC(y, m, 0)).getUTCDate(),
        );
      }),
    );
  });

  it('round-trips Jalali dates (property)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: fromLocalDate('1800-01-01'), max: fromLocalDate('2300-01-01') }),
        (jdn) => {
          const ymd = CALENDARS.jalali.toYmd(jdn);
          expect(CALENDARS.jalali.toJdn(ymd)).toBe(jdn);
          expect(ymd.d).toBeLessThanOrEqual(CALENDARS.jalali.monthLength(ymd.y, ymd.m));
        },
      ),
    );
  });

  it('rejects malformed LocalDates', () => {
    for (const bad of ['2026-02-29', '2026-13-01', '0000-01-01', '2026-1-1', 'today']) {
      expect(() => fromLocalDate(bad)).toThrow(RecurrenceError);
    }
  });
});

describe('fixed series', () => {
  it('repeats daily, every n days', () => {
    expect(all({ interval: 3 }, '2026-10-30', '2026-11-08')).toEqual([
      '2026-10-30',
      '2026-11-02',
      '2026-11-05',
      '2026-11-08',
    ]);
  });

  it('filters daily rules (weekdays only)', () => {
    expect(all({ byWeekday: [1, 2, 3, 4, 5] }, '2026-10-09', '2026-10-13')).toEqual([
      '2026-10-09',
      '2026-10-12',
      '2026-10-13',
    ]);
  });

  it('defaults a weekly rule to the start weekday', () => {
    expect(all({ freq: 'weekly' }, '2026-10-10', '2026-10-24')).toEqual([
      '2026-10-10',
      '2026-10-17',
      '2026-10-24',
    ]);
  });

  it('runs every other week from the start week, which depends on weekStart', () => {
    const biweekly = { freq: 'weekly', interval: 2, byWeekday: [0, 1] } as const;
    // Start Saturday 2026-10-10. With Monday weeks, its week is Oct 5–11; the next is Oct 19–25.
    expect(all(biweekly, '2026-10-10', '2026-10-27', MON)).toEqual([
      '2026-10-11',
      '2026-10-19',
      '2026-10-25',
    ]);
    // With Saturday weeks it is Oct 10–16: Sunday Oct 11 and Monday Oct 12, then Oct 25–26.
    expect(all(biweekly, '2026-10-10', '2026-10-27', SAT)).toEqual([
      '2026-10-11',
      '2026-10-12',
      '2026-10-25',
      '2026-10-26',
    ]);
  });

  it('clamps month days that a month lacks', () => {
    expect(all({ freq: 'monthly' }, '2026-01-31', '2026-04-30')).toEqual([
      '2026-01-31',
      '2026-02-28',
      '2026-03-31',
      '2026-04-30',
    ]);
    expect(all({ freq: 'monthly', byMonthDay: [-1] }, '2028-01-15', '2028-03-31')).toEqual([
      '2028-01-31',
      '2028-02-29',
      '2028-03-31',
    ]);
    expect(all({ freq: 'monthly', byMonthDay: [-31] }, '2026-02-01', '2026-02-28')).toEqual([
      '2026-02-01',
    ]);
  });

  it('finds the nth weekday of a month', () => {
    const secondTuesday = { freq: 'monthly', byWeekday: [2], bySetPos: [2] } as const;
    expect(all(secondTuesday, '2026-01-01', '2026-04-30')).toEqual([
      '2026-01-13',
      '2026-02-10',
      '2026-03-10',
      '2026-04-14',
    ]);
    const lastFriday = { freq: 'monthly', byWeekday: [5], bySetPos: [-1] } as const;
    expect(all(lastFriday, '2026-10-01', '2026-11-30')).toEqual(['2026-10-30', '2026-11-27']);
    // A 5th Monday only exists in some months.
    expect(
      all({ freq: 'monthly', byWeekday: [1], bySetPos: [5] }, '2026-01-01', '2026-06-30'),
    ).toEqual(['2026-03-30', '2026-06-29']);
  });

  it('combines month days and weekdays (Friday the 13th)', () => {
    expect(
      all({ freq: 'monthly', byMonthDay: [13], byWeekday: [5] }, '2026-01-01', '2026-12-31'),
    ).toEqual(['2026-02-13', '2026-03-13', '2026-11-13']);
  });

  it('skips months outside byMonth', () => {
    expect(all({ freq: 'monthly', byMonth: [1, 7] }, '2026-01-05', '2027-01-05')).toEqual([
      '2026-01-05',
      '2026-07-05',
      '2027-01-05',
    ]);
  });

  it('repeats yearly on the start day, clamping Feb 29', () => {
    expect(all({ freq: 'yearly' }, '2028-02-29', '2032-12-31')).toEqual([
      '2028-02-29',
      '2029-02-28',
      '2030-02-28',
      '2031-02-28',
      '2032-02-29',
    ]);
  });

  it('supports yearly month days without a month, and yearly weekdays with a position', () => {
    expect(all({ freq: 'yearly', byMonthDay: [1] }, '2026-10-01', '2027-01-01')).toEqual([
      '2026-10-01',
      '2026-11-01',
      '2026-12-01',
      '2027-01-01',
    ]);
    // The last Friday of the year.
    expect(
      all({ freq: 'yearly', byWeekday: [5], bySetPos: [-1] }, '2026-01-01', '2027-12-31'),
    ).toEqual(['2026-12-25', '2027-12-31']);
    // Thanksgiving: the 4th Thursday of November.
    expect(
      all(
        { freq: 'yearly', byMonth: [11], byWeekday: [4], bySetPos: [4] },
        '2026-01-01',
        '2027-12-31',
      ),
    ).toEqual(['2026-11-26', '2027-11-25']);
  });

  it('works in Jalali months', () => {
    const jalali = { calendar: 'jalali' } as const;
    // 31 Farvardin 1405 → clamped to 30 in Mehr and Esfand.
    const monthly = all({ ...jalali, freq: 'monthly' }, '2026-04-20', '2027-03-21');
    expect(monthly).toContain('2026-10-22'); // 30 Mehr 1405
    expect(monthly.at(-1)).toBe('2027-03-20'); // 30 Esfand 1405
    expect(monthly).toHaveLength(12);
    // Nowruz every year.
    expect(all({ ...jalali, freq: 'yearly' }, '2024-03-20', '2026-12-31')).toEqual([
      '2024-03-20',
      '2025-03-21',
      '2026-03-21',
    ]);
    // 30 Esfand 1403 (a leap year) → 29 Esfand in 1404.
    expect(all({ ...jalali, freq: 'yearly' }, '2025-03-20', '2026-12-31')).toEqual([
      '2025-03-20',
      '2026-03-20',
    ]);
  });

  it('respects count, until, the range and the limit', () => {
    expect(all({ count: 3 }, '2026-10-10', '2026-12-31')).toEqual([
      '2026-10-10',
      '2026-10-11',
      '2026-10-12',
    ]);
    expect(all({ until: '2026-10-11' }, '2026-10-10', '2026-12-31')).toEqual([
      '2026-10-10',
      '2026-10-11',
    ]);
    // `count` counts from the start, not from the range.
    expect(
      occurrences(rule({ count: 3 }), '2026-10-10', { from: '2026-10-11', to: '2026-12-31' }, MON),
    ).toEqual(['2026-10-11', '2026-10-12']);
    expect(
      occurrences(
        rule({}),
        '2026-10-10',
        { from: '2026-10-10', to: '2026-12-31' },
        { ...MON, limit: 2 },
      ),
    ).toHaveLength(2);
  });

  it('ends a series that can never occur', () => {
    expect(
      all({ freq: 'weekly', byWeekday: [1], bySetPos: [2] }, '2026-10-10', '9999-12-31'),
    ).toEqual([]);
  });

  it('ends at the edge of the calendar', () => {
    expect(all({ freq: 'yearly' }, '9998-06-01', '9999-12-31')).toEqual([
      '9998-06-01',
      '9999-06-01',
    ]);
    expect(all({ interval: 2 }, '9999-12-28', '9999-12-31')).toEqual(['9999-12-28', '9999-12-30']);
    expect(all({ freq: 'weekly', interval: 2 }, '9999-12-20', '9999-12-31')).toEqual([
      '9999-12-20',
    ]);
    expect(all({ freq: 'monthly', interval: 5 }, '9999-10-01', '9999-12-31')).toEqual([
      '9999-10-01',
    ]);
    const lastJalali = toLocalDate(CALENDARS.jalali.toJdn({ y: 3177, m: 1, d: 1 }));
    expect(all({ calendar: 'jalali', freq: 'yearly' }, lastJalali, '9999-12-31')).toEqual([
      lastJalali,
    ]);
    // The first week of 0001 starts before the first LocalDate.
    expect(all({ freq: 'weekly' }, '0001-01-01', '0001-01-08', { weekStart: 2 })).toEqual([
      '0001-01-01',
      '0001-01-08',
    ]);
  });

  it('returns only the current instance for afterCompletion rules', () => {
    const r = rule({ mode: 'afterCompletion' });
    expect(occurrences(r, '2026-10-10', { from: '2026-10-01', to: '2026-10-31' }, MON)).toEqual([
      '2026-10-10',
    ]);
    expect(occurrences(r, '2026-10-10', { from: '2026-10-11', to: '2026-10-31' }, MON)).toEqual([]);
    expect(occurrences(r, '2026-10-10', { from: '2026-10-01', to: '2026-10-09' }, MON)).toEqual([]);
    expect(
      occurrences(
        { ...r, until: '2026-10-09' },
        '2026-10-10',
        { from: '2026-10-01', to: '2026-10-31' },
        MON,
      ),
    ).toEqual([]);
  });

  it('rejects bad options and dates outside the calendar', () => {
    expect(() => all({}, '2026-10-10', '2026-10-11', { weekStart: 7 })).toThrow(RecurrenceError);
    expect(() => all({}, '2026-10-10', '2026-10-11', { weekStart: 1.5 })).toThrow(RecurrenceError);
    expect(() => all({ calendar: 'jalali' }, '0500-01-01', '0500-02-01')).toThrow(
      /outside the jalali/,
    );
    expect(() => all({ calendar: 'jalali' }, '3900-01-01', '3900-02-01')).toThrow(
      /outside the jalali/,
    );
  });
});

describe('nextInstance', () => {
  it('moves a fixed rule to the next occurrence after the due date and writes out its defaults', () => {
    const next = nextInstance(
      rule({ freq: 'monthly' }),
      { due: '2026-01-31', completedOn: '2026-03-05' },
      MON,
    );
    expect(next).toEqual({
      due: '2026-02-28',
      recurrence: rule({ freq: 'monthly', byMonthDay: [31] }),
    });
    // No drift to the 28th afterwards.
    const after = nextInstance(
      next?.recurrence ?? rule({}),
      { due: '2026-02-28', completedOn: '2026-02-28' },
      MON,
    );
    expect(after?.due).toBe('2026-03-31');
  });

  it('writes out yearly and weekly defaults too', () => {
    expect(
      nextInstance(rule({ freq: 'yearly' }), { due: '2028-02-29', completedOn: '2028-02-29' }, MON),
    ).toEqual({
      due: '2029-02-28',
      recurrence: rule({ freq: 'yearly', byMonth: [2], byMonthDay: [29] }),
    });
    expect(
      nextInstance(rule({ freq: 'weekly' }), { due: '2026-10-10', completedOn: '2026-10-10' }, MON)
        ?.recurrence.byWeekday,
    ).toEqual([6]);
  });

  it('counts down and stops at count and until', () => {
    const two = nextInstance(
      rule({ count: 3 }),
      { due: '2026-10-10', completedOn: '2026-10-10' },
      MON,
    );
    expect(two).toEqual({ due: '2026-10-11', recurrence: rule({ count: 2 }) });
    expect(
      nextInstance(rule({ count: 1 }), { due: '2026-10-10', completedOn: '2026-10-10' }, MON),
    ).toBeNull();
    expect(
      nextInstance(
        rule({ until: '2026-10-10' }),
        { due: '2026-10-10', completedOn: '2026-10-10' },
        MON,
      ),
    ).toBeNull();
  });

  it('schedules afterCompletion rules from the completion date', () => {
    const every3 = rule({ interval: 3, mode: 'afterCompletion' });
    expect(nextInstance(every3, { due: '2026-10-01', completedOn: '2026-10-10' }, MON)).toEqual({
      due: '2026-10-13',
      recurrence: every3,
    });
    // Two weeks after completion, then the next Monday.
    const biweeklyMonday = rule({
      freq: 'weekly',
      interval: 2,
      byWeekday: [1],
      mode: 'afterCompletion',
    });
    expect(
      nextInstance(biweeklyMonday, { due: '2026-10-05', completedOn: '2026-10-08' }, MON)?.due,
    ).toBe('2026-10-26');
    // A month after completion in the Jalali calendar, clamped: 31 Shahrivar → 30 Mehr.
    const jalaliMonth = rule({ calendar: 'jalali', freq: 'monthly', mode: 'afterCompletion' });
    expect(
      nextInstance(jalaliMonth, { due: '2026-09-22', completedOn: '2026-09-22' }, MON)?.due,
    ).toBe('2026-10-22');
    expect(
      nextInstance(
        rule({ freq: 'yearly', mode: 'afterCompletion' }),
        { due: '2026-01-01', completedOn: '2028-02-29' },
        MON,
      )?.due,
    ).toBe('2029-02-28');
  });

  it('ends afterCompletion series past the calendar or a never-matching filter', () => {
    const daily = rule({ mode: 'afterCompletion' });
    expect(nextInstance(daily, { due: '9999-12-31', completedOn: '9999-12-31' }, MON)).toBeNull();
    const lastYear = toLocalDate(CALENDARS.jalali.toJdn({ y: 3177, m: 6, d: 1 }));
    expect(
      nextInstance(
        { ...daily, calendar: 'jalali', freq: 'yearly' },
        { due: lastYear, completedOn: lastYear },
        MON,
      ),
    ).toBeNull();
    const never = rule({ freq: 'weekly', byWeekday: [1], bySetPos: [3], mode: 'afterCompletion' });
    expect(nextInstance(never, { due: '2026-10-10', completedOn: '2026-10-10' }, MON)).toBeNull();
  });

  it('returns null when a fixed series has no later occurrence', () => {
    expect(
      nextInstance(rule({ freq: 'yearly' }), { due: '9999-03-01', completedOn: '9999-03-01' }, MON),
    ).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Properties, checked against an independent oracle that walks every day.

const CAL: CalendarSystem[] = ['gregorian', 'jalali'];
const arbRule = fc
  .record(
    {
      calendar: fc.constantFrom(...CAL),
      freq: fc.constantFrom('daily', 'weekly', 'monthly', 'yearly'),
      interval: fc.integer({ min: 1, max: 3 }),
      byWeekday: fc.uniqueArray(fc.integer({ min: 0, max: 6 }), { minLength: 1, maxLength: 3 }),
      byMonthDay: fc.uniqueArray(
        fc.integer({ min: -31, max: 31 }).filter((d) => d !== 0),
        { minLength: 1, maxLength: 3 },
      ),
      byMonth: fc.uniqueArray(fc.integer({ min: 1, max: 12 }), { minLength: 1, maxLength: 4 }),
      bySetPos: fc.uniqueArray(
        fc.integer({ min: -3, max: 3 }).filter((d) => d !== 0),
        { minLength: 1, maxLength: 2 },
      ),
      count: fc.integer({ min: 1, max: 20 }),
      mode: fc.constant('fixed'),
    },
    { requiredKeys: ['calendar', 'freq', 'interval', 'mode'] },
  )
  .filter((r) => recurrenceSchema.safeParse(r).success) as fc.Arbitrary<Recurrence>;
const arbStart = fc
  .integer({ min: fromLocalDate('2020-01-01'), max: fromLocalDate('2030-12-31') })
  .map(toLocalDate);
const arbWeekStart = fc.integer({ min: 0, max: 6 });

/** Day-by-day reference implementation of the same semantics, for checking the engine. */
function oracle(r: Recurrence, start: string, to: string, weekStart: number): string[] {
  const cal = CALENDARS[r.calendar];
  const s = fromLocalDate(start);
  const sy = cal.toYmd(s);
  const byWeekday = r.byWeekday ?? (r.freq === 'weekly' ? [weekdayOf(s)] : undefined);
  const defaultDay = (r.freq === 'monthly' || r.freq === 'yearly') && !r.byMonthDay && !r.byWeekday;
  const byMonthDay = r.byMonthDay ?? (defaultDay ? [sy.d] : undefined);
  const byMonth = r.byMonth ?? (r.freq === 'yearly' && defaultDay ? [sy.m] : undefined);
  const weekOf = (jdn: number) =>
    Math.floor((jdn - ((weekdayOf(jdn) - weekStart + 7) % 7) - s) / 7);
  const periodOf = (jdn: number) => {
    const { y, m } = cal.toYmd(jdn);
    switch (r.freq) {
      case 'daily':
        return jdn - s;
      case 'weekly':
        return weekOf(jdn) - weekOf(s);
      case 'monthly':
        return (y - sy.y) * 12 + (m - sy.m);
      case 'yearly':
        return y - sy.y;
    }
  };
  const groups = new Map<number, number[]>();
  // Walk from the start of the start's period so bySetPos sees whole periods.
  for (let jdn = s - 400; jdn <= fromLocalDate(to); jdn++) {
    const p = periodOf(jdn);
    if (p < 0 || p % r.interval !== 0) continue;
    const { y, m, d } = cal.toYmd(jdn);
    const len = cal.monthLength(y, m);
    if (byMonth && !byMonth.includes(m)) continue;
    if (byWeekday && !byWeekday.includes(weekdayOf(jdn))) continue;
    if (
      byMonthDay &&
      !byMonthDay.some((md) => (md > 0 ? Math.min(md, len) : Math.max(1, len + 1 + md)) === d)
    )
      continue;
    groups.set(p, [...(groups.get(p) ?? []), jdn]);
  }
  const out: number[] = [];
  for (const days of groups.values()) {
    const picked = r.bySetPos
      ? [
          ...new Set(
            r.bySetPos
              .map((pos) => days[pos > 0 ? pos - 1 : days.length + pos])
              .filter((d) => d !== undefined),
          ),
        ]
      : days;
    out.push(...picked.filter((d) => d >= s));
  }
  return out
    .sort((a, b) => a - b)
    .slice(0, r.count ?? Infinity)
    .map(toLocalDate);
}

describe('properties', () => {
  it('occurrences match a day-by-day oracle', () => {
    fc.assert(
      fc.property(arbRule, arbStart, arbWeekStart, (r, start, weekStart) => {
        const to = toLocalDate(fromLocalDate(start) + 800);
        // The oracle's last period may be cut off by its window, so compare
        // up to a date whose period (a year at most) lies wholly inside it.
        const cutoff = toLocalDate(fromLocalDate(to) - 400);
        const got = occurrences(r, start, { from: start, to }, { weekStart, limit: 10_000 });
        const want = oracle(r, start, to, weekStart);
        expect(got.filter((d) => d <= cutoff)).toEqual(want.filter((d) => d <= cutoff));
      }),
      { numRuns: 400 },
    );
  });

  it('chaining nextInstance walks the same series as occurrences', () => {
    fc.assert(
      fc.property(arbRule, arbStart, arbWeekStart, (r, start, weekStart) => {
        const to = toLocalDate(fromLocalDate(start) + 1500);
        const series = occurrences(r, start, { from: start, to }, { weekStart, limit: 30 });
        fc.pre(series.length > 0);
        // Chain from the first occurrence; `count` there means what is left.
        let current: { due: string; recurrence: Recurrence } | null = {
          due: series[0] as string,
          recurrence: r,
        };
        const chain: string[] = [];
        while (current && chain.length < series.length) {
          chain.push(current.due);
          current = nextInstance(
            current.recurrence,
            { due: current.due, completedOn: current.due },
            { weekStart },
          );
        }
        expect(chain).toEqual(series);
      }),
      { numRuns: 300 },
    );
  });

  it('afterCompletion: the next date is at least one interval after completion and matches the rule', () => {
    fc.assert(
      fc.property(
        arbRule,
        arbStart,
        fc.integer({ min: 0, max: 60 }),
        arbWeekStart,
        (r, due, late, weekStart) => {
          const after = { ...r, mode: 'afterCompletion' as const };
          const completedOn = toLocalDate(fromLocalDate(due) + late);
          const next = nextInstance(after, { due, completedOn }, { weekStart });
          if (after.count === 1) {
            expect(next).toBeNull();
            return;
          }
          fc.pre(next !== null);
          const minDays =
            { daily: 1, weekly: 7, monthly: 28, yearly: 365 }[after.freq] * after.interval;
          expect(fromLocalDate(next.due) - fromLocalDate(completedOn)).toBeGreaterThanOrEqual(
            Math.min(minDays, 28 * after.interval),
          );
          expect(next.recurrence).toEqual(
            after.count === undefined ? after : { ...after, count: after.count - 1 },
          );
        },
      ),
      { numRuns: 300 },
    );
  });
});
