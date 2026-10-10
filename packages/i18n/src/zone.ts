// Time-zone conversions between Instants and wall-clock dates/times, using
// Intl so we don't ship a tz database.

import type { LocalDate, LocalTime } from '@lm/core';
import { formatLocalDate, msOfUtcDate } from '@lm/core';

const fmtCache = new Map<string, Intl.DateTimeFormat>();
function parts(tz: string): Intl.DateTimeFormat {
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    fmtCache.set(tz, f);
  }
  return f;
}

export interface ZonedParts {
  date: LocalDate;
  time: LocalTime;
  /** Minutes since local midnight. */
  minutes: number;
}

export function zoned(ms: number, tz: string): ZonedParts {
  const p: Record<string, number> = {};
  for (const x of parts(tz).formatToParts(ms)) if (x.type !== 'literal') p[x.type] = Number(x.value);
  const h = (p['hour'] ?? 0) % 24;
  const mi = p['minute'] ?? 0;
  return {
    date: formatLocalDate({ y: p['year'] ?? 1970, m: p['month'] ?? 1, d: p['day'] ?? 1 }),
    time: `${String(h).padStart(2, '0')}:${String(mi).padStart(2, '0')}`,
    minutes: h * 60 + mi,
  };
}

/** Offset of `tz` from UTC at `ms`, in minutes. */
export function tzOffsetMinutes(ms: number, tz: string): number {
  const z = zoned(ms, tz);
  const asUtc = msOfUtcDate(z.date) + z.minutes * 60_000;
  return Math.round((asUtc - Math.floor(ms / 60_000) * 60_000) / 60_000);
}

/** The instant of a wall-clock date+time in `tz` (DST gaps resolve forward). */
export function toInstantMs(date: LocalDate, time: LocalTime, tz: string): number {
  const [h, m] = time.split(':').map(Number);
  const guess = msOfUtcDate(date) + ((h ?? 0) * 60 + (m ?? 0)) * 60_000;
  let ms = guess - tzOffsetMinutes(guess, tz) * 60_000;
  // Second pass handles offset changes between the guess and the result.
  ms = guess - tzOffsetMinutes(ms, tz) * 60_000;
  return ms;
}

export function todayIn(tz: string, nowMs: number): LocalDate {
  return zoned(nowMs, tz).date;
}

export function startOfDayMs(date: LocalDate, tz: string): number {
  return toInstantMs(date, '00:00', tz);
}

export function systemTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}
