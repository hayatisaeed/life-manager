import { directionOf } from '@lm/i18n';
import type { RouterHistory } from '@tanstack/react-router';
import { RouterProvider } from '@tanstack/react-router';
import type { i18n as I18n } from 'i18next';
import { useEffect, useMemo, useState } from 'react';
import { I18nextProvider } from 'react-i18next';
import type { SyncStatus } from '../layout/SyncPill';
import { useApplyTheme } from '../theme/theme';
import { AppContext, type AppEnv } from './context';
import { createAppRouter } from './router';
import { useSettingsValue, type SettingsStore } from './settings';

export interface AppProps {
  i18n: I18n;
  settingsStore: SettingsStore;
  clock?: () => number;
  timeZone?: string;
  syncStatus?: SyncStatus;
  history?: RouterHistory;
}

/**
 * The whole UI. The platform shell (apps/*) opens the database, builds the
 * settings store and i18n instance, and renders this.
 */
export function App({
  i18n,
  settingsStore,
  clock = Date.now,
  timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone,
  syncStatus = 'local',
  history,
}: AppProps) {
  const settings = useSettingsValue(settingsStore);
  const [router] = useState(() => createAppRouter(history));
  useApplyTheme(settings.theme);

  useEffect(() => {
    const html = document.documentElement;
    html.lang = settings.language;
    html.dir = directionOf(settings.language);
    if (i18n.language !== settings.language) void i18n.changeLanguage(settings.language);
  }, [i18n, settings.language]);

  const env = useMemo<AppEnv>(
    () => ({
      settingsStore,
      settings,
      locale: { language: settings.language, calendar: settings.calendar, digits: settings.digits },
      clock,
      timeZone,
      syncStatus,
    }),
    [settingsStore, settings, clock, timeZone, syncStatus],
  );

  return (
    <I18nextProvider i18n={i18n}>
      <AppContext.Provider value={env}>
        <RouterProvider router={router} />
      </AppContext.Provider>
    </I18nextProvider>
  );
}
