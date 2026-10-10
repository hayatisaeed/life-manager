import {
  d2g,
  d2j,
  g2d,
  j2d,
  jalaaliMonthLength,
  MAX_JALAALI_YEAR,
  MIN_JALAALI_YEAR,
} from 'jalaali-js';

// Calendar arithmetic on Julian Day Numbers (JDN): one integer per day, the
// same in every calendar system. Nothing here reads the clock or a time zone
// (AGENTS.md §4.9, §5 "Dates").

export type CalendarSystem = 'gregorian' | 'jalali';

/** A day in some calendar: year, month 1–12, day 1–31. */
export interface Ymd {
  readonly y: number;
  readonly m: number;
  readonly d: number;
}

export class RecurrenceError extends Error {
  override name = 'RecurrenceError';
}

const isGregorianLeap = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
const GREGORIAN_MONTH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

export interface CalendarOps {
  toYmd(jdn: number): Ymd;
  /** `d` must exist in that month. */
  toJdn(ymd: Ymd): number;
  monthLength(y: number, m: number): number;
  /** Years this calendar can convert; a series stops at the edge. */
  readonly minYear: number;
  readonly maxYear: number;
}

export const CALENDARS: Record<CalendarSystem, CalendarOps> = {
  gregorian: {
    toYmd: (jdn) => {
      const { gy, gm, gd } = d2g(jdn);
      return { y: gy, m: gm, d: gd };
    },
    toJdn: ({ y, m, d }) => g2d(y, m, d),
    monthLength: (y, m) =>
      m === 2 && isGregorianLeap(y) ? 29 : (GREGORIAN_MONTH_DAYS[m - 1] as number),
    // LocalDate's range.
    minYear: 1,
    maxYear: 9999,
  },
  jalali: {
    toYmd: (jdn) => {
      const { jy, jm, jd } = d2j(jdn);
      return { y: jy, m: jm, d: jd };
    },
    toJdn: ({ y, m, d }) => j2d(y, m, d),
    monthLength: (y, m) => jalaaliMonthLength(y, m),
    // The range jalaali-js is exact for (Gregorian 560–3798).
    minYear: MIN_JALAALI_YEAR,
    maxYear: MAX_JALAALI_YEAR,
  },
};

const LOCAL_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Parses a `LocalDate` (DATA-MODEL.md §1) into a JDN. Throws on anything else. */
export function fromLocalDate(value: string): number {
  const match = LOCAL_DATE.exec(value);
  const [y, m, d] = (match ?? []).slice(1).map(Number) as [number?, number?, number?];
  if (
    y === undefined ||
    m === undefined ||
    d === undefined ||
    y < 1 ||
    m < 1 ||
    m > 12 ||
    d < 1 ||
    d > CALENDARS.gregorian.monthLength(y, m)
  ) {
    throw new RecurrenceError(`Not a LocalDate: ${value}`);
  }
  return g2d(y, m, d);
}

/** Formats a JDN as a `LocalDate`. Only valid for days in 0001–9999. */
export function toLocalDate(jdn: number): string {
  const { y, m, d } = CALENDARS.gregorian.toYmd(jdn);
  const pad = (n: number, w: number) => String(n).padStart(w, '0');
  return `${pad(y, 4)}-${pad(m, 2)}-${pad(d, 2)}`;
}

/** 0 = Sunday … 6 = Saturday. JDN 0 was a Monday; every LocalDate has a positive JDN. */
export const weekdayOf = (jdn: number) => (jdn + 1) % 7;
