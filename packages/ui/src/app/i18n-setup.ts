import type { I18n, Language } from '@lm/i18n';
import { createI18n } from '@lm/i18n';
import { FEATURE_CATALOGS } from '../features/i18n';

export async function setupI18n(lang: Language): Promise<I18n> {
  const i = await createI18n(lang);
  for (const c of FEATURE_CATALOGS) {
    i.addResourceBundle('en', 'translation', c.en, true, true);
    i.addResourceBundle('fa', 'translation', c.fa, true, true);
  }
  return i;
}
