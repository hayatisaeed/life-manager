import type { EntityData } from '@lm/core';
import { testEnv } from '@lm/core';
import { Keys, contentHash, decodeBlob, encodeBlob, sodiumReady } from '@lm/crypto';
import { BlobStore, Store, SyncState } from '@lm/db';
import { memoryDriver } from '@lm/platform';
import type { SyncEngineOptions } from '../src';
import { FakeForge, FakeTransport, SyncEngine } from '../src';

export const DATA_KEY = new Uint8Array(32).fill(9);

export async function makeDevice(
  forge: FakeForge,
  seed: number,
  opts: Partial<SyncEngineOptions> = {},
  startMs = Date.UTC(2026, 9, 9, 10, 0, 0),
) {
  await sodiumReady();
  const env = testEnv(startMs + seed * 7, seed);
  const store = await Store.open(await memoryDriver(), env);
  const state = new SyncState(store);
  const keys = new Keys(DATA_KEY);
  const blobs = new BlobStore(store, {
    seal: (p) => encodeBlob(keys, p),
    open: (h, c) => decodeBlob(keys, h, c),
  });
  const transport = new FakeTransport(forge);
  const engine = new SyncEngine({
    store,
    state,
    transport,
    keys,
    env,
    blobs,
    sleep: async () => undefined,
    ...opts,
  });
  return { env, store, state, keys, blobs, transport, engine };
}

export type Device = Awaited<ReturnType<typeof makeDevice>>;

/** A repo with an lm.json so getHead() is non-null. */
export async function seededForge(
  opts: ConstructorParameters<typeof FakeForge>[0] = {},
): Promise<FakeForge> {
  const forge = new FakeForge(opts);
  await new FakeTransport(forge).commit(null, [
    { action: 'upsert', path: 'lm.json', content: '{}', exists: false },
  ]);
  return forge;
}

export const task = (
  title: string,
  extra: Partial<EntityData<'task'>> = {},
): EntityData<'task'> => ({
  title,
  notes: '',
  priority: 3,
  status: 'todo',
  reminders: [],
  tags: [],
  order: 'a0',
  ...extra,
});

export async function snapshot(d: Device): Promise<string> {
  const rows = await d.store.driver.query<{ id: string }>('SELECT id FROM records ORDER BY id');
  const out: unknown[] = [];
  for (const r of rows) {
    const e = await d.store.getEnvelope(r.id);
    out.push(e);
  }
  return JSON.stringify(out);
}

export { contentHash };
