// i18next setup. Catalogs are plain TS objects; `fa` must have every key `en`
// has (checked by test/catalog.test.ts). Untranslated keys are listed in
// TODO-fa.md.

import i18next from 'i18next';
import type { i18n as I18n } from 'i18next';
import { en } from './locales/en';
import { fa } from './locales/fa';
import type { Language } from './format';

export const resources = { en: { translation: en }, fa: { translation: fa } } as const;

export async function createI18n(lng: Language): Promise<I18n> {
  const inst = i18next.createInstance();
  await inst.init({
    lng,
    fallbackLng: 'en',
    resources,
    interpolation: { escapeValue: false },
    returnNull: false,
  });
  return inst;
}

export type { I18n };
