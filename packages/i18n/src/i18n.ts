import i18next, { type i18n, type Resource } from 'i18next';
import type { Language } from './locale';

/**
 * Creates the app's i18next instance. Catalogs live with their feature
 * (AGENTS.md §5) and are merged by the UI; every key exists in both `en` and
 * `fa` (TypeScript checks this where catalogs are declared).
 */
export async function createI18n(language: Language, resources: Resource): Promise<i18n> {
  const instance = i18next.createInstance();
  await instance.init({
    lng: language,
    fallbackLng: 'en',
    resources,
    // React already escapes; double escaping would show entities.
    interpolation: { escapeValue: false },
    returnNull: false,
  });
  return instance;
}

/** A catalog: nested string keys, the same shape in every language. */
export interface Catalog {
  [key: string]: string | Catalog;
}
