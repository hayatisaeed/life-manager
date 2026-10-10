import { describe, expect, it } from 'vitest';
import {
  createI18n,
  directionOf,
  formatLocalDate,
  formatMoney,
  formatNumber,
  intlLocale,
  isLanguage,
  preferredLanguage,
  todayIn,
  type LocaleSettings,
} from './index';

const en: LocaleSettings = { language: 'en', calendar: 'gregorian', digits: 'latin' };
const faJalali: LocaleSettings = { language: 'fa', calendar: 'jalali', digits: 'native' };

describe('locale', () => {
  it('builds Intl tags from three independent settings', () => {
    expect(intlLocale(en)).toBe('en-u-ca-gregory-nu-latn');
    expect(intlLocale(faJalali)).toBe('fa-u-ca-persian-nu-arabext');
    expect(intlLocale({ language: 'en', calendar: 'jalali', digits: 'native' })).toBe(
      'en-u-ca-persian-nu-latn',
    );
    expect(intlLocale({ language: 'fa', calendar: 'gregorian', digits: 'latin' })).toBe(
      'fa-u-ca-gregory-nu-latn',
    );
  });

  it('knows directions and picks a starting language', () => {
    expect(directionOf('fa')).toBe('rtl');
    expect(directionOf('en')).toBe('ltr');
    expect(preferredLanguage(['de-DE', 'fa-IR', 'en'])).toBe('fa');
    expect(preferredLanguage(['de'])).toBe('en');
    expect(isLanguage('fa')).toBe(true);
    expect(isLanguage('de')).toBe(false);
  });
});

describe('formatting', () => {
  it('formats a LocalDate in either calendar, with either digits', () => {
    expect(formatLocalDate('2026-03-21', en)).toBe('March 21, 2026');
    // 2026-03-21 is 1 Farvardin 1405 (Nowruz).
    expect(formatLocalDate('2026-03-21', faJalali)).toBe('۱ فروردین ۱۴۰۵');
    expect(formatLocalDate('2026-03-21', { ...faJalali, digits: 'latin' })).toContain('1405');
    expect(
      formatLocalDate('2026-03-21', { language: 'en', calendar: 'jalali', digits: 'latin' }),
    ).toContain('Farvardin');
    expect(formatLocalDate('2026-10-10', en, 'short')).toBe('10/10/26');
    expect(formatLocalDate('2026-10-10', faJalali, 'full')).toBe('شنبه ۱۸ مهر ۱۴۰۵');
    expect(formatLocalDate('2026-10-10', en, 'full')).toBe('Saturday, October 10, 2026');
    expect(() => formatLocalDate('10/10/2026', en)).toThrow(/LocalDate/);
  });

  it("finds today's date in a time zone from an injected clock", () => {
    const at = Date.UTC(2026, 9, 9, 22, 30); // 22:30 UTC on Oct 9
    expect(todayIn(at, 'UTC')).toBe('2026-10-09');
    expect(todayIn(at, 'Asia/Tehran')).toBe('2026-10-10');
    expect(todayIn(at, 'America/Los_Angeles')).toBe('2026-10-09');
  });

  it('formats numbers and integer minor-unit money exactly', () => {
    expect(formatNumber(1234.5, en)).toBe('1,234.5');
    expect(formatNumber(1234, faJalali)).toBe('۱٬۲۳۴');
    expect(formatMoney(123456, 'USD', en)).toBe('$1,234.56');
    expect(formatMoney(-5, 'USD', en)).toBe('-$0.05');
    expect(formatMoney(1500000, 'IRR', en)).toBe('IRR\u00a01,500,000');
    expect(formatMoney(1234, 'KWD', en)).toBe('KWD\u00a01.234');
    expect(formatMoney(9007199254740991, 'USD', en)).toBe('$90,071,992,547,409.91');
    expect(() => formatMoney(1.5, 'USD', en)).toThrow(/integer minor units/);
  });
});

describe('i18next', () => {
  it('translates, interpolates without escaping, and falls back to English', async () => {
    const i18n = await createI18n('fa', {
      en: { translation: { hello: 'Hello {{name}}', only: 'English only' } },
      fa: { translation: { hello: 'سلام {{name}}' } },
    });
    expect(i18n.t('hello', { name: '<b>' })).toBe('سلام <b>');
    expect(i18n.t('only')).toBe('English only');
  });
});
