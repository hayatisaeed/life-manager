// Test helpers: simulated devices sharing one fake forge.
import type { EntityData, Rng } from '@lm/core';
import { deriveSubKeys, initCrypto, type DataKey, type SubKeys } from '@lm/crypto';
import { LmDatabase, type SqlDriver } from '@lm/db';
import { openMemoryDriver } from '@lm/db/memory';
import { SyncEngine, type SyncEngineOptions } from '../engine';
import { FakeForge, type FakeForgeHooks } from '../fake-forge';

let keys: SubKeys | null = null;

/** The sub-keys every simulated device of one repo shares. */
export async function repoKeys(): Promise<SubKeys> {
  await initCrypto();
  keys ??= deriveSubKeys(new Uint8Array(32).fill(42) as DataKey);
  return keys;
}

/** Deterministic [0, 1) generator (mulberry32). */
export function seededRng(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A forge that has been set up the way onboarding leaves it (SYNC.md §8). */
export function initializedForge(): FakeForge {
  const forge = new FakeForge();
  forge.commit(null, [{ path: 'lm.json', content: '{"format":"life-manager","version":1}' }]);
  return forge;
}

export interface Device {
  db: LmDatabase;
  driver: SqlDriver;
  engine: SyncEngine;
  hooks: FakeForgeHooks;
  clock: { (): number; now: number };
  sleeps: number[];
}

export async function device(
  forge: FakeForge,
  seed: number,
  options: Partial<SyncEngineOptions> = {},
  startMs = Date.UTC(2026, 9, 10),
): Promise<Device> {
  const clock = Object.assign(() => clock.now, { now: startMs });
  const rng = seededRng(seed);
  const driver = await openMemoryDriver();
  const db = await LmDatabase.open({ driver, clock, rng });
  const transport = forge.transport();
  const sleeps: number[] = [];
  const engine = new SyncEngine({
    db,
    transport,
    keys: await repoKeys(),
    rng,
    clock,
    sleep: (ms) => {
      sleeps.push(ms);
      return Promise.resolve();
    },
    ...options,
  });
  return { db, driver, engine, hooks: transport.hooks, clock, sleeps };
}

export const task = (over: Partial<EntityData<'task'>> = {}): EntityData<'task'> => ({
  title: 'Call mom',
  notes: '',
  priority: 2,
  status: 'todo',
  reminders: [],
  tags: [],
  order: 'a0',
  ...over,
});

export const note = (title: string, content = ''): EntityData<'note'> => ({
  title,
  content,
  tags: [],
  pinned: false,
});
