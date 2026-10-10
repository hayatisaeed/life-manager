import { CONFLICT_START } from '@lm/core';
import { encryptRecord, recordPath } from '@lm/crypto';
import { describe, expect, it } from 'vitest';
import { FakeForge } from './fake-forge';
import { device, initializedForge, note, repoKeys, task } from './test-support/devices';
import { AuthError, RateLimitedError } from './transport';

describe('two devices', () => {
  it('push, pull and edit round trip', async () => {
    const forge = initializedForge();
    const a = await device(forge, 1);
    const b = await device(forge, 2);
    const t = await a.db.create('task', task({ title: 'Buy milk' }));
    expect(await a.engine.sync()).toMatchObject({ status: 'ok', pushed: 1, pulled: 0 });
    expect(await a.db.changeLog()).toEqual([]);
    expect(await b.engine.sync()).toMatchObject({ status: 'ok', pulled: 1, pushed: 0 });
    expect((await b.db.get('task', t.id))?.data.title).toBe('Buy milk');
    expect(await b.db.changeLog()).toEqual([]);

    b.clock.now += 1000;
    await b.db.update('task', t.id, { status: 'done' });
    await b.engine.sync();
    expect(await a.engine.sync()).toMatchObject({ status: 'ok', pulled: 1 });
    expect((await a.db.get('task', t.id))?.data.status).toBe('done');

    // The forge only ever holds ciphertext under keyed names.
    for (const [path, sha] of forge.files()) {
      if (path === 'lm.json') continue;
      expect(path).toMatch(/^r\/[0-9a-f]{2}\/[0-9a-f]{2}\/[0-9a-f]{64}\.lmr$/);
      const text = new TextDecoder().decode(forge.blobs.get(sha));
      expect(text).toMatch(/^LMR1\./);
      expect(text).not.toContain('milk');
      expect(text).not.toContain(t.id);
    }
  });

  it('a sync with nothing new reads only the head', async () => {
    const forge = initializedForge();
    const a = await device(forge, 1);
    await a.db.create('note', note('x'));
    await a.engine.sync();
    const before = forge.requestCount;
    expect(await a.engine.sync()).toMatchObject({ status: 'ok', pulled: 0, pushed: 0 });
    expect(forge.requestCount - before).toBe(1);
  });

  it('does not re-download what it pushed itself', async () => {
    const forge = initializedForge();
    const a = await device(forge, 1);
    const b = await device(forge, 2);
    await a.db.create('note', note('one'));
    await a.engine.sync();
    await b.db.create('note', note('two'));
    await b.engine.sync();
    // a pulls b's note only; its own file is known from the push.
    expect(await a.engine.sync()).toMatchObject({ pulled: 1, pushed: 0 });
    expect(await a.engine.sync()).toMatchObject({ pulled: 0, pushed: 0 });
  });

  it('merges concurrent edits field by field and keeps both text versions', async () => {
    const forge = initializedForge();
    const a = await device(forge, 1);
    const b = await device(forge, 2);
    const n = await a.db.create('note', note('Plan', 'line 1\nline 2\nline 3'));
    await a.engine.sync();
    await b.engine.sync();
    a.clock.now += 10;
    b.clock.now += 20;
    await a.db.update('note', n.id, { title: 'Plan A', content: 'line 1\nA\nline 3' });
    await b.db.update('note', n.id, { pinned: true, content: 'line 1\nB\nline 3' });
    await a.engine.sync();
    await b.engine.sync(); // merges, then pushes the merge
    await a.engine.sync();
    const ra = await a.db.get('note', n.id);
    const rb = await b.db.get('note', n.id);
    expect(ra).toEqual(rb);
    expect(ra?.data.title).toBe('Plan A');
    expect(ra?.data.pinned).toBe(true);
    expect(ra?.data.content).toContain(CONFLICT_START);
    expect(ra?.data.content).toContain('A');
    expect(ra?.data.content).toContain('B');
    expect(ra?.['conflicts']).toEqual(['content']);
  });

  it('an edit beats a concurrent delete and is reported as restored', async () => {
    const forge = initializedForge();
    const a = await device(forge, 1);
    const b = await device(forge, 2);
    const t = await a.db.create('task', task());
    await a.engine.sync();
    await b.engine.sync();
    await a.db.delete('task', t.id);
    await a.engine.sync();
    b.clock.now += 5;
    await b.db.update('task', t.id, { title: 'still needed' });
    const out = await b.engine.sync();
    expect(out).toMatchObject({ status: 'ok', restored: [t.id] });
    await a.engine.sync();
    expect((await a.db.get('task', t.id))?.data.title).toBe('still needed');
  });

  it('merges a record both devices created offline with the same fixed id', async () => {
    const { SETTINGS_ID } = await import('@lm/core');
    const forge = initializedForge();
    const a = await device(forge, 1);
    const b = await device(forge, 2);
    const settings = (language: 'en' | 'fa') => ({
      language,
      calendar: 'gregorian' as const,
      weekStart: 1,
      digits: 'latin' as const,
      baseCurrency: 'EUR',
      theme: 'system' as const,
      workingHours: [],
      energyProfile: [],
      lifeWheelAreaIds: [],
      ai: { excludedModules: [] },
    });
    await a.db.create('settings', settings('en'), { id: SETTINGS_ID });
    b.clock.now += 1;
    await b.db.create('settings', settings('fa'), { id: SETTINGS_ID });
    await a.engine.sync();
    await b.engine.sync(); // no base: merged as two creations
    await a.engine.sync();
    expect(await a.db.get('settings', SETTINGS_ID)).toEqual(
      await b.db.get('settings', SETTINGS_ID),
    );
  });

  it('skips a dirty record it cannot read when pushing', async () => {
    const forge = initializedForge();
    const a = await device(forge, 1);
    const n = await a.db.create('note', note('x'));
    await a.driver.run('UPDATE ent_note SET schema = 99 WHERE id = ?', [n.id]);
    expect(await a.engine.sync()).toMatchObject({ status: 'ok', pushed: 0 });
  });

  it('keeps a local edit made while the push was in flight', async () => {
    const forge = initializedForge();
    const a = await device(forge, 1);
    const t = await a.db.create('task', task());
    a.hooks.beforeCommit = async () => {
      delete a.hooks.beforeCommit;
      a.clock.now += 1;
      await a.db.update('task', t.id, { title: 'edited during push' });
    };
    await a.engine.sync();
    expect((await a.db.changeLog()).map((c) => c.recordId)).toEqual([t.id]);
    await a.engine.sync();
    expect(await a.db.changeLog()).toEqual([]);
  });
});

describe('compare-and-swap', () => {
  it('retries after another device moved the branch, with growing backoff', async () => {
    const forge = initializedForge();
    const a = await device(forge, 1, { backoffMs: 100 });
    const b = await device(forge, 2);
    await a.db.create('task', task({ title: 'from a' }));
    let races = 2;
    a.hooks.beforeCommit = async () => {
      if (races-- <= 0) return;
      await b.db.create('note', note(`race ${String(races)}`));
      await b.engine.sync();
    };
    expect(await a.engine.sync()).toMatchObject({ status: 'ok', pushed: 1, pulled: 2 });
    expect(a.sleeps).toHaveLength(2);
    expect(a.sleeps[0]).toBeGreaterThanOrEqual(100);
    expect(a.sleeps[1]).toBeGreaterThanOrEqual(200);
    expect(await a.db.list('note')).toHaveLength(2);
  });

  it('gives up after the maximum attempts and keeps the change log', async () => {
    const forge = initializedForge();
    const a = await device(forge, 1, { maxAttempts: 3 });
    await a.db.create('task', task());
    a.hooks.beforeCommit = () => {
      forge.commit(forge.head, [{ path: 'other', content: String(Math.random()) }]);
    };
    expect(await a.engine.sync()).toEqual({ status: 'conflict', attempts: 3 });
    expect(await a.db.changeLog()).toHaveLength(1);
  });

  it('pushes a long change log over several commits', async () => {
    const forge = initializedForge();
    const a = await device(forge, 1, { maxFilesPerCommit: 2 });
    for (let i = 0; i < 5; i++) await a.db.create('note', note(`n${String(i)}`));
    const commits = forge.commitCount;
    expect(await a.engine.sync()).toMatchObject({ status: 'ok', pushed: 5 });
    expect(forge.commitCount - commits).toBe(3);
    const b = await device(forge, 2, { batchSize: 2 });
    expect(await b.engine.sync()).toMatchObject({ pulled: 5 });
  });

  it('runs one cycle at a time', async () => {
    const forge = initializedForge();
    const a = await device(forge, 1);
    const [x, y] = [a.engine.sync(), a.engine.sync()];
    expect(x).toBe(y);
    await x;
    expect(a.engine.sync()).not.toBe(x);
  });
});

describe('failures', () => {
  it('reports rate limits, auth errors and other errors', async () => {
    const forge = initializedForge();
    const a = await device(forge, 1);
    a.hooks.onRequest = () => {
      throw new RateLimitedError(123);
    };
    expect(await a.engine.sync()).toEqual({ status: 'rateLimited', resetAt: 123 });
    a.hooks.onRequest = () => {
      throw new AuthError('bad token');
    };
    expect(await a.engine.sync()).toEqual({ status: 'authError', message: 'bad token' });
    a.hooks.onRequest = () => {
      throw new Error('offline');
    };
    expect(await a.engine.sync()).toEqual({ status: 'error', message: 'offline' });
    a.hooks.onRequest = (op) => {
      if (op === 'commit') throw 'weird';
    };
    await a.db.create('note', note('x'));
    expect(await a.engine.sync()).toEqual({ status: 'error', message: 'weird' });
  });

  it('skips the cycle when the forge says the limit is nearly used up', async () => {
    const forge = initializedForge();
    const a = await device(forge, 1);
    const transport = forge.transport();
    const { SyncEngine } = await import('./engine');
    const limited = new SyncEngine({
      db: a.db,
      transport: {
        ...transport,
        rateLimit: () => ({ remaining: 3, resetAt: a.clock.now + 60_000 }),
      },
      keys: await repoKeys(),
      rng: () => 0,
      clock: a.clock,
    });
    expect(await limited.sync()).toEqual({ status: 'rateLimited', resetAt: a.clock.now + 60_000 });
    const reset = new SyncEngine({
      db: a.db,
      transport: { ...transport, rateLimit: () => ({ remaining: 3, resetAt: null }) },
      keys: await repoKeys(),
      rng: () => 0,
    });
    expect(await reset.sync()).toEqual({ status: 'rateLimited', resetAt: null });
  });

  it('refuses an uninitialized repo', async () => {
    const a = await device(new FakeForge(), 1);
    expect(await a.engine.sync()).toMatchObject({
      status: 'error',
      message: expect.stringMatching(/no commits/),
    });
  });

  it('fails the cycle if the forge loses a blob, and recovers', async () => {
    const forge = initializedForge();
    const a = await device(forge, 1);
    const b = await device(forge, 2);
    await a.db.create('note', note('x'));
    await a.engine.sync();
    const saved = new Map(forge.blobs);
    forge.blobs.clear();
    expect(await b.engine.sync()).toMatchObject({
      status: 'error',
      message: expect.stringMatching(/did not return/),
    });
    for (const [k, v] of saved) forge.blobs.set(k, v);
    expect(await b.engine.sync()).toMatchObject({ status: 'ok', pulled: 1 });
  });
});

describe('files that cannot be used are kept, never applied or deleted', () => {
  it('keeps garbage, non-JSON, relocated and future-schema files', async () => {
    const forge = initializedForge();
    const keys = await repoKeys();
    const a = await device(forge, 1);
    const ids = [
      '01J9ZZZZZZZZZZZZZZZZZZZZZ1',
      '01J9ZZZZZZZZZZZZZZZZZZZZZ2',
      '01J9ZZZZZZZZZZZZZZZZZZZZZ3',
      '01J9ZZZZZZZZZZZZZZZZZZZZZ4',
      '01J9ZZZZZZZZZZZZZZZZZZZZZ5',
    ];
    const [garbage, notJson, relocated, future] = ids.map((id) => recordPath(keys, id)) as [
      string,
      string,
      string,
      string,
    ];
    const enc = (id: string, value: unknown) =>
      encryptRecord(
        keys,
        id,
        new TextEncoder().encode(typeof value === 'string' ? value : JSON.stringify(value)),
      );
    const envelope = (id: string, schema: number) => ({
      id,
      type: 'note',
      schema,
      hlc: '2026-10-10T00:00:00.000Z-0000-x',
      fieldHlc: {},
      deletedAt: null,
      createdAt: '2026-10-10T00:00:00.000Z',
      data: note('n'),
    });
    forge.commit(forge.head, [
      { path: garbage, content: 'LMR1.not-really' },
      { path: notJson, content: enc(ids[1] ?? '', 'not json') },
      // Encrypted for this path, but the id inside belongs elsewhere.
      { path: relocated, content: enc(ids[2] ?? '', envelope(ids[0] ?? '', 1)) },
      { path: future, content: enc(ids[3] ?? '', envelope(ids[3] ?? '', 99)) },
      { path: recordPath(keys, ids[4] ?? ''), content: enc(ids[4] ?? '', 42) },
    ]);
    expect(await a.engine.sync()).toMatchObject({ status: 'ok', pulled: 0, kept: 5 });
    expect((await a.db.keptFiles()).map((k) => [k.path, k.reason]).sort()).toEqual(
      [
        [garbage, 'decryptFailed'],
        [notJson, 'notJson'],
        [relocated, 'wrongPath'],
        [future, 'futureSchema'],
        [recordPath(keys, ids[4] ?? ''), 'wrongPath'],
      ].sort(),
    );
    expect(await a.db.list('note')).toEqual([]);
    // Fixing a file (e.g. a newer client rewrote it) un-keeps it.
    forge.commit(forge.head, [
      { path: future, content: enc(ids[3] ?? '', envelope(ids[3] ?? '', 1)) },
    ]);
    expect(await a.engine.sync()).toMatchObject({ pulled: 1 });
    expect((await a.db.keptFiles()).map((k) => k.path)).not.toContain(future);
  });

  it('does not overwrite a local row it cannot read', async () => {
    const forge = initializedForge();
    const a = await device(forge, 1);
    const b = await device(forge, 2);
    const n = await a.db.create('note', note('x'));
    await a.engine.sync();
    await b.engine.sync();
    // Make b's copy unreadable (as after a downgrade), then change it remotely.
    await b.driver.run('UPDATE ent_note SET schema = 99 WHERE id = ?', [n.id]);
    a.clock.now += 1;
    await a.db.update('note', n.id, { title: 'y' });
    await a.engine.sync();
    expect(await b.engine.sync()).toMatchObject({ kept: 1 });
    expect((await b.db.keptFiles())[0]?.reason).toBe('localUndecodable');
  });

  it('forgets remote files that disappear, without touching local records', async () => {
    const forge = initializedForge();
    const a = await device(forge, 1);
    const n = await a.db.create('note', note('x'));
    await a.engine.sync();
    const keys = await repoKeys();
    forge.commit(forge.head, [{ path: recordPath(keys, n.id), delete: true }]);
    expect(await a.engine.sync()).toMatchObject({ status: 'ok', pulled: 0 });
    expect(await a.db.get('note', n.id)).not.toBeNull();
    // Deleting the last record empties r/ entirely.
    expect([...forge.files().keys()]).toEqual(['lm.json']);
    const snapshot = await a.db.syncTransaction((tx) => tx.remote());
    expect([...snapshot.keys()]).toEqual([]);
  });

  it('forgets one removed file in a directory that still has others', async () => {
    const forge = initializedForge();
    const keys = await repoKeys();
    const a = await device(forge, 1);
    // Two ids whose paths share the r/<s1>/ directory.
    const ids: string[] = [];
    for (let i = 0; ids.length < 2 && i < 5000; i++) {
      const id = `01J9ZZZZZZZZZZZZZZZZZ${String(i).padStart(5, '0')}`;
      if (recordPath(keys, id).startsWith(ids[0] ? recordPath(keys, ids[0]).slice(0, 4) : ''))
        ids.push(id);
    }
    for (const id of ids) await a.db.create('note', note(id), { id });
    await a.engine.sync();
    await a.engine.sync(); // walk once so the snapshot knows the directories
    const gone = recordPath(keys, ids[1] ?? '');
    forge.commit(forge.head, [{ path: gone, delete: true }]);
    await a.engine.sync();
    const snapshot = await a.db.syncTransaction((tx) => tx.remote());
    expect(snapshot.has(gone)).toBe(false);
    expect(snapshot.has(recordPath(keys, ids[0] ?? ''))).toBe(true);
  });
});
