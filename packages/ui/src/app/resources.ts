import type { Resource } from 'i18next';
import { settingsEn, settingsFa } from '../features/settings/i18n';
import { todayEn, todayFa } from '../features/today/i18n';
import { appEn, appFa } from './i18n';

/** Every catalog, merged. Feature keys live under their feature's name. */
export const resources: Resource = {
  en: { translation: { ...appEn, today: todayEn, settings: settingsEn } },
  fa: { translation: { ...appFa, today: todayFa, settings: settingsFa } },
};
