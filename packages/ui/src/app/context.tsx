import type { LocaleSettings } from '@lm/i18n';
import { createContext, useContext } from 'react';
import type { SyncStatus } from '../layout/SyncPill';
import type { AppSettings, SettingsStore } from './settings';

export interface AppEnv {
  settingsStore: SettingsStore;
  settings: AppSettings;
  locale: LocaleSettings;
  /** Wall clock in ms; injected so screens are testable. */
  clock: () => number;
  timeZone: string;
  syncStatus: SyncStatus;
}

export const AppContext = createContext<AppEnv | null>(null);

export function useApp(): AppEnv {
  const env = useContext(AppContext);
  if (!env) throw new Error('useApp() must be used inside <App>');
  return env;
}
