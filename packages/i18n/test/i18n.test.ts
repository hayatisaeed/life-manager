import { describe, expect, it } from 'vitest';
import {
  createI18n,
  en,
  fa,
  formatDate,
  formatDuration,
  formatMoney,
  formatNumber,
  formatLocalTime,
  formatTime,
  localeTag,
  monthName,
  normalizeDigits,
  parseMoney,
  toInstantMs,
  todayIn,
  tzOffsetMinutes,
  weekdayNames,
  zoned,
  isValidTimeZone,
  DEFAULT_LOCALE,
} from '../src';
import type { LocaleSettings } from '../src';

const EN: LocaleSettings = { ...DEFAULT_LOCALE };
const FA: LocaleSettings = { language: 'fa', calendar: 'jalali', digits: 'persian', timeZone: 'Asia/Tehran', weekStart: 6 };

function keys(o: object, prefix = ''): string[] {
  return Object.entries(o).flatMap(([k, v]) => (v && typeof v === 'object' ? keys(v, `${prefix}${k}.`) : [`${prefix}${k}`]));
}

describe('catalogs', () => {
  it('fa has exactly the keys en has', () => {
    expect(keys(fa).sort()).toEqual(keys(en).sort());
  });
  it('i18next resolves both languages', async () => {
    const i = await createI18n('fa');
    expect(i.t('nav.today')).toBe('امروز');
    await i.changeLanguage('en');
    expect(i.t('common.minutes', { count: 5 })).toBe('5 min');
  });
});

describe('dates', () => {
  it('formats in Gregorian and Jalali with explicit calendars', () => {
    expect(localeTag(FA)).toBe('fa-IR-u-ca-persian-nu-arabext');
    expect(formatDate('2026-10-10', EN, 'long')).toBe('10 October 2026');
    expect(formatDate('2026-10-10', { ...EN, calendar: 'jalali' }, 'long')).toBe('18 Mehr 1405');
    expect(formatDate('2026-10-10', FA, 'monthYear')).toContain('مهر');
    expect(formatDate('2026-10-10', FA, 'day')).toBe('۱۸');
    // fa + Gregorian must not silently switch to the Persian calendar.
    expect(formatDate('2026-10-10', { ...FA, calendar: 'gregorian', digits: 'latin' }, 'day')).toBe('10');
    expect(monthName(7, 1405, FA)).toBe('مهر');
  });
  it('weekday names start at weekStart', () => {
    const w = weekdayNames(EN, 'long');
    expect(w[0]).toEqual({ day: 1, name: 'Monday' });
    expect(weekdayNames(FA)[0]?.day).toBe(6);
  });
  it('times and durations', () => {
    const ms = Date.UTC(2026, 9, 10, 12, 30);
    expect(formatTime(ms, EN)).toBe('12:30');
    expect(formatTime(ms, { ...EN, timeZone: 'Asia/Tehran' })).toBe('16:00');
    expect(formatLocalTime('07:05', EN)).toBe('07:05');
    expect(formatDuration(95, EN)).toBe('1h 35m');
    expect(formatDuration(60, EN)).toBe('1h');
    expect(formatDuration(-5, EN)).toBe('-5m');
    expect(formatDuration(30, FA)).toBe('۳۰د');
  });
});

describe('numbers and money', () => {
  it('formats minor units per currency', () => {
    expect(formatMoney({ amount: 123456, currency: 'EUR' }, EN)).toBe('€1,234.56');
    expect(formatMoney({ amount: -500, currency: 'USD' }, EN)).toBe('-US$5.00');
    expect(formatMoney({ amount: 1500, currency: 'JPY' }, EN)).toBe('JP¥1,500');
    expect(formatMoney({ amount: 1_250_000, currency: 'IRR' }, { ...FA, tomanDisplay: true })).toBe('۱۲۵٬۰۰۰ تومان');
    expect(formatMoney({ amount: 1_250_000, currency: 'IRR' }, { ...EN, tomanDisplay: true })).toBe('125,000 Toman');
    expect(formatNumber(1234, FA)).toBe('۱٬۲۳۴');
  });
  it('parses user input to minor units without float error', () => {
    expect(parseMoney('12.5', 'EUR')).toBe(1250);
    expect(parseMoney('0.1', 'EUR')).toBe(10);
    expect(parseMoney('1,234.56', 'USD')).toBe(123456);
    expect(parseMoney('-3', 'USD')).toBe(-300);
    expect(parseMoney('۱۲۳٬۴۵۶', 'IRR')).toBe(123456);
    expect(parseMoney('100', 'IRR', { toman: true })).toBe(1000);
    expect(parseMoney('1.234', 'EUR')).toBeNull();
    expect(parseMoney('1.230', 'EUR')).toBe(123);
    expect(parseMoney('abc', 'EUR')).toBeNull();
    expect(parseMoney('', 'EUR')).toBeNull();
    expect(normalizeDigits('۱۲٫۵')).toBe('12.5');
  });
});

describe('time zones', () => {
  it('converts between instants and wall clock', () => {
    const ms = Date.UTC(2026, 9, 10, 22, 30);
    expect(zoned(ms, 'Asia/Tehran')).toEqual({ date: '2026-10-11', time: '02:00', minutes: 120 });
    expect(tzOffsetMinutes(ms, 'Asia/Tehran')).toBe(210);
    expect(toInstantMs('2026-10-11', '02:00', 'Asia/Tehran')).toBe(ms);
    expect(todayIn('America/New_York', ms)).toBe('2026-10-10');
    // DST: 2026-03-08 02:30 doesn't exist in New York; resolves to a real instant.
    const gap = toInstantMs('2026-03-08', '02:30', 'America/New_York');
    expect(zoned(gap, 'America/New_York').date).toBe('2026-03-08');
    expect(toInstantMs('2026-07-01', '09:00', 'Europe/Berlin')).toBe(Date.UTC(2026, 6, 1, 7));
    expect(isValidTimeZone('Mars/Base')).toBe(false);
    expect(isValidTimeZone('UTC')).toBe(true);
  });
});
