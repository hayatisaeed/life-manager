import type { LocaleSettings } from './locale';
import { intlLocale } from './locale';

// User-facing formatting (DESIGN.md §8). Calendar logic lives in core's
// recurrence engine; this only displays values, through Intl, whose
// `persian` calendar is the Jalali calendar.

export type DateStyle = 'full' | 'long' | 'medium' | 'short';

const LOCAL_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Formats a `LocalDate` (`YYYY-MM-DD`, Gregorian). It's placed at noon UTC
 * and formatted in UTC, so the device's time zone can't shift the day.
 */
export function formatLocalDate(
  date: string,
  locale: LocaleSettings,
  style: DateStyle = 'long',
): string {
  const m = LOCAL_DATE.exec(date);
  if (!m) throw new RangeError(`Not a LocalDate: ${date}`);
  const at = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12);
  const tag = intlLocale(locale);
  if (style === 'full' && locale.language === 'fa') {
    // CLDR's full Persian pattern is "y MMMM d, EEEE" (year first, Latin
    // comma). Persian is written weekday first: "شنبه ۱۸ مهر ۱۴۰۵".
    const weekday = new Intl.DateTimeFormat(tag, { weekday: 'long', timeZone: 'UTC' }).format(at);
    const date = new Intl.DateTimeFormat(tag, { dateStyle: 'long', timeZone: 'UTC' }).format(at);
    return `${weekday} ${date}`;
  }
  return new Intl.DateTimeFormat(tag, { dateStyle: style, timeZone: 'UTC' }).format(at);
}

/** Today's `LocalDate` in a time zone, from an injected clock (ms). */
export function todayIn(nowMs: number, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-u-ca-gregory-nu-latn', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(nowMs);
  let year = '';
  let month = '';
  let day = '';
  for (const part of parts) {
    if (part.type === 'year') year = part.value;
    else if (part.type === 'month') month = part.value;
    else if (part.type === 'day') day = part.value;
  }
  return `${year}-${month}-${day}`;
}

export function formatNumber(
  value: number,
  locale: LocaleSettings,
  options: Intl.NumberFormatOptions = {},
): string {
  return new Intl.NumberFormat(intlLocale(locale), options).format(value);
}

/**
 * Formats money stored as integer minor units (DATA-MODEL.md §1). The number
 * of minor digits comes from the currency (IRR has 0, USD 2, KWD 3).
 */
export function formatMoney(amountMinor: number, currency: string, locale: LocaleSettings): string {
  if (!Number.isSafeInteger(amountMinor))
    throw new RangeError('Money amounts are integer minor units');
  const fmt = new Intl.NumberFormat(intlLocale(locale), { style: 'currency', currency });
  // How many minor digits the currency has: the fraction part of 1 (none for IRR).
  const digits = fmt.formatToParts(1).find((p) => p.type === 'fraction')?.value.length ?? 0;
  // Divide as a decimal string, not a float, so large amounts stay exact.
  const negative = amountMinor < 0;
  const raw = String(Math.abs(amountMinor)).padStart(digits + 1, '0');
  const whole = digits === 0 ? raw : `${raw.slice(0, -digits)}.${raw.slice(-digits)}`;
  return fmt.format(`${negative ? '-' : ''}${whole}` as unknown as number);
}
