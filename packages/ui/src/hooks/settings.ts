// The synced settings record (DATA-MODEL.md §14) plus locale helpers.

import { useCallback, useMemo } from 'react';
import type { EntityData } from '@lm/core';
import { SETTINGS_ID } from '@lm/core';
import type { Store } from '@lm/db';
import type { LocaleSettings } from '@lm/i18n';
import { systemTimeZone, todayIn } from '@lm/i18n';
import { useServices } from '../app/context';
import { useLive } from './live';

export type Settings = EntityData<'settings'>;

export function defaultSettings(lang?: string): Settings {
  const nav = lang ?? (typeof navigator !== 'undefined' ? navigator.language : 'en');
  const fa = nav.toLowerCase().startsWith('fa');
  return {
    language: fa ? 'fa' : 'en',
    calendar: fa ? 'jalali' : 'gregorian',
    weekStart: fa ? 6 : 1,
    digits: fa ? 'persian' : 'latin',
    baseCurrency: fa ? 'IRR' : 'USD',
    tomanDisplay: fa,
    theme: 'system',
    timeZone: systemTimeZone(),
    workingHours: { start: '09:00', end: '17:00', days: fa ? [6, 0, 1, 2, 3] : [1, 2, 3, 4, 5] },
    energyProfile: 'morning',
    lifeWheelTargets: {},
    aiAllowedModules: ['tasks', 'calendar', 'habits', 'notes'],
  };
}

export async function readSettings(store: Store): Promise<Settings> {
  const r = await store.get('settings', SETTINGS_ID);
  return { ...defaultSettings(), ...(r?.data ?? {}) } as Settings;
}

export async function writeSettings(store: Store, patch: Partial<Settings>): Promise<void> {
  const cur = await store.get('settings', SETTINGS_ID);
  if (cur) await store.update('settings', SETTINGS_ID, patch);
  else await store.create('settings', { ...defaultSettings(), ...patch }, { id: SETTINGS_ID });
}

export function useSettings(): [Settings, (patch: Partial<Settings>) => Promise<void>] {
  const { store } = useServices();
  const s = useLive((st) => readSettings(st), [], ['settings']);
  const update = useCallback((patch: Partial<Settings>) => writeSettings(store, patch), [store]);
  return [s ?? defaultSettings(), update];
}

export function toLocale(s: Settings): LocaleSettings {
  return {
    language: s.language,
    calendar: s.calendar,
    digits: s.digits,
    timeZone: s.timeZone,
    weekStart: s.weekStart,
    tomanDisplay: s.tomanDisplay,
  };
}

export function useLocale(): LocaleSettings {
  const [s] = useSettings();
  return useMemo(() => toLocale(s), [s]);
}

/** Today's LocalDate in the user's time zone; re-evaluated each render. */
export function useToday(): string {
  const { env } = useServices();
  const loc = useLocale();
  return todayIn(loc.timeZone, env.now());
}
