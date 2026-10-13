import {
  CalendarDate,
  GregorianCalendar,
  PersianCalendar,
  parseDate,
  toCalendar,
  getDayOfWeek,
} from '@internationalized/date';
import { recurrenceSchema, localDateSchema } from './entities/shared';
import type { Recurrence } from './entities/shared';
const gregorian = new GregorianCalendar();
const persian = new PersianCalendar();
const weekday = (date: CalendarDate) => getDayOfWeek(date, 'en-US');
const local = (date: CalendarDate) => toCalendar(date, gregorian).toString();
function datesInPeriod(
  rule: Recurrence,
  period: CalendarDate,
  anchor: CalendarDate,
): CalendarDate[] {
  const end =
    rule.freq === 'daily'
      ? period.add({ days: 1 })
      : rule.freq === 'weekly'
        ? period.add({ days: 7 })
        : rule.freq === 'monthly'
          ? period.add({ months: 1 })
          : period.add({ years: 1 });
  let candidates: CalendarDate[] = [];
  for (let day = period; day.compare(end) < 0; day = day.add({ days: 1 })) {
    if (rule.byMonth && !rule.byMonth.includes(day.month)) continue;
    if (rule.byWeekday && !rule.byWeekday.includes(weekday(day))) continue;
    const length = day.calendar.getDaysInMonth(day);
    if (rule.byMonthDay && !rule.byMonthDay.some((n) => day.day === (n > 0 ? n : length + n + 1)))
      continue;
    // RFC-style defaults apply only when a selector does not replace them.
    if (rule.freq === 'weekly' && !rule.byWeekday && weekday(day) !== weekday(anchor)) continue;
    if (
      (rule.freq === 'monthly' || rule.freq === 'yearly') &&
      !rule.byMonthDay &&
      !rule.byWeekday &&
      day.day !== anchor.day
    )
      continue;
    if (
      rule.freq === 'yearly' &&
      !rule.byMonth &&
      !rule.byMonthDay &&
      !rule.byWeekday &&
      day.month !== anchor.month
    )
      continue;
    candidates.push(day);
  }
  if (rule.bySetPos) {
    const selected = new Set(rule.bySetPos.map((n) => (n > 0 ? n - 1 : candidates.length + n)));
    candidates = candidates.filter((_, index) => selected.has(index));
  }
  return candidates;
}
/** DATA-MODEL.md §2. Dates are Gregorian at the boundary; arithmetic uses the rule calendar. */
export function* occurrences(
  ruleInput: Recurrence,
  start: string,
  options: { completedAt?: string; completedCount?: number; maxPeriods?: number } = {},
): Generator<string> {
  const rule = recurrenceSchema.parse(ruleInput);
  localDateSchema.parse(start);
  if (rule.mode === 'afterCompletion' && !options.completedAt)
    throw new Error('Completion date required');
  if (options.completedAt) localDateSchema.parse(options.completedAt);
  const completedCount = options.completedCount ?? 0;
  if (!Number.isInteger(completedCount) || completedCount < 0)
    throw new Error('Invalid completion count');
  const maxPeriods = options.maxPeriods ?? 10000;
  if (!Number.isInteger(maxPeriods) || maxPeriods < 1)
    throw new Error('Invalid recurrence search limit');
  const anchor = toCalendar(
    parseDate(rule.mode === 'afterCompletion' ? (options.completedAt ?? start) : start),
    rule.calendar === 'jalali' ? persian : gregorian,
  );
  const first = rule.mode === 'afterCompletion' ? advance(rule, anchor) : anchor;
  let period = first;
  if (rule.freq === 'weekly') period = first.subtract({ days: weekday(first) });
  if (rule.freq === 'monthly')
    period = new CalendarDate(first.calendar, first.year, first.month, 1);
  if (rule.freq === 'yearly') period = new CalendarDate(first.calendar, first.year, 1, 1);
  let count = completedCount;
  for (let searched = 0; searched < maxPeriods; searched += 1) {
    if (rule.count !== undefined && count >= rule.count) return;
    if (rule.until && local(period) > rule.until) return;
    for (const day of datesInPeriod(
      rule,
      period,
      rule.mode === 'afterCompletion' ? first : anchor,
    )) {
      if (day.compare(first) < 0) continue;
      const value = local(day);
      if (rule.until && value > rule.until) return;
      if (rule.count !== undefined && count >= rule.count) return;
      count += 1;
      yield value;
    }
    const next = advance(rule, period);
    if (next.compare(period) <= 0) throw new Error('Recurrence exceeded supported date range');
    period = next;
  }
  throw new Error('Recurrence search limit exceeded');
}
function advance(rule: Recurrence, date: CalendarDate): CalendarDate {
  switch (rule.freq) {
    case 'daily':
      return date.add({ days: rule.interval });
    case 'weekly':
      return date.add({ days: rule.interval * 7 });
    case 'monthly':
      return date.add({ months: rule.interval });
    case 'yearly':
      return date.add({ years: rule.interval });
  }
}
export function nextOccurrence(
  rule: Recurrence,
  start: string,
  after: string,
  options: { completedAt?: string; completedCount?: number } = {},
): string | null {
  localDateSchema.parse(after);
  for (const date of occurrences(rule, start, options)) if (date > after) return date;
  return null;
}
