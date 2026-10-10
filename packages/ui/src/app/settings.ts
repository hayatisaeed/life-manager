import { SETTINGS_ID, type EntityData } from '@lm/core';
import type { LmDatabase } from '@lm/db';
import type { Language } from '@lm/i18n';
import { useSyncExternalStore } from 'react';

// Account settings (DATA-MODEL.md §14) sync as one record with a fixed id.
// Until the user changes something there is no record; the UI shows defaults
// for the device's language and writes the record on the first change.

export type AppSettings = EntityData<'settings'>;

export function defaultSettings(language: Language): AppSettings {
  const fa = language === 'fa';
  return {
    language,
    calendar: fa ? 'jalali' : 'gregorian',
    weekStart: fa ? 6 : 1,
    digits: fa ? 'native' : 'latin',
    baseCurrency: fa ? 'IRR' : 'USD',
    theme: 'system',
    workingHours: [],
    energyProfile: [],
    lifeWheelAreaIds: [],
    ai: { excludedModules: ['money', 'people', 'health', 'documents'] },
  };
}

export interface SettingsStore {
  current(): AppSettings;
  subscribe(listener: () => void): () => void;
  update(patch: Partial<AppSettings>): Promise<void>;
}

/** Settings kept only in memory: stories, tests, and a device without a database. */
export function createMemorySettingsStore(initial: AppSettings): SettingsStore {
  let value = initial;
  const listeners = new Set<() => void>();
  return {
    current: () => value,
    subscribe: (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    update: (patch) => {
      value = { ...value, ...patch };
      listeners.forEach((l) => l());
      return Promise.resolve();
    },
  };
}

/**
 * Settings backed by the synced `settings` record, kept current by a live
 * query. Changes are optimistic: they show at once, and until each is written
 * it stays layered over what the database reports, so a live-query result
 * from an earlier write can't briefly undo a later change.
 */
export async function createDbSettingsStore(
  db: LmDatabase,
  fallback: AppSettings,
): Promise<SettingsStore> {
  let stored = (await db.get('settings', SETTINGS_ID))?.data ?? fallback;
  const pending: Partial<AppSettings>[] = [];
  let value = stored;
  const listeners = new Set<() => void>();
  let queue: Promise<void> = Promise.resolve();

  const recompute = () => {
    value = pending.reduce<AppSettings>((acc, patch) => ({ ...acc, ...patch }), stored);
    listeners.forEach((l) => l());
  };

  db.liveQuery(
    ['settings'],
    (d) => d.get('settings', SETTINGS_ID),
    (record) => {
      if (!record) return;
      stored = record.data;
      recompute();
    },
    (error: unknown) => {
      console.error('settings live query failed', error);
    },
  );

  async function persist(patch: Partial<AppSettings>): Promise<void> {
    const existing = await db.get('settings', SETTINGS_ID, { includeDeleted: true });
    if (!existing) {
      await db.create('settings', { ...stored, ...patch }, { id: SETTINGS_ID });
      return;
    }
    if (existing.deletedAt !== null) await db.restore('settings', SETTINGS_ID);
    await db.update('settings', SETTINGS_ID, patch);
  }

  return {
    current: () => value,
    subscribe: (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    update: (patch) => {
      pending.push(patch);
      recompute();
      // One write at a time, so two quick changes can't both create the record.
      const write = queue
        .then(() => persist(patch))
        .then(
          () => {
            // Written: it's now part of what the database holds. Any live-query
            // result computed before this write is dropped by liveQuery as stale.
            stored = { ...stored, ...patch };
            pending.splice(pending.indexOf(patch), 1);
            recompute();
          },
          (error: unknown) => {
            // Not written: the change disappears and the error goes to the caller.
            pending.splice(pending.indexOf(patch), 1);
            recompute();
            throw error;
          },
        );
      queue = write.catch(() => undefined);
      return write;
    },
  };
}

export function useSettingsValue(store: SettingsStore): AppSettings {
  return useSyncExternalStore(store.subscribe, store.current);
}
