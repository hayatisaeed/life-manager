// @vitest-environment node
import { SETTINGS_ID } from '@lm/core';
import { LmDatabase } from '@lm/db';
import { openMemoryDriver } from '@lm/db/memory';
import { describe, expect, it } from 'vitest';
import { createDbSettingsStore, createMemorySettingsStore, defaultSettings } from './settings';

const tick = () => new Promise((r) => setTimeout(r, 0));

describe('settings stores', () => {
  it('defaults follow the language', () => {
    expect(defaultSettings('fa')).toMatchObject({
      calendar: 'jalali',
      weekStart: 6,
      digits: 'native',
      baseCurrency: 'IRR',
    });
    expect(defaultSettings('en')).toMatchObject({
      calendar: 'gregorian',
      weekStart: 1,
      digits: 'latin',
    });
  });

  it('keeps settings in memory and notifies until unsubscribed', async () => {
    const store = createMemorySettingsStore(defaultSettings('en'));
    let calls = 0;
    const off = store.subscribe(() => calls++);
    await store.update({ theme: 'dark' });
    off();
    await store.update({ theme: 'light' });
    expect(calls).toBe(1);
    expect(store.current().theme).toBe('light');
  });

  it('creates the synced settings record on first change, then updates it', async () => {
    let now = Date.UTC(2026, 9, 10);
    const db = await LmDatabase.open({
      driver: await openMemoryDriver(),
      clock: () => now++,
      rng: Math.random,
    });
    const store = await createDbSettingsStore(db, defaultSettings('fa'));
    expect(store.current().language).toBe('fa');
    expect(await db.get('settings', SETTINGS_ID)).toBeNull();
    let calls = 0;
    const off = store.subscribe(() => calls++);
    await store.update({ theme: 'dark' });
    await tick();
    expect((await db.get('settings', SETTINGS_ID))?.data).toMatchObject({
      language: 'fa',
      theme: 'dark',
    });
    expect(store.current().theme).toBe('dark');
    await store.update({ language: 'en' });
    await tick();
    expect(store.current()).toMatchObject({ language: 'en', theme: 'dark' });
    // Optimistic updates notify at once, and the live query again after the write.
    expect(calls).toBeGreaterThanOrEqual(2);
    off();
    // A deleted settings record (e.g. merged from another device) is restored on change.
    await db.delete('settings', SETTINGS_ID);
    await store.update({ digits: 'latin' });
    expect((await db.get('settings', SETTINGS_ID))?.data.digits).toBe('latin');
    // Two quick changes before the record exists both land.
    const fresh = await LmDatabase.open({
      driver: await openMemoryDriver(),
      clock: () => now++,
      rng: Math.random,
    });
    const quick = await createDbSettingsStore(fresh, defaultSettings('en'));
    await Promise.all([quick.update({ theme: 'dark' }), quick.update({ calendar: 'jalali' })]);
    expect((await fresh.get('settings', SETTINGS_ID))?.data).toMatchObject({
      theme: 'dark',
      calendar: 'jalali',
    });
    // A later change never flickers back while an earlier write's live-query
    // result arrives.
    const seen: string[] = [];
    quick.subscribe(() => seen.push(quick.current().theme));
    const first = quick.update({ theme: 'light' });
    const second = quick.update({ theme: 'system' });
    await Promise.all([first, second]);
    await tick();
    expect(seen.slice(seen.indexOf('system'))).not.toContain('light');
    expect(quick.current().theme).toBe('system');
    // A failed write is reported to its caller and doesn't block later ones.
    await fresh.close();
    await expect(quick.update({ digits: 'native' })).rejects.toThrow();
    // A second store over the same database reads the saved record.
    const again = await createDbSettingsStore(db, defaultSettings('en'));
    expect(again.current()).toMatchObject({ language: 'en', theme: 'dark', digits: 'latin' });
  });
});
