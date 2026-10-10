// App bootstrap: open the DB, load the device data key, and wire the stores
// and sync controller together. Platform-specific bits come in via `Platform`.

import type { Env } from '@lm/core';
import { Keys, decodeBlob, encodeBlob, fromB64, randomBytes, sodiumReady, toB64 } from '@lm/crypto';
import { BlobStore, Store, SyncState } from '@lm/db';
import type { Platform } from '@lm/platform';
import { SyncController } from './sync-controller';

export const DATA_KEY_SECRET = 'lm.dataKey';

export interface Services {
  platform: Platform;
  env: Env;
  store: Store;
  syncState: SyncState;
  blobs: BlobStore;
  /** Current key set; replaced when joining a repo with a different data key. */
  keys: Keys;
  sync: SyncController;
  setDataKey(dataKey: Uint8Array): Promise<void>;
}

export const realEnv: Env = {
  now: () => Date.now(),
  random: (n) => {
    const b = new Uint8Array(n);
    globalThis.crypto.getRandomValues(b);
    return b;
  },
};

/** Every install has a data key from day one, so local attachments are encrypted even before sync (SECURITY.md §5). */
export async function loadOrCreateDataKey(platform: Platform): Promise<Uint8Array> {
  const saved = await platform.secrets.get(DATA_KEY_SECRET);
  if (saved) return fromB64(saved);
  const key = randomBytes(32);
  await platform.secrets.set(DATA_KEY_SECRET, toB64(key));
  return key;
}

export const cipherFor = (keys: Keys) => ({
  seal: (p: Uint8Array) => encodeBlob(keys, p),
  open: (h: string, c: Uint8Array) => decodeBlob(keys, h, c),
});

export async function bootServices(platform: Platform, env: Env = realEnv, dbName = 'life-manager'): Promise<Services> {
  await sodiumReady();
  const driver = await platform.openDatabase(dbName);
  const store = await Store.open(driver, env);
  const syncState = new SyncState(store);
  const keys = new Keys(await loadOrCreateDataKey(platform));
  const blobs = new BlobStore(store, cipherFor(keys));
  const services = {
    platform,
    env,
    store,
    syncState,
    blobs,
    keys,
  } as Services;
  services.setDataKey = async (dataKey: Uint8Array) => {
    const next = new Keys(dataKey);
    await blobs.reencrypt(cipherFor(next));
    await platform.secrets.set(DATA_KEY_SECRET, toB64(dataKey));
    services.keys = next;
  };
  services.sync = new SyncController(services);
  await services.sync.init();
  return services;
}
