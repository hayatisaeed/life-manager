import { createI18n, type Language } from '@lm/i18n';
import { createMemoryHistory } from '@tanstack/react-router';
import { render } from '@testing-library/react';
import { App } from '../app/App';
import { resources } from '../app/resources';
import {
  createMemorySettingsStore,
  defaultSettings,
  type AppSettings,
  type SettingsStore,
} from '../app/settings';

/** 2026-03-21 09:30 in Tehran (Nowruz), 06:00 UTC. */
export const NOWRUZ_MORNING = Date.UTC(2026, 2, 21, 6, 0);

export async function renderApp({
  language = 'en',
  settings,
  store,
  path = '/',
  clock = () => NOWRUZ_MORNING,
}: {
  language?: Language;
  settings?: Partial<AppSettings>;
  store?: SettingsStore;
  path?: string;
  clock?: () => number;
} = {}) {
  const settingsStore =
    store ?? createMemorySettingsStore({ ...defaultSettings(language), ...settings });
  const i18n = await createI18n(settingsStore.current().language, resources);
  const view = render(
    <App
      i18n={i18n}
      settingsStore={settingsStore}
      clock={clock}
      timeZone="Asia/Tehran"
      history={createMemoryHistory({ initialEntries: [path] })}
    />,
  );
  return { ...view, settingsStore, i18n };
}
