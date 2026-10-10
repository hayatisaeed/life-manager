import type { z } from 'zod';
import type { recurrence } from '../entities/primitives';
import {
  CALENDARS,
  fromLocalDate,
  RecurrenceError,
  toLocalDate,
  weekdayOf,
  type CalendarOps,
} from './calendar';

// The recurrence engine (DATA-MODEL.md §2, ADR-015). Rules are a subset of RFC
// 5545 evaluated in the rule's own calendar: "monthly" means Jalali months
// for a Jalali rule. Everything works on Julian Day Numbers, so results don't
// depend on the device's time zone.
//
// One deliberate difference from RFC 5545: a month day that doesn't exist in
// a month is clamped to its last day instead of skipped. "Monthly on the
// 31st" falls on Feb 28/29, and "on 31 Shahrivar" on 30 Mehr, which is what
// people mean. Negative days count from the end (-1 is the last day).

export type Recurrence = z.output<typeof recurrence>;

export interface RecurrenceOptions {
  /** First day of the week, 0 = Sunday (the `weekStart` setting). Only weekly rules with an interval above 1 depend on it. */
  readonly weekStart: number;
}

/**
 * A series with no occurrence for this many periods in a row is treated as
 * ended (about 11, 19, 83 and 400 years). Clamping keeps real gaps far
 * shorter: even "Friday the 13th" recurs within 14 months. Only a rule that
 * can never match (such as a 2nd position in a one-day set) gets here.
 */
const MAX_EMPTY_PERIODS: Record<Recurrence['freq'], number> = {
  daily: 4000,
  weekly: 1000,
  monthly: 1000,
  yearly: 400,
};

interface Bounds {
  readonly first: number;
  readonly last: number;
}

// The days both a LocalDate and the calendar can represent.
const BOUNDS: Record<Recurrence['calendar'], Bounds> = {
  gregorian: { first: fromLocalDate('0001-01-01'), last: fromLocalDate('9999-12-31') },
  jalali: (() => {
    const cal = CALENDARS.jalali;
    return {
      first: cal.toJdn({ y: cal.minYear, m: 1, d: 1 }),
      last: cal.toJdn({ y: cal.maxYear, m: 12, d: cal.monthLength(cal.maxYear, 12) }),
    };
  })(),
};

const resolveMonthDay = (day: number, length: number) =>
  day > 0 ? Math.min(day, length) : Math.max(1, length + 1 + day);

/**
 * Fills in what RFC 5545 takes from the start date: a weekly rule repeats on
 * the start's weekday, a monthly one on its day, a yearly one on its month and day.
 */
function normalize(rule: Recurrence, start: number, cal: CalendarOps): Recurrence {
  const { m, d } = cal.toYmd(start);
  const r = { ...rule };
  if (r.freq === 'weekly' && !r.byWeekday) r.byWeekday = [weekdayOf(start)];
  if (r.freq === 'monthly' && !r.byMonthDay && !r.byWeekday) r.byMonthDay = [d];
  if (r.freq === 'yearly' && !r.byMonthDay && !r.byWeekday) {
    r.byMonth ??= [m];
    r.byMonthDay = [d];
  }
  return r;
}

/** The days of month (y, m) that match the rule's month, day and weekday filters, ascending. */
function monthDays(rule: Recurrence, cal: CalendarOps, y: number, m: number): number[] {
  if (rule.byMonth && !rule.byMonth.includes(m)) return [];
  const length = cal.monthLength(y, m);
  const days = rule.byMonthDay
    ? [...new Set(rule.byMonthDay.map((day) => resolveMonthDay(day, length)))].sort((a, b) => a - b)
    : Array.from({ length }, (_, i) => i + 1);
  const first = cal.toJdn({ y, m, d: 1 });
  return days
    .map((day) => first + day - 1)
    .filter((jdn) => !rule.byWeekday || rule.byWeekday.includes(weekdayOf(jdn)));
}

/** Whether a single day matches the rule's filters (daily and weekly rules). */
function matchesDay(rule: Recurrence, cal: CalendarOps, jdn: number): boolean {
  if (rule.byWeekday && !rule.byWeekday.includes(weekdayOf(jdn))) return false;
  const { y, m, d } = cal.toYmd(jdn);
  if (rule.byMonth && !rule.byMonth.includes(m)) return false;
  if (!rule.byMonthDay) return true;
  const length = cal.monthLength(y, m);
  return rule.byMonthDay.some((day) => resolveMonthDay(day, length) === d);
}

function applySetPos(days: number[], setPos: readonly number[] | undefined): number[] {
  if (!setPos) return days;
  const picked = setPos
    .map((pos) => days[pos > 0 ? pos - 1 : days.length + pos])
    .filter((d): d is number => d !== undefined);
  return [...new Set(picked)].sort((a, b) => a - b);
}

const addMonths = (y: number, m: number, n: number) => {
  const index = y * 12 + (m - 1) + n;
  return { y: Math.floor(index / 12), m: (index % 12) + 1 };
};

/**
 * The candidate days of the k-th period of the series, or null past the end
 * of the calendar. Periods are a day, a week, a month or a year.
 */
function period(
  rule: Recurrence,
  start: number,
  k: number,
  options: RecurrenceOptions,
): number[] | null {
  const cal = CALENDARS[rule.calendar];
  const bounds = BOUNDS[rule.calendar];
  const step = k * rule.interval;
  switch (rule.freq) {
    case 'daily': {
      const day = start + step;
      if (day > bounds.last) return null;
      return matchesDay(rule, cal, day) ? [day] : [];
    }
    case 'weekly': {
      const weekStart = start - ((weekdayOf(start) - options.weekStart + 7) % 7) + 7 * step;
      if (weekStart > bounds.last) return null;
      return Array.from({ length: 7 }, (_, i) => weekStart + i).filter(
        (day) => day >= bounds.first && day <= bounds.last && matchesDay(rule, cal, day),
      );
    }
    case 'monthly': {
      const s = cal.toYmd(start);
      const { y, m } = addMonths(s.y, s.m, step);
      if (y > cal.maxYear) return null;
      return monthDays(rule, cal, y, m);
    }
    case 'yearly': {
      const y = cal.toYmd(start).y + step;
      if (y > cal.maxYear) return null;
      return Array.from({ length: 12 }, (_, i) => monthDays(rule, cal, y, i + 1)).flat();
    }
  }
}

/** Every occurrence on or after `start`, ascending. Ignores `count` and `until`. */
function* series(rule: Recurrence, start: number, options: RecurrenceOptions): Generator<number> {
  const normalized = normalize(rule, start, CALENDARS[rule.calendar]);
  let empty = 0;
  for (let k = 0; ; k++) {
    const days = period(normalized, start, k, options);
    if (days === null) return;
    const picked = applySetPos(days, normalized.bySetPos).filter((d) => d >= start);
    if (picked.length === 0) {
      if (++empty >= MAX_EMPTY_PERIODS[rule.freq]) return;
      continue;
    }
    empty = 0;
    yield* picked;
  }
}

/** Parses a LocalDate and checks the rule's calendar can handle it. */
function dayIn(rule: Recurrence, value: string): number {
  const day = fromLocalDate(value);
  const { first, last } = BOUNDS[rule.calendar];
  if (day < first || day > last) {
    throw new RecurrenceError(
      `${value} is outside the ${rule.calendar} calendar's supported range`,
    );
  }
  return day;
}

function checkOptions(options: RecurrenceOptions): void {
  if (!Number.isInteger(options.weekStart) || options.weekStart < 0 || options.weekStart > 6) {
    throw new RecurrenceError('weekStart must be 0–6');
  }
}

/**
 * The dates of a series that starts on `start`, within `from`…`to`
 * (inclusive), at most `limit` of them. `count` counts from `start`.
 *
 * `afterCompletion` rules have no fixed future: their next date depends on
 * when the current one is done. For them only `start` itself is returned.
 */
export function occurrences(
  rule: Recurrence,
  start: string,
  range: { readonly from: string; readonly to: string },
  options: RecurrenceOptions & { readonly limit?: number },
): string[] {
  checkOptions(options);
  const first = dayIn(rule, start);
  const from = fromLocalDate(range.from);
  const to = fromLocalDate(range.to);
  const until = rule.until === undefined ? Infinity : fromLocalDate(rule.until);
  const limit = options.limit ?? 1000;
  if (rule.mode === 'afterCompletion') {
    return first >= from && first <= to && first <= until ? [start] : [];
  }
  const out: string[] = [];
  let n = 0;
  for (const day of series(rule, first, options)) {
    n++;
    if (
      day > to ||
      day > until ||
      (rule.count !== undefined && n > rule.count) ||
      out.length >= limit
    )
      break;
    if (day >= from) out.push(toLocalDate(day));
  }
  return out;
}

/** `completedOn` plus `interval` days, weeks, months or years, clamping the day of month. */
function addInterval(rule: Recurrence, day: number): number | null {
  const cal = CALENDARS[rule.calendar];
  const n = rule.interval;
  let next: number;
  if (rule.freq === 'daily' || rule.freq === 'weekly') {
    next = day + (rule.freq === 'daily' ? n : 7 * n);
  } else {
    const s = cal.toYmd(day);
    const { y, m } = rule.freq === 'monthly' ? addMonths(s.y, s.m, n) : { y: s.y + n, m: s.m };
    if (y > cal.maxYear) return null;
    next = cal.toJdn({ y, m, d: Math.min(s.d, cal.monthLength(y, m)) });
  }
  return next > BOUNDS[rule.calendar].last ? null : next;
}

export interface NextInstance {
  /** The next instance's due date. */
  readonly due: string;
  /**
   * The rule to store on the next instance (DATA-MODEL.md §4, "Completing a
   * recurring task"). `count` is what remains, including that instance. A
   * `fixed` rule also gets the defaults it took from the first start date
   * written out, so a "31st of the month" rule doesn't drift to the 28th
   * after February.
   */
  readonly recurrence: Recurrence;
}

/**
 * The instance that follows one due on `due` and completed on `completedOn`,
 * or null when the series has ended.
 *
 * - `fixed`: the first occurrence after `due`, wherever the completion fell.
 *   Missed occurrences aren't skipped.
 * - `afterCompletion`: `completedOn` plus the interval, then the first day
 *   from there that matches the rule's filters (e.g. its weekday).
 */
export function nextInstance(
  rule: Recurrence,
  current: { readonly due: string; readonly completedOn: string },
  options: RecurrenceOptions,
): NextInstance | null {
  checkOptions(options);
  const due = dayIn(rule, current.due);
  const completedOn = dayIn(rule, current.completedOn);
  if (rule.count !== undefined && rule.count <= 1) return null;

  let next: number | undefined;
  let stored: Recurrence = rule;
  if (rule.mode === 'fixed') {
    stored = normalize(rule, due, CALENDARS[rule.calendar]);
    for (const day of series(stored, due, options)) {
      if (day > due) {
        next = day;
        break;
      }
    }
  } else {
    const base = addInterval(rule, completedOn);
    if (base !== null) {
      const first = series({ ...rule, interval: 1 }, base, options).next();
      if (!first.done) next = first.value;
    }
  }
  if (next === undefined || (rule.until !== undefined && next > fromLocalDate(rule.until)))
    return null;
  return {
    due: toLocalDate(next),
    recurrence: rule.count === undefined ? stored : { ...stored, count: rule.count - 1 },
  };
}
