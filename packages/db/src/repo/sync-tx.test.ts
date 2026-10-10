import { describe, expect, it } from 'vitest';
import { openMemoryDriver } from '../driver/wasm';
import { fakeClock, seededRng } from '../test-support/repository-suite';
import { LmDatabase } from './database';

const note = { title: 'n', content: 'body', tags: [], pinned: false };

async function open() {
  const driver = await openMemoryDriver();
  const db = await LmDatabase.open({ driver, clock: fakeClock(), rng: seededRng() });
  return { db, driver };
}

describe('syncTransaction', () => {
  it('writes remote records without stamping or queuing them, and notifies once', async () => {
    const { db } = await open();
    const local = await db.create('note', note);
    const seen: string[][] = [];
    db.subscribe(['note'], (t) => seen.push([...t]));
    const remote = {
      ...local,
      id: '01J9ZZZZZZZZZZZZZZZZZZZZZZ',
      hlc: '2030-01-01T00:00:00.000Z-0000-other',
    };
    await db.syncTransaction(async (tx) => {
      expect(await tx.get('note', remote.id)).toEqual({ status: 'missing' });
      tx.receive(remote.hlc);
      await tx.put(remote, { dirty: false });
      await tx.setBase(remote);
      expect(await tx.get('note', remote.id)).toEqual({ status: 'ok', record: remote });
      expect(await tx.base(remote.id)).toEqual(remote);
      expect(await tx.base('nope')).toBeNull();
    });
    await new Promise((r) => setTimeout(r, 0));
    expect(seen).toEqual([['note']]);
    expect((await db.changeLog()).map((c) => c.recordId)).toEqual([local.id]);
    // The clock moved past the remote HLC, so the next local write sorts after it.
    const next = await db.create('note', note);
    expect(next.hlc > remote.hlc).toBe(true);
    expect((await db.search('body')).length).toBe(3);
  });

  it('queues dirty puts and clears entries only at the pushed HLC', async () => {
    const { db } = await open();
    const r = await db.create('note', note);
    await db.syncTransaction(async (tx) => {
      expect(await tx.clearDirty(r.id, 'stale')).toBe(false);
      expect(await tx.clearDirty(r.id, r.hlc)).toBe(true);
      expect(await tx.changeLog()).toEqual([]);
      await tx.put({ ...r, hlc: r.hlc }, { dirty: true });
      expect((await tx.changeLog()).map((c) => c.recordId)).toEqual([r.id]);
    });
  });

  it('stores remote snapshots, kept files and metadata', async () => {
    const { db } = await open();
    await db.syncTransaction(async (tx) => {
      await tx.setRemote('r', 'aaa', 'tree');
      await tx.setRemote('r/00/00/x.lmr', 'bbb', 'blob');
      await tx.deleteRemote('r');
      expect([...(await tx.remote())]).toEqual([['r/00/00/x.lmr', { sha: 'bbb', kind: 'blob' }]]);
      await tx.keep({ path: 'r/1', blobSha: 's1', reason: 'decryptFailed', issues: ['x'] });
      await tx.keep({
        path: 'r/2',
        blobSha: 's2',
        recordId: 'id',
        reason: 'futureSchema',
        raw: { a: 1 },
        issues: [],
      });
      await tx.unkeep('r/1');
      expect(await tx.getMeta('lastSyncedCommit')).toBeNull();
      await tx.setMeta('lastSyncedCommit', 'c1');
      expect(await tx.getMeta('lastSyncedCommit')).toBe('c1');
    });
    expect(await db.keptFiles()).toEqual([
      {
        path: 'r/2',
        blobSha: 's2',
        recordId: 'id',
        reason: 'futureSchema',
        issues: [],
        seenAt: '2026-10-10T00:00:00.000Z',
      },
    ]);
  });

  it('reports undecodable rows and rolls back on error', async () => {
    const { db, driver } = await open();
    const r = await db.create('note', note);
    await driver.run('UPDATE ent_note SET schema = 99 WHERE id = ?', [r.id]);
    await expect(
      db.syncTransaction(async (tx) => {
        expect(await tx.get('note', r.id)).toEqual({ status: 'undecodable' });
        await tx.setMeta('k', 'v');
        throw new Error('stop');
      }),
    ).rejects.toThrow('stop');
    await db.syncTransaction(async (tx) => {
      expect(await tx.getMeta('k')).toBeNull();
    });
  });
});
