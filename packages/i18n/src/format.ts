// Calendar-system-aware formatting (ARCHITECTURE.md §13, ADR-008). All
// user-facing dates, numbers, money and durations go through these.
//
// We use the platform's Intl (ICU), which supports the Persian (Jalali)
// calendar and Persian digits natively; calendar *math* lives in @lm/core.

import type { CalendarSystem, LocalDate, LocalTime, Money } from '@lm/core';
import { fromCalendar, msOfUtcDate } from '@lm/core';

export type Language = 'en' | 'fa';

export interface LocaleSettings {
  language: Language;
  calendar: CalendarSystem;
  digits: 'latin' | 'persian';
  timeZone: string;
  weekStart: number;
  tomanDisplay?: boolean;
}

export const DEFAULT_LOCALE: LocaleSettings = {
  language: 'en',
  calendar: 'gregorian',
  digits: 'latin',
  timeZone: 'UTC',
  weekStart: 1,
  tomanDisplay: false,
};

/** BCP-47 tag with explicit calendar and numbering system (fa-IR would otherwise default to Persian). */
export function localeTag(s: Pick<LocaleSettings, 'language' | 'calendar' | 'digits'>): string {
  const base = s.language === 'fa' ? 'fa-IR' : 'en-GB';
  const ca = s.calendar === 'jalali' ? 'persian' : 'gregory';
  const nu = s.digits === 'persian' ? 'arabext' : 'latn';
  return `${base}-u-ca-${ca}-nu-${nu}`;
}

export const isRtl = (lang: Language): boolean => lang === 'fa';

const cache = new Map<string, Intl.DateTimeFormat>();
function dtf(tag: string, opts: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const k = `${tag}|${JSON.stringify(opts)}`;
  let f = cache.get(k);
  if (!f) {
    f = new Intl.DateTimeFormat(tag, opts);
    cache.set(k, f);
  }
  return f;
}

export type DateStyle = 'full' | 'long' | 'medium' | 'short' | 'monthDay' | 'weekday' | 'weekdayShort' | 'monthYear' | 'day' | 'month';

const DATE_STYLES: Record<DateStyle, Intl.DateTimeFormatOptions> = {
  full: { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' },
  long: { year: 'numeric', month: 'long', day: 'numeric' },
  medium: { year: 'numeric', month: 'short', day: 'numeric' },
  short: { year: '2-digit', month: '2-digit', day: '2-digit' },
  monthDay: { month: 'short', day: 'numeric' },
  weekday: { weekday: 'long' },
  weekdayShort: { weekday: 'short' },
  monthYear: { year: 'numeric', month: 'long' },
  day: { day: 'numeric' },
  month: { month: 'long' },
};

/** Format a LocalDate (no time zone involved: it's a calendar day). */
export function formatDate(d: LocalDate, s: LocaleSettings, style: DateStyle = 'medium'): string {
  // Noon UTC formatted in UTC: the calendar day never shifts.
  const ms = msOfUtcDate(d) + 12 * 3_600_000;
  return dtf(localeTag(s), { ...DATE_STYLES[style], timeZone: 'UTC' }).format(ms).replace(/\s?AP$/, '');
}

export function formatTime(ms: number, s: LocaleSettings): string {
  return dtf(localeTag(s), { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: s.timeZone }).format(ms);
}

export function formatLocalTime(t: LocalTime, s: LocaleSettings): string {
  const [h, m] = t.split(':').map(Number);
  return dtf(localeTag(s), { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'UTC' }).format(
    Date.UTC(2000, 0, 1, h ?? 0, m ?? 0),
  );
}

export function formatDateTime(ms: number, s: LocaleSettings): string {
  return dtf(localeTag(s), {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone: s.timeZone,
  }).format(ms);
}

export function formatNumber(n: number, s: LocaleSettings, opts: Intl.NumberFormatOptions = {}): string {
  return new Intl.NumberFormat(localeTag(s), opts).format(n);
}

export function formatPercent(fraction: number, s: LocaleSettings): string {
  return formatNumber(fraction, s, { style: 'percent', maximumFractionDigits: 0 });
}

/** Minor-unit exponent of a currency (EUR 2, JPY 0, IRR 0…). */
export function currencyDigits(currency: string): number {
  try {
    return new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits ?? 2;
  } catch {
    return 2;
  }
}

/** Money is integer minor units (AGENTS.md §5); IRR can display as Toman (÷10). */
export function formatMoney(m: Money, s: LocaleSettings, opts: { signDisplay?: 'auto' | 'always' | 'exceptZero' } = {}): string {
  const digits = currencyDigits(m.currency);
  const major = m.amount / 10 ** digits;
  if (m.currency === 'IRR' && s.tomanDisplay) {
    const n = formatNumber(major / 10, s, { maximumFractionDigits: 0, signDisplay: opts.signDisplay ?? 'auto' });
    return s.language === 'fa' ? `${n} تومان` : `${n} Toman`;
  }
  return new Intl.NumberFormat(localeTag(s), {
    style: 'currency',
    currency: m.currency,
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
    signDisplay: opts.signDisplay ?? 'auto',
  }).format(major);
}

const PERSIAN_DIGITS = '۰۱۲۳۴۵۶۷۸۹';
const ARABIC_DIGITS = '٠١٢٣٤٥٦٧٨٩';

/** Normalise Persian/Arabic digits and separators typed by the user to ASCII. */
export function normalizeDigits(text: string): string {
  return text
    .replace(/[۰-۹]/g, (c) => String(PERSIAN_DIGITS.indexOf(c)))
    .replace(/[٠-٩]/g, (c) => String(ARABIC_DIGITS.indexOf(c)))
    .replace(/[٬،]/g, ',')
    .replace(/٫/g, '.');
}

export function toPersianDigits(text: string): string {
  return text.replace(/\d/g, (c) => PERSIAN_DIGITS[Number(c)] ?? c);
}

export function localizeDigits(text: string, s: Pick<LocaleSettings, 'digits'>): string {
  return s.digits === 'persian' ? toPersianDigits(text) : text;
}

/**
 * Parse a user-typed amount into integer minor units without floating-point
 * error ("12.5" EUR → 1250). Returns null when the text isn't a number.
 */
export function parseMoney(text: string, currency: string, opts: { toman?: boolean } = {}): number | null {
  const t = normalizeDigits(text).replace(/[\s,_']/g, '');
  const m = /^([+-]?)(\d*)(?:\.(\d*))?$/.exec(t);
  if (!m || (!m[2] && !m[3])) return null;
  const digits = currencyDigits(currency);
  const frac = (m[3] ?? '').padEnd(digits, '0');
  if (frac.length > digits && /[1-9]/.test(frac.slice(digits))) return null;
  let minor = Number(m[2] || '0') * 10 ** digits + Number(frac.slice(0, digits) || '0');
  if (currency === 'IRR' && opts.toman) minor *= 10;
  return m[1] === '-' ? -minor : minor;
}

export function formatDuration(minutes: number, s: LocaleSettings): string {
  const h = Math.floor(Math.abs(minutes) / 60);
  const m = Math.round(Math.abs(minutes) % 60);
  const n = (x: number) => formatNumber(x, s);
  const hs = s.language === 'fa' ? 'س' : 'h';
  const ms = s.language === 'fa' ? 'د' : 'm';
  const sign = minutes < 0 ? '-' : '';
  if (h && m) return `${sign}${n(h)}${hs} ${n(m)}${ms}`;
  if (h) return `${sign}${n(h)}${hs}`;
  return `${sign}${n(m)}${ms}`;
}

/** Localised weekday names starting from `weekStart` (0 = Sunday). */
export function weekdayNames(s: LocaleSettings, style: 'short' | 'long' | 'narrow' = 'short'): { day: number; name: string }[] {
  const f = dtf(localeTag(s), { weekday: style, timeZone: 'UTC' });
  return Array.from({ length: 7 }, (_, i) => {
    const day = (s.weekStart + i) % 7;
    // 2023-01-01 was a Sunday.
    return { day, name: f.format(Date.UTC(2023, 0, 1 + day, 12)) };
  });
}

export function monthName(month: number, year: number, s: LocaleSettings): string {
  return formatDate(fromCalendar(s.calendar, { y: year, m: month, d: 1 }), s, 'month');
}
