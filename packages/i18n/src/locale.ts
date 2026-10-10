/** Same values as core's `CalendarSystem`; i18n sits beside core, not above it. */
export type CalendarSystem = 'gregorian' | 'jalali';

// Language, calendar system and digits are independent settings (ADR-008):
// a Persian speaker may use the Gregorian calendar, an English speaker Jalali.

export type Language = 'en' | 'fa';
export type Digits = 'latin' | 'native';

export interface LocaleSettings {
  language: Language;
  calendar: CalendarSystem;
  digits: Digits;
}

export const LANGUAGES: readonly Language[] = ['en', 'fa'];

export function isLanguage(value: string): value is Language {
  return (LANGUAGES as readonly string[]).includes(value);
}

export function directionOf(language: Language): 'ltr' | 'rtl' {
  return language === 'fa' ? 'rtl' : 'ltr';
}

/**
 * A BCP 47 tag for `Intl` that carries all three settings, e.g.
 * `fa-u-ca-persian-nu-arabext` or `en-u-ca-persian-nu-latn`.
 * Persian "native" digits are Extended Arabic-Indic (۰۱۲۳). English has no
 * other native digits, so it always uses Latin ones.
 */
export function intlLocale({ language, calendar, digits }: LocaleSettings): string {
  const ca = calendar === 'jalali' ? 'persian' : 'gregory';
  const nu = digits === 'native' && language === 'fa' ? 'arabext' : 'latn';
  return `${language}-u-ca-${ca}-nu-${nu}`;
}

/** The language to start with before settings exist, from the browser's preferences. */
export function preferredLanguage(languages: readonly string[]): Language {
  for (const tag of languages) {
    const base = tag.toLowerCase().split('-', 1).join('');
    if (isLanguage(base)) return base;
  }
  return 'en';
}
