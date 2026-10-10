// Calendar-aware recurrence engine (DATA-MODEL.md §2, ADR-008).
//
// Supports a subset of RFC 5545 RRULE: FREQ, INTERVAL, BYDAY (plain weekdays),
// BYMONTHDAY (negative = from the end), BYMONTH, BYSETPOS, UNTIL, COUNT — with
// months and years counted in either the Gregorian or the Jalali calendar, so
// "the 15th of every Jalali month" works. Like RFC 5545, invalid dates (e.g. the
// 31st of a 30-day month) are skipped rather than clamped.

import type { Recurrence } from '../entities/common';
import {
  addMonths,
  dateToJdn,
  daysInMonth,
  fromJdn,
  jdnToDate,
  toJdn,
  weekdayOfJdn,
} from '../time/calendar';
import type { LocalDate } from '../time/calendar';

export interface RecurrenceOptions {
  /** First day of the week for weekly intervals > 1. Default Monday (1). */
  weekStart?: number;
}

/** Periods scanned without any candidate before we give up (guards impossible rules). */
const MAX_EMPTY_PERIODS = 2000;

/**
 * Iterate occurrences (as JDNs) in ascending order, starting at `dtstart`.
 * The callback returns false to stop.
 */
function iterate(
  rule: Recurrence,
  dtstart: LocalDate,
  opts: RecurrenceOptions,
  cb: (jdn: number) => boolean,
): void {
  const cal = rule.calendar;
  const startJdn = dateToJdn(dtstart);
  const start = fromJdn(cal, startJdn);
  const untilJdn = rule.until ? dateToJdn(rule.until) : Infinity;
  const interval = Math.max(1, rule.interval);
  const byMonth = rule.byMonth && rule.byMonth.length ? new Set(rule.byMonth) : null;
  const byWeekday = rule.byWeekday && rule.byWeekday.length ? new Set(rule.byWeekday) : null;
  const byMonthDay = rule.byMonthDay && rule.byMonthDay.length ? rule.byMonthDay : null;
  let emitted = 0;
  let empty = 0;

  const monthDays = (y: number, m: number): number[] => {
    const len = daysInMonth(cal, y, m);
    let days: number[];
    if (byMonthDay) {
      days = byMonthDay.map((d) => (d > 0 ? d : len + d + 1)).filter((d) => d >= 1 && d <= len);
      days = [...new Set(days)].sort((a, b) => a - b);
    } else if (byWeekday) {
      days = Array.from({ length: len }, (_, i) => i + 1);
    } else {
      days = start.d <= len ? [start.d] : [];
    }
    let jdns = days.map((d) => toJdn(cal, { y, m, d }));
    if (byWeekday) jdns = jdns.filter((j) => byWeekday.has(weekdayOfJdn(j)));
    return jdns;
  };

  const applySetPos = (c: number[]): number[] => {
    if (!rule.bySetPos || !rule.bySetPos.length) return c;
    const out = new Set<number>();
    for (const p of rule.bySetPos) {
      const v = p > 0 ? c[p - 1] : c[c.length + p];
      if (v !== undefined) out.add(v);
    }
    return [...out].sort((a, b) => a - b);
  };

  const inMonthFilter = (j: number): boolean => !byMonth || byMonth.has(fromJdn(cal, j).m);

  for (let p = 0; ; p++) {
    let cands: number[];
    switch (rule.freq) {
      case 'daily': {
        const j = startJdn + p * interval;
        cands = [j].filter(
          (x) =>
            inMonthFilter(x) &&
            (!byWeekday || byWeekday.has(weekdayOfJdn(x))) &&
            (!byMonthDay || matchesMonthDay(cal, x, byMonthDay)),
        );
        break;
      }
      case 'weekly': {
        const ws = opts.weekStart ?? 1;
        const weekStartJdn = startJdn - ((weekdayOfJdn(startJdn) - ws + 7) % 7);
        const w0 = weekStartJdn + p * 7 * interval;
        const wds = byWeekday ?? new Set([weekdayOfJdn(startJdn)]);
        cands = [];
        for (let i = 0; i < 7; i++) {
          const j = w0 + i;
          if (wds.has(weekdayOfJdn(j)) && inMonthFilter(j)) cands.push(j);
        }
        cands = applySetPos(cands);
        break;
      }
      case 'monthly': {
        const total = start.y * 12 + (start.m - 1) + p * interval;
        const y = Math.floor(total / 12);
        const m = total - y * 12 + 1;
        cands = byMonth && !byMonth.has(m) ? [] : applySetPos(monthDays(y, m));
        break;
      }
      case 'yearly': {
        const y = start.y + p * interval;
        const months = byMonth
          ? [...byMonth].sort((a, b) => a - b)
          : byWeekday || byMonthDay
            ? Array.from({ length: 12 }, (_, i) => i + 1)
            : [start.m];
        cands = applySetPos(months.flatMap((m) => monthDays(y, m)));
        break;
      }
    }
    if (cands.length === 0) {
      if (++empty > MAX_EMPTY_PERIODS) return;
      continue;
    }
    empty = 0;
    for (const j of cands) {
      if (j < startJdn) continue;
      if (j > untilJdn) return;
      if (rule.count !== undefined && emitted >= rule.count) return;
      emitted++;
      if (!cb(j)) return;
    }
  }
}

function matchesMonthDay(cal: Recurrence['calendar'], jdn: number, byMonthDay: number[]): boolean {
  const { y, m, d } = fromJdn(cal, jdn);
  const len = daysInMonth(cal, y, m);
  return byMonthDay.some((md) => (md > 0 ? md === d : len + md + 1 === d));
}

/** Occurrences within [from, to] (inclusive), at most `limit`. */
export function occurrencesBetween(
  rule: Recurrence,
  dtstart: LocalDate,
  from: LocalDate,
  to: LocalDate,
  opts: RecurrenceOptions & { limit?: number } = {},
): LocalDate[] {
  const fromJ = dateToJdn(from);
  const toJ = dateToJdn(to);
  const limit = opts.limit ?? 1000;
  const out: LocalDate[] = [];
  iterate(rule, dtstart, opts, (j) => {
    if (j > toJ) return false;
    if (j >= fromJ) out.push(jdnToDate(j));
    return out.length < limit;
  });
  return out;
}

/** The first occurrence strictly after `after`, or null if the rule has ended. */
export function nextOccurrence(
  rule: Recurrence,
  dtstart: LocalDate,
  after: LocalDate,
  opts: RecurrenceOptions = {},
): LocalDate | null {
  const afterJ = dateToJdn(after);
  let found: number | null = null;
  iterate(rule, dtstart, opts, (j) => {
    if (j > afterJ) {
      found = j;
      return false;
    }
    return true;
  });
  return found === null ? null : jdnToDate(found);
}

/** `afterCompletion` mode: "every N <units> after I finish it". */
export function nextAfterCompletion(rule: Recurrence, completedOn: LocalDate): LocalDate | null {
  const n = Math.max(1, rule.interval);
  let next: LocalDate;
  switch (rule.freq) {
    case 'daily':
      next = jdnToDate(dateToJdn(completedOn) + n);
      break;
    case 'weekly':
      next = jdnToDate(dateToJdn(completedOn) + 7 * n);
      break;
    case 'monthly':
      next = addMonths(rule.calendar, completedOn, n);
      break;
    case 'yearly':
      next = addMonths(rule.calendar, completedOn, 12 * n);
      break;
  }
  if (rule.until && next > rule.until) return null;
  return next;
}

/**
 * The next due date for a recurring item that was due on `currentDue` and
 * completed on `completedOn`, plus the rule to carry forward (COUNT is
 * decremented so the new instance doesn't need history). Null = series ended.
 */
export function advanceRecurrence(
  rule: Recurrence,
  currentDue: LocalDate,
  completedOn: LocalDate,
  opts: RecurrenceOptions = {},
): { due: LocalDate; rule: Recurrence } | null {
  if (rule.count !== undefined && rule.count <= 1) return null;
  const nextRule: Recurrence = rule.count !== undefined ? { ...rule, count: rule.count - 1 } : rule;
  const { count: _count, ...uncounted } = rule;
  const due =
    rule.mode === 'afterCompletion'
      ? nextAfterCompletion(rule, completedOn)
      : nextOccurrence(uncounted, currentDue, currentDue, opts);
  if (due === null) return null;
  return { due, rule: nextRule };
}
