import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import sqlite3InitModule from '@sqlite.org/sqlite-wasm';
import { createRepository, serializedDriver } from '@lm/db';
import type { Repository } from '@lm/db';
import { createCrypto } from '@lm/crypto';
import type { ControlledVaultHeader, VaultControl } from '@lm/crypto';
import { canonical } from '@lm/core';
import { createFakeForge, createSyncEngine, createSyncLock, SyncError } from './index';
import type { SyncTransport } from './index';
let crypto: Awaited<ReturnType<typeof createCrypto>>;
let sqlite: Awaited<ReturnType<typeof sqlite3InitModule>>;
let vault: ReturnType<Awaited<ReturnType<typeof createCrypto>>['createVault']>;
let header: ControlledVaultHeader;
const control: VaultControl = {
  state: 'active',
  vaultId: 'a'.repeat(64),
  generation: 1,
  writeNonce: 'b'.repeat(64),
};
const id = '01ARZ3NDEKTSV4RRFFQ69G5FAV';
const otherId = '01ARZ3NDEKTSV4RRFFQ69G5FAW';
const note = { title: 'Private note', content: 'base\n', tags: [] as string[], pinned: false };
const repos: Repository[] = [];
const engines: Awaited<ReturnType<typeof createSyncEngine>>[] = [];
beforeAll(async () => {
  crypto = await createCrypto();
  sqlite = await sqlite3InitModule();
  vault = crypto.createVault('synthetic passphrase', '2026-10-13');
  header = crypto.controlHeader(vault.header, vault.dataKey, control);
});
afterEach(async () => {
  for (const engine of engines.splice(0)) engine.dispose();
  for (const repo of repos.splice(0)) await repo.close();
});
async function replica(transport: SyncTransport, name = 'device') {
  const db = new sqlite.oo1.DB(':memory:');
  let now = 1000;
  const driver = serializedDriver(
    async (sql, bind = []) => db.exec(sql, { bind, rowMode: 'object', returnValue: 'resultRows' }),
    async () => {
      db.close();
    },
  );
  const repo = await createRepository(driver, { deviceId: name, now: () => now++ });
  repos.push(repo);
  const waits: number[] = [];
  const engine = await createSyncEngine({
    transport,
    store: repo.sync,
    dataKey: vault.dataKey,
    expected: control,
    lock: createSyncLock(),
    now: () => now++,
    random: () => 0.5,
    wait: async (millis) => {
      waits.push(millis);
    },
  });
  engines.push(engine);
  return { repo, engine, driver, waits };
}
const forge = () =>
  createFakeForge([{ path: 'lm.json', content: crypto.encodeUtf8(JSON.stringify(header)) }]);
describe('encrypted sync cycle on SQLite WASM and a fake forge', () => {
  it('pushes opaque ciphertext, receives on a second device, and skips unchanged subtrees', async () => {
    const remote = await forge();
    const a = await replica(remote.transport, 'a'),
      b = await replica(remote.transport, 'b');
    await a.repo.put('note', id, note);
    expect(await a.engine.sync()).toMatchObject({ state: 'synced' });
    expect((await a.repo.sync.snapshot()).dirty).toHaveLength(0);
    await b.engine.sync();
    expect(canonical(await a.repo.get(id))).toBe(canonical(await b.repo.get(id)));
    const files = remote.inspect();
    expect(files.size).toBe(2);
    for (const [path, content] of files) {
      expect(path).not.toContain(id);
      expect(crypto.decodeUtf8(content)).not.toContain('Private note');
    }
    const before = { ...remote.counters };
    await b.engine.sync();
    expect(remote.counters).toEqual(before);
    await b.repo.put('note', otherId, { ...note, title: 'Another' });
    await b.engine.sync();
    const blobs = remote.counters.blobs;
    await a.engine.sync();
    expect(remote.counters.blobs - blobs).toBe(1);
    expect((await a.repo.list()).length).toBe(2);
  });
  it('merges concurrent scalar/text edits and retains overlapping original versions', async () => {
    const remote = await forge();
    const a = await replica(remote.transport, 'a'),
      b = await replica(remote.transport, 'b');
    await a.repo.put('note', id, note);
    await a.engine.sync();
    await b.engine.sync();
    await a.repo.put('note', id, { ...note, title: 'A', content: 'A\n' });
    await b.repo.put('note', id, { ...note, pinned: true, content: 'B\n' });
    await a.engine.sync();
    await b.engine.sync();
    await a.engine.sync();
    const merged = await a.repo.get(id);
    expect(merged?.data.title).toBe('A');
    expect(merged?.data.pinned).toBe(true);
    expect(String(merged?.data.content)).toContain('A');
    expect(String(merged?.data.content)).toContain('B');
    expect(merged?.textVersions?.content).toHaveLength(3);
    expect(canonical(merged)).toBe(canonical(await b.repo.get(id)));
  });
  it('preserves tombstones while allowing a concurrent edit to beat a delete', async () => {
    const remote = await forge();
    const a = await replica(remote.transport, 'a'),
      b = await replica(remote.transport, 'b');
    await a.repo.put('note', id, note);
    await a.engine.sync();
    await b.engine.sync();
    await a.repo.remove(id);
    await a.engine.sync();
    await b.engine.sync();
    expect(await b.repo.list()).toHaveLength(0);
    expect(await b.repo.list(undefined, true)).toHaveLength(1);
    await a.repo.restore(id);
    await a.engine.sync();
    await b.engine.sync();
    await a.repo.remove(id);
    await b.repo.put('note', id, { ...note, title: 'Saved edit' });
    await a.engine.sync();
    await b.engine.sync();
    await a.engine.sync();
    expect((await a.repo.get(id))?.deletedAt).toBeNull();
    expect((await a.repo.get(id))?.data.title).toBe('Saved edit');
  });
  it('does not acknowledge an edit made while the captured version is uploading', async () => {
    const remote = await forge();
    const a = await replica(remote.transport);
    await a.repo.put('note', id, note);
    const commit = remote.transport.commit;
    let edited = false;
    remote.transport.commit = async (parent, files) => {
      if (!edited) {
        edited = true;
        await a.repo.put('note', id, { ...note, title: 'During push' });
      }
      return commit(parent, files);
    };
    await a.engine.sync();
    expect((await a.repo.sync.snapshot()).dirty).toHaveLength(1);
    await a.engine.sync();
    expect((await a.repo.sync.snapshot()).dirty).toHaveLength(0);
    const b = await replica(remote.transport, 'b');
    await b.engine.sync();
    expect((await b.repo.get(id))?.data.title).toBe('During push');
  });
  it('reconciles a committed response lost in transit without another commit', async () => {
    const remote = await forge();
    const a = await replica(remote.transport);
    await a.repo.put('note', id, note);
    remote.loseNextCommitResponse();
    expect(await a.engine.sync()).toMatchObject({ state: 'synced', attempts: 2 });
    expect(remote.counters.commits).toBe(1);
    expect((await a.repo.sync.snapshot()).dirty).toHaveLength(0);
  });
  it('retries CAS conflicts with bounded exponential backoff and retains dirty work on exhaustion', async () => {
    const remote = await forge();
    const a = await replica(remote.transport);
    await a.repo.put('note', id, note);
    remote.rejectNextCommits(2);
    expect(await a.engine.sync()).toMatchObject({ attempts: 3 });
    expect(a.waits).toEqual([500, 1000]);
    await a.repo.put('note', id, { ...note, title: 'Pending' });
    remote.rejectNextCommits(5);
    await expect(a.engine.sync()).rejects.toMatchObject({ code: 'conflict' });
    expect((await a.repo.sync.snapshot()).dirty).toHaveLength(1);
  });
  it('surfaces authentication/rate limits, preserves local work and serializes overlapping cycles', async () => {
    const remote = await forge();
    const a = await replica(remote.transport);
    await a.repo.put('note', id, note);
    remote.fail(new SyncError('authentication'));
    await expect(a.engine.sync()).rejects.toMatchObject({ code: 'authentication' });
    expect(a.waits).toHaveLength(0);
    remote.fail(null);
    remote.setRateLimit({ remaining: 0, resetAt: 100000 });
    await expect(a.engine.sync()).rejects.toMatchObject({ code: 'rate-limit' });
    remote.setRateLimit({ remaining: null, resetAt: null });
    await Promise.all([a.engine.sync(), a.engine.sync()]);
    expect(remote.counters.commits).toBe(1);
  });
  it('aborts an in-flight cycle on lock instead of encrypting with disposed keys', async () => {
    const remote = await forge();
    const a = await replica(remote.transport);
    await a.repo.put('note', id, note);
    let release: (() => void) | undefined, entered: (() => void) | undefined;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const read = remote.transport.readFile;
    remote.transport.readFile = async (path, head) => {
      entered?.();
      await pending;
      return read(path, head);
    };
    const running = a.engine.sync();
    await started;
    a.engine.dispose();
    release?.();
    await expect(running).rejects.toMatchObject({ code: 'authentication' });
    expect(remote.counters.commits).toBe(0);
    expect((await a.repo.sync.snapshot()).dirty).toHaveLength(1);
  });
  it('blocks ordinary writes for a frozen vault, generation mismatch and old headers', async () => {
    const remote = await forge();
    const a = await replica(remote.transport);
    await a.repo.put('note', id, note);
    const frozen = crypto.controlHeader(header, vault.dataKey, {
      ...control,
      state: 'frozen',
      operationId: 'c'.repeat(64),
    });
    remote.mutate((files) => files.set('lm.json', crypto.encodeUtf8(JSON.stringify(frozen))));
    await expect(a.engine.sync()).rejects.toMatchObject({ code: 'maintenance' });
    const changed = crypto.controlHeader(header, vault.dataKey, { ...control, generation: 2 });
    remote.mutate((files) => files.set('lm.json', crypto.encodeUtf8(JSON.stringify(changed))));
    await expect(a.engine.sync()).rejects.toMatchObject({ code: 'recovery-required' });
    remote.mutate((files) => files.set('lm.json', crypto.encodeUtf8(JSON.stringify(vault.header))));
    await expect(a.engine.sync()).rejects.toMatchObject({ code: 'update-required' });
    remote.mutate((files) =>
      files.set('lm.json', crypto.encodeUtf8(JSON.stringify({ ...header, version: 3 }))),
    );
    await expect(a.engine.sync()).rejects.toMatchObject({ code: 'update-required' });
    expect(remote.counters.commits).toBe(0);
    expect((await a.repo.sync.snapshot()).dirty).toHaveLength(1);
  });
  it('keeps corrupt ciphertext and blocks overwriting the affected dirty path', async () => {
    const remote = await forge();
    const a = await replica(remote.transport);
    await a.repo.put('note', id, note);
    await a.engine.sync();
    await a.repo.put('note', id, { ...note, title: 'Keep local' });
    const path = crypto.recordPath(id, crypto.deriveKeys(vault.dataKey).path);
    const corrupt = crypto.encodeUtf8('LMR1.corrupt');
    remote.mutate((files) => files.set(path, corrupt));
    expect(await a.engine.sync()).toMatchObject({ state: 'problems', problems: 1 });
    const snapshot = await a.repo.sync.snapshot();
    expect(snapshot.problems[0]?.ciphertext).toEqual(corrupt);
    expect(snapshot.dirty).toHaveLength(1);
    expect(remote.inspect().get(path)).toEqual(corrupt);
    expect((await a.repo.get(id))?.data.title).toBe('Keep local');
    const another = crypto.encodeUtf8('LMR1.second-corrupt-copy');
    remote.mutate((files) => files.set(path, another));
    await a.engine.sync();
    expect((await a.repo.sync.snapshot()).problems).toHaveLength(2);
    expect(await a.repo.export()).toContain('preservedCiphertext');
    const keys = crypto.deriveKeys(vault.dataKey);
    const current = await a.repo.get(id);
    if (!current) throw new Error('Missing local record');
    remote.mutate((files) =>
      files.set(
        path,
        crypto.encodeUtf8(
          crypto.encodeRecord(crypto.encodeUtf8(JSON.stringify(current)), path, keys.record),
        ),
      ),
    );
    expect(await a.engine.sync()).toMatchObject({ state: 'synced' });
    expect((await a.repo.sync.snapshot()).problems).toHaveLength(0);
    // Resolved problems remain recoverable, even after the remote path is repaired.
    expect(await a.driver.query('SELECT * FROM sync_problems')).toHaveLength(2);
  });
  it('preserves newer schemas and unknown fields without editing their data', async () => {
    const remote = await forge();
    const a = await replica(remote.transport);
    const record = await a.repo.put('note', id, note);
    await a.engine.sync();
    const keys = crypto.deriveKeys(vault.dataKey),
      path = crypto.recordPath(id, keys.path);
    const future = { ...record, schema: 2, data: { ...record.data, future: { a: 1 } } };
    remote.mutate((files) =>
      files.set(
        path,
        crypto.encodeUtf8(
          crypto.encodeRecord(crypto.encodeUtf8(JSON.stringify(future)), path, keys.record),
        ),
      ),
    );
    await a.engine.sync();
    expect(await a.repo.get(id)).toEqual(future);
    await expect(a.repo.put('note', id, note)).rejects.toThrow();
    expect((await a.repo.sync.snapshot()).dirty).toHaveLength(0);
    expect(await a.repo.export()).toContain('future');
  });
  it('reports a removed remote file without deleting or re-creating the local record', async () => {
    const remote = await forge();
    const a = await replica(remote.transport);
    await a.repo.put('note', id, note);
    await a.engine.sync();
    const path = crypto.recordPath(id, crypto.deriveKeys(vault.dataKey).path);
    remote.mutate((files) => files.delete(path));
    expect(await a.engine.sync()).toMatchObject({ state: 'problems' });
    expect(await a.repo.get(id)).not.toBeNull();
    expect(remote.inspect().has(path)).toBe(false);
  });
  it('preserves clean records when a valid older ciphertext is replayed', async () => {
    const remote = await forge();
    const a = await replica(remote.transport);
    await a.repo.put('note', id, note);
    await a.engine.sync();
    const path = crypto.recordPath(id, crypto.deriveKeys(vault.dataKey).path);
    const previous = remote.inspect().get(path);
    if (!previous) throw new Error('Missing test ciphertext');
    await a.repo.put('note', id, { ...note, content: 'Newest original' });
    await a.engine.sync();
    remote.mutate((files) => files.set(path, previous));
    expect(await a.engine.sync()).toMatchObject({ state: 'problems' });
    expect((await a.repo.get(id))?.data.content).toBe('Newest original');
    expect((await a.repo.sync.snapshot()).problems[0]?.ciphertext).toEqual(previous);
  });
  it('rejects a valid encrypted record whose ID does not hash to its path', async () => {
    const remote = await forge();
    const a = await replica(remote.transport);
    const record = await a.repo.put('note', id, note);
    const keys = crypto.deriveKeys(vault.dataKey),
      path = crypto.recordPath(otherId, keys.path);
    remote.mutate((files) =>
      files.set(
        path,
        crypto.encodeUtf8(
          crypto.encodeRecord(crypto.encodeUtf8(JSON.stringify(record)), path, keys.record),
        ),
      ),
    );
    expect(await a.engine.sync()).toMatchObject({ state: 'problems' });
    expect((await a.repo.sync.snapshot()).problems[0]?.reason).toBe('invalid-record');
    expect(await a.repo.get(otherId)).toBeNull();
  });
  it('rolls back a pull completely on an IO failure and receives remote clocks before local writes', async () => {
    const remote = await forge();
    const a = await replica(remote.transport, 'a'),
      b = await replica(remote.transport, 'b');
    await a.repo.put('note', id, note);
    await a.repo.put('note', otherId, note);
    await a.engine.sync();
    const transaction = b.driver.transaction;
    let writes = 0;
    b.driver.transaction = (run) =>
      transaction((db) =>
        run({
          query: async (sql, bind) => {
            if (sql.startsWith('INSERT INTO records') && ++writes === 2)
              throw new Error('Synthetic IO failure');
            return db.query(sql, bind);
          },
        }),
      );
    await expect(b.engine.sync()).rejects.toThrow('Synthetic IO failure');
    expect(await b.repo.list()).toHaveLength(0);
    expect((await b.repo.sync.snapshot()).head).toBeNull();
    b.driver.transaction = transaction;
    await b.engine.sync();
    const received = await b.repo.get(id);
    const edited = await b.repo.put('note', id, { ...note, title: 'After receive' });
    expect(edited.hlc > (received?.hlc ?? '')).toBe(true);
  });
});
