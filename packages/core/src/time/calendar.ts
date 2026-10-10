// Calendar arithmetic on day numbers (Julian Day Numbers). Pure integer math so
// `core` never needs `Date` for calendar logic (AGENTS.md §5 "Dates").
//
// The Jalali conversion follows the jalaali-js algorithm (Borkowski's
// breaks table), which is exact for Jalali years -61…3177.

export type CalendarSystem = 'gregorian' | 'jalali';

/** `YYYY-MM-DD` in the proleptic Gregorian calendar (DATA-MODEL.md §1). */
export type LocalDate = string;
/** `HH:mm` */
export type LocalTime = string;
/** ISO-8601 UTC timestamp. */
export type Instant = string;

export interface YMD {
  y: number;
  m: number; // 1-12
  d: number; // 1-31
}

const div = (a: number, b: number): number => Math.trunc(a / b);
const mod = (a: number, b: number): number => a - Math.trunc(a / b) * b;

// --- Gregorian <-> JDN -------------------------------------------------------

export function gregorianToJdn(y: number, m: number, d: number): number {
  let r =
    div((y + div(m - 8, 6) + 100100) * 1461, 4) + div(153 * mod(m + 9, 12) + 2, 5) + d - 34840408;
  r = r - div(div(y + 100100 + div(m - 8, 6), 100) * 3, 4) + 752;
  return r;
}

export function jdnToGregorian(jdn: number): YMD {
  let j = 4 * jdn + 139361631;
  j = j + div(div(4 * jdn + 183187720, 146097) * 3, 4) * 4 - 3908;
  const i = div(mod(j, 1461), 4) * 5 + 308;
  const d = div(mod(i, 153), 5) + 1;
  const m = mod(div(i, 153), 12) + 1;
  const y = div(j, 1461) - 100100 + div(8 - m, 6);
  return { y, m, d };
}

// --- Jalali <-> JDN ----------------------------------------------------------

const BREAKS = [
  -61, 9, 38, 199, 426, 686, 756, 818, 1111, 1181, 1210, 1635, 2060, 2097, 2192, 2262, 2324, 2394,
  2456, 3178,
];

interface JalCal {
  leap: number;
  gy: number;
  march: number;
}

function jalCal(jy: number): JalCal {
  const bl = BREAKS.length;
  const gy = jy + 621;
  let leapJ = -14;
  let jp = BREAKS[0] as number;
  let jump = 0;
  if (jy < jp || jy >= (BREAKS[bl - 1] as number)) {
    throw new RangeError(`Jalali year out of range: ${jy}`);
  }
  for (let i = 1; i < bl; i += 1) {
    const jm = BREAKS[i] as number;
    jump = jm - jp;
    if (jy < jm) break;
    leapJ = leapJ + div(jump, 33) * 8 + div(mod(jump, 33), 4);
    jp = jm;
  }
  let n = jy - jp;
  leapJ = leapJ + div(n, 33) * 8 + div(mod(n, 33) + 3, 4);
  if (mod(jump, 33) === 4 && jump - n === 4) leapJ += 1;
  const leapG = div(gy, 4) - div((div(gy, 100) + 1) * 3, 4) - 150;
  const march = 20 + leapJ - leapG;
  if (jump - n < 6) n = n - jump + div(jump + 4, 33) * 33;
  let leap = mod(mod(n + 1, 33) - 1, 4);
  if (leap === -1) leap = 4;
  return { leap, gy, march };
}

export function jalaliToJdn(jy: number, jm: number, jd: number): number {
  const r = jalCal(jy);
  return gregorianToJdn(r.gy, 3, r.march) + (jm - 1) * 31 - div(jm, 7) * (jm - 7) + jd - 1;
}

export function jdnToJalali(jdn: number): YMD {
  const gy = jdnToGregorian(jdn).y;
  let jy = gy - 621;
  const r = jalCal(jy);
  const jdn1f = gregorianToJdn(gy, 3, r.march);
  let k = jdn - jdn1f;
  if (k >= 0) {
    if (k <= 185) return { y: jy, m: 1 + div(k, 31), d: mod(k, 31) + 1 };
    k -= 186;
  } else {
    jy -= 1;
    k += 179;
    if (r.leap === 1) k += 1;
  }
  return { y: jy, m: 7 + div(k, 30), d: mod(k, 30) + 1 };
}

export function isJalaliLeap(jy: number): boolean {
  return jalCal(jy).leap === 0;
}

export function isGregorianLeap(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

export function daysInMonth(cal: CalendarSystem, y: number, m: number): number {
  if (cal === 'jalali') {
    if (m <= 6) return 31;
    if (m <= 11) return 30;
    return isJalaliLeap(y) ? 30 : 29;
  }
  if (m === 2) return isGregorianLeap(y) ? 29 : 28;
  return [4, 6, 9, 11].includes(m) ? 30 : 31;
}

export function toJdn(cal: CalendarSystem, ymd: YMD): number {
  return cal === 'jalali' ? jalaliToJdn(ymd.y, ymd.m, ymd.d) : gregorianToJdn(ymd.y, ymd.m, ymd.d);
}

export function fromJdn(cal: CalendarSystem, jdn: number): YMD {
  return cal === 'jalali' ? jdnToJalali(jdn) : jdnToGregorian(jdn);
}

// --- LocalDate helpers -------------------------------------------------------

const LOCAL_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function parseLocalDate(s: LocalDate): YMD {
  const m = LOCAL_DATE_RE.exec(s);
  if (!m) throw new RangeError(`Invalid LocalDate: ${s}`);
  return { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) };
}

const pad = (n: number, w = 2): string => String(n).padStart(w, '0');

export function formatLocalDate({ y, m, d }: YMD): LocalDate {
  return `${pad(y, 4)}-${pad(m)}-${pad(d)}`;
}

export function dateToJdn(s: LocalDate): number {
  const { y, m, d } = parseLocalDate(s);
  return gregorianToJdn(y, m, d);
}

export function jdnToDate(jdn: number): LocalDate {
  return formatLocalDate(jdnToGregorian(jdn));
}

export function addDays(s: LocalDate, n: number): LocalDate {
  return jdnToDate(dateToJdn(s) + n);
}

export function diffDays(a: LocalDate, b: LocalDate): number {
  return dateToJdn(a) - dateToJdn(b);
}

/** 0 = Sunday … 6 = Saturday (DATA-MODEL.md §2). */
export function weekdayOfJdn(jdn: number): number {
  return (((jdn + 1) % 7) + 7) % 7;
}

export function weekday(s: LocalDate): number {
  return weekdayOfJdn(dateToJdn(s));
}

/** The first day of the week containing `s`, for a week starting on `weekStart`. */
export function startOfWeek(s: LocalDate, weekStart: number): LocalDate {
  const wd = weekday(s);
  return addDays(s, -((wd - weekStart + 7) % 7));
}

/** Year/month/day of a Gregorian LocalDate in the given calendar system. */
export function toCalendar(cal: CalendarSystem, s: LocalDate): YMD {
  return fromJdn(cal, dateToJdn(s));
}

export function fromCalendar(cal: CalendarSystem, ymd: YMD): LocalDate {
  return jdnToDate(toJdn(cal, ymd));
}

/** Adds months in the given calendar, clamping the day to the target month's length. */
export function addMonths(cal: CalendarSystem, s: LocalDate, n: number): LocalDate {
  const { y, m, d } = toCalendar(cal, s);
  const total = y * 12 + (m - 1) + n;
  const ny = Math.floor(total / 12);
  const nm = total - ny * 12 + 1;
  return fromCalendar(cal, { y: ny, m: nm, d: Math.min(d, daysInMonth(cal, ny, nm)) });
}

/** `YYYY-MM` month key in the given calendar system (Budget.month, DATA-MODEL.md §8). */
export function monthKey(cal: CalendarSystem, s: LocalDate): string {
  const { y, m } = toCalendar(cal, s);
  return `${pad(y, 4)}-${pad(m)}`;
}

/** Inclusive Gregorian date range covered by a calendar month key. */
export function monthRange(cal: CalendarSystem, key: string): { start: LocalDate; end: LocalDate } {
  const [ys, ms] = key.split('-');
  const y = Number(ys);
  const m = Number(ms);
  return {
    start: fromCalendar(cal, { y, m, d: 1 }),
    end: fromCalendar(cal, { y, m, d: daysInMonth(cal, y, m) }),
  };
}

export function isLocalDate(s: string): boolean {
  if (!LOCAL_DATE_RE.test(s)) return false;
  const { y, m, d } = parseLocalDate(s);
  return m >= 1 && m <= 12 && d >= 1 && d <= daysInMonth('gregorian', y, m);
}

// --- Instants ---------------------------------------------------------------

export function instantFromMs(ms: number): Instant {
  return new Date(ms).toISOString();
}

export function msFromInstant(i: Instant): number {
  return Date.parse(i);
}

/** The UTC LocalDate of an epoch-ms value. UI code converts with a time zone instead. */
export function utcDateOfMs(ms: number): LocalDate {
  return jdnToDate(Math.floor(ms / 86_400_000) + 2440588);
}

/** Epoch ms of midnight UTC at the start of a LocalDate. */
export function msOfUtcDate(s: LocalDate): number {
  return (dateToJdn(s) - 2440588) * 86_400_000;
}
