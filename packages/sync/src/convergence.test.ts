import { beforeAll, expect, it } from 'vitest';
import fc from 'fast-check';
import sqlite3InitModule from '@sqlite.org/sqlite-wasm';
import { createRepository, serializedDriver } from '@lm/db';
import { createCrypto } from '@lm/crypto';
import { canonical, createIdGenerator } from '@lm/core';
import { createFakeForge, createSyncEngine, createSyncLock } from './index';
let sqlite: Awaited<ReturnType<typeof sqlite3InitModule>>;
let crypto: Awaited<ReturnType<typeof createCrypto>>;
beforeAll(async () => {
  sqlite = await sqlite3InitModule();
  crypto = await createCrypto();
});
const operations = Number(process.env['LM_SIM_OPS'] ?? 1000);
const seeds = Number(process.env['LM_SIM_SEEDS'] ?? 3);
const startSeed = Number(process.env['LM_SIM_SEED'] ?? 20261013);
if (
  !Number.isInteger(operations) ||
  operations < 1 ||
  !Number.isInteger(seeds) ||
  seeds < 1 ||
  !Number.isInteger(startSeed) ||
  startSeed < 0 ||
  startSeed + seeds > 2147483647
)
  throw new Error('Invalid simulator limits');
const alphabet = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const ids = Array.from({ length: 24 }, (_, i) => `01ARZ3NDEKTSV4RRFFQ69G5F0${alphabet[i]}`);
it(
  'five replicas converge after random scalar/set/text edits, tombstones and sync order',
  async () => {
    const vault = crypto.createVault('synthetic simulation passphrase', '2026-10-13');
    const control = {
      state: 'active' as const,
      vaultId: 'a'.repeat(64),
      generation: 1,
      writeNonce: 'b'.repeat(64),
    };
    const header = crypto.controlHeader(vault.header, vault.dataKey, control);
    const command = fc.record({
      record: fc.integer({ min: 0, max: ids.length - 1 }),
      action: fc.integer({ min: 0, max: 7 }),
      syncDevice: fc.integer({ min: 0, max: 4 }),
      value: fc.integer({ min: 0, max: 99 }),
    });
    try {
      for (let seedIndex = 0; seedIndex < seeds; seedIndex++)
        await fc.assert(
          fc.asyncProperty(
            fc.array(command, { minLength: operations * 5, maxLength: operations * 5 }),
            async (commands) => {
              const forge = await createFakeForge([
                { path: 'lm.json', content: crypto.encodeUtf8(JSON.stringify(header)) },
              ]);
              const replicas = await Promise.all(
                Array.from({ length: 5 }, async (_, i) => {
                  const db = new sqlite.oo1.DB(':memory:');
                  let now = 1000;
                  const repo = await createRepository(
                    serializedDriver(
                      async (sql, bind = []) =>
                        db.exec(sql, { bind, rowMode: 'object', returnValue: 'resultRows' }),
                      async () => {
                        db.close();
                      },
                    ),
                    { deviceId: `sim${i}`, now: () => now++ },
                  );
                  const engine = await createSyncEngine({
                    transport: forge.transport,
                    store: repo.sync,
                    dataKey: vault.dataKey,
                    expected: control,
                    lock: createSyncLock(),
                    now: () => now++,
                    random: () => 0.5,
                    wait: async () => undefined,
                  });
                  return { repo, engine, generate: createIdGenerator(() => 0.1 + i / 10) };
                }),
              );
              try {
                const first = replicas[0];
                if (!first) throw new Error('Missing simulator replica');
                for (const id of ids)
                  await first.repo.put('note', id, {
                    title: 'Initial',
                    content: '',
                    tags: [],
                    pinned: false,
                  });
                for (const replica of replicas) await replica.engine.sync();
                const originalVersions = new Map<string, Map<string, string>>();
                let index = 0;
                for (const command of commands) {
                  const replica = replicas[index++ % 5],
                    syncReplica = replicas[command.syncDevice],
                    id = ids[command.record];
                  if (!replica || !syncReplica || !id) throw new Error('Invalid simulator command');
                  if (command.action === 6) {
                    await syncReplica.engine.sync();
                    continue;
                  }
                  if (command.action === 7) {
                    await replica.repo.put('note', replica.generate(10000 + index), {
                      title: 'Initial',
                      content: '',
                      tags: [],
                      pinned: false,
                    });
                    continue;
                  }
                  const record = await replica.repo.get(id);
                  if (!record) throw new Error('Seeded record disappeared');
                  if (command.action === 4) await replica.repo.remove(id);
                  else if (command.action === 5) await replica.repo.restore(id);
                  else {
                    const data = { ...record.data };
                    if (command.action === 0) data.title = `title ${command.value}`;
                    if (command.action === 1) data.pinned = command.value % 2 === 0;
                    if (command.action === 2) data.tags = [String(command.value % 5)];
                    if (command.action === 3) data.content = `original ${command.value}\n`;
                    const written = await replica.repo.put('note', id, data);
                    const known = originalVersions.get(id) ?? new Map<string, string>();
                    for (const version of written.textVersions?.content ?? [])
                      known.set(version.clock, version.value);
                    originalVersions.set(id, known);
                  }
                }
                // Quiescence drains merges and uploads; no new writes are allowed during this phase.
                for (let round = 0; round < 10; round++)
                  for (const replica of replicas) await replica.engine.sync();
                const states = await Promise.all(
                  replicas.map(async ({ repo }) =>
                    canonical(
                      [...(await repo.list(undefined, true))].sort((a, b) =>
                        a.id < b.id ? -1 : 1,
                      ),
                    ),
                  ),
                );
                for (const state of states)
                  expect(crypto.contentHash(crypto.encodeUtf8(state))).toBe(
                    crypto.contentHash(crypto.encodeUtf8(states[0] ?? '')),
                  );
                for (const { repo } of replicas) {
                  for (const [id, versions] of originalVersions) {
                    const record = await repo.get(id);
                    const graph = new Map(
                      record?.textVersions?.content?.map((version) => [
                        version.clock,
                        version.value,
                      ]),
                    );
                    for (const [clock, value] of versions) expect(graph.get(clock)).toBe(value);
                  }
                  expect((await repo.sync.snapshot()).problems).toHaveLength(0);
                  expect((await repo.sync.snapshot()).dirty).toHaveLength(0);
                }
              } finally {
                for (const { repo, engine } of replicas) {
                  engine.dispose();
                  await repo.close();
                }
              }
            },
          ),
          { numRuns: 1, seed: startSeed + seedIndex, endOnFailure: true },
        );
    } finally {
      crypto.dispose(vault.dataKey);
    }
  },
  Math.max(120000, seeds * 60000),
);
