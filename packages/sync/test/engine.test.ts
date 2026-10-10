import { describe, expect, it } from 'vitest';
import { CONFLICT_START } from '@lm/core';
import { Keys, encodeRecord, recordPath, sodiumReady } from '@lm/crypto';
import {
  FakeForge,
  FakeTransport,
  RateLimitedError,
  SyncAuthError,
  blobRefsIn,
  gitBlobSha,
} from '../src';
import { makeDevice, seededForge, snapshot, task } from './helpers';

describe('sync engine', () => {
  it('pushes local records and pulls them on another device', async () => {
    const forge = await seededForge();
    const a = await makeDevice(forge, 1);
    const b = await makeDevice(forge, 2);
    const t = await a.store.create('task', task('Call mom', { tags: ['family'] }));
    const r1 = await a.engine.sync();
    expect(r1.pushed).toBe(1);
    expect(await a.store.dirty()).toEqual([]);
    const r2 = await b.engine.sync();
    expect(r2.pulled).toBe(1);
    expect((await b.store.get('task', t.id))?.data.title).toBe('Call mom');
    // Nothing in the repo reveals the plaintext.
    const files = forge.filesAt(forge.head!);
    for (const [path, f] of files) {
      expect(path).not.toContain(t.id);
      expect(new TextDecoder().decode(f.bytes)).not.toContain('Call mom');
    }
    expect(a.engine.status.phase).toBe('idle');
  });

  it('merges concurrent edits field by field', async () => {
    const forge = await seededForge();
    const a = await makeDevice(forge, 1);
    const b = await makeDevice(forge, 2);
    const t = await a.store.create('task', task('x', { notes: 'l1\nl2\nl3' }));
    await a.engine.sync();
    await b.engine.sync();
    a.env.advance(1000);
    b.env.advance(2000);
    await a.store.update('task', t.id, { title: 'from A', notes: 'L1\nl2\nl3', tags: ['a'] });
    await b.store.update('task', t.id, { priority: 1, notes: 'l1\nl2\nL3', tags: ['b'] });
    await a.engine.sync();
    const rb = await b.engine.sync();
    expect(rb.pushed).toBe(1);
    await a.engine.sync();
    const ta = (await a.store.get('task', t.id))!;
    expect(ta.data).toMatchObject({
      title: 'from A',
      priority: 1,
      notes: 'L1\nl2\nL3',
      tags: ['a', 'b'],
    });
    expect(await snapshot(a)).toBe(await snapshot(b));
  });

  it('keeps both versions of overlapping text edits and an edit beats a delete', async () => {
    const forge = await seededForge();
    const a = await makeDevice(forge, 1);
    const b = await makeDevice(forge, 2);
    const n = await a.store.create('note', {
      title: 'n',
      content: 'hello',
      tags: [],
      pinned: false,
    });
    const t = await a.store.create('task', task('t'));
    await a.engine.sync();
    await b.engine.sync();
    await a.store.update('note', n.id, { content: 'hello from A' });
    await b.store.update('note', n.id, { content: 'hello from B' });
    await a.store.remove(t.id);
    await b.store.update('task', t.id, { title: 'still needed' });
    await a.engine.sync();
    const r = await b.engine.sync();
    expect(r.conflicts).toBe(1);
    expect(r.restored).toBe(1);
    await a.engine.sync();
    const note = (await a.store.get('note', n.id))!;
    expect(note.data.content).toContain(CONFLICT_START);
    expect(note.data.content).toContain('hello from A');
    expect(note.data.content).toContain('hello from B');
    expect((note.data as Record<string, unknown>)['hasConflict']).toBe(true);
    expect((await a.store.get('task', t.id))?.data.title).toBe('still needed');
    expect(b.engine.status.restored).toBe(1);
  });

  it('retries on CAS conflict', async () => {
    const forge = await seededForge();
    const a = await makeDevice(forge, 1);
    const b = await makeDevice(forge, 2);
    await a.store.create('task', task('a'));
    await b.store.create('task', task('b'));
    let raced = false;
    forge.beforeOp = async (op) => {
      if (op === 'commit' && !raced) {
        raced = true;
        forge.beforeOp = null;
        await b.engine.sync(); // b sneaks in a commit right before a's
      }
    };
    const r = await a.engine.sync();
    expect(r.attempts).toBe(2);
    await b.engine.sync();
    expect(await a.store.count('task')).toBe(2);
    expect(await snapshot(a)).toBe(await snapshot(b));
  });

  it('gives up after max attempts', async () => {
    const forge = await seededForge();
    const a = await makeDevice(forge, 1, { maxAttempts: 2 });
    await a.store.create('task', task('a'));
    const other = new FakeTransport(forge);
    forge.beforeOp = async (op) => {
      if (op === 'commit') {
        forge.beforeOp = null;
        await other.commit(forge.head, [
          { action: 'upsert', path: 'x', content: String(Math.random()), exists: false },
        ]);
        forge.beforeOp = async (o) => {
          if (o === 'commit') {
            const save = forge.beforeOp;
            forge.beforeOp = null;
            await other.commit(forge.head, [
              { action: 'upsert', path: 'x', content: String(Math.random()), exists: true },
            ]);
            forge.beforeOp = save;
          }
        };
      }
    };
    await expect(a.engine.sync()).rejects.toThrow('Too many');
    expect(a.engine.status.phase).toBe('error');
  });

  it('local edits during a sync are not lost', async () => {
    const forge = await seededForge();
    const a = await makeDevice(forge, 1);
    const t = await a.store.create('task', task('v1'));
    forge.beforeOp = async (op) => {
      if (op === 'commit') {
        forge.beforeOp = null;
        await a.store.update('task', t.id, { title: 'v2' });
      }
    };
    await a.engine.sync();
    expect((await a.store.dirty()).map((d) => d.id)).toEqual([t.id]);
    await a.engine.sync();
    expect(await a.store.dirty()).toEqual([]);
    const b = await makeDevice(forge, 2);
    await b.engine.sync();
    expect((await b.store.get('task', t.id))?.data.title).toBe('v2');
  });

  it('skips and reports undecryptable or relocated files without deleting anything', async () => {
    await sodiumReady();
    const forge = await seededForge();
    const a = await makeDevice(forge, 1);
    const bad = new Keys(new Uint8Array(32).fill(1));
    const w = new FakeTransport(forge);
    const goodKeys = a.keys;
    // foreign key, garbage, a relocated (valid but wrong path) record, and invalid JSON
    const valid = JSON.stringify({
      id: 'R1',
      type: 'task',
      schema: 1,
      hlc: 'h',
      fieldHlc: {},
      deletedAt: null,
      createdAt: 'c',
      data: task('t'),
    });
    await w.commit(forge.head, [
      {
        action: 'upsert',
        path: recordPath(bad, 'X'),
        content: encodeRecord(bad, 'X', '{}'),
        exists: false,
      },
      { action: 'upsert', path: recordPath(goodKeys, 'Y'), content: 'LMR1.garbage', exists: false },
      {
        action: 'upsert',
        path: recordPath(goodKeys, 'Z'),
        content: encodeRecord(goodKeys, 'Z', valid),
        exists: false,
      },
      {
        action: 'upsert',
        path: recordPath(goodKeys, 'J'),
        content: encodeRecord(goodKeys, 'J', '{not json'),
        exists: false,
      },
      {
        action: 'upsert',
        path: recordPath(goodKeys, 'K'),
        content: encodeRecord(goodKeys, 'K', '{"id":"K"}'),
        exists: false,
      },
      { action: 'upsert', path: 'README.md', content: 'hi', exists: false },
    ]);
    const r = await a.engine.sync();
    expect(r.problems).toBe(5);
    const probs = await a.state.problems();
    expect(probs.map((p) => p.reason).sort()).toEqual(
      ['auth-failed', 'bad-format', 'bad-json', 'invalid-envelope', 'relocated'].sort(),
    );
    expect(await a.store.count('task')).toBe(0);
    // Files stay in the repo.
    expect(forge.filesAt(forge.head!).size).toBe(7);
    // Unchanged problems aren't refetched each cycle, but can be retried.
    expect((await a.engine.sync()).problems).toBe(0);
    await a.engine.retryProblems();
    expect((await a.engine.sync()).problems).toBe(5);
  });

  it('keeps records of unknown types and newer schemas', async () => {
    const forge = await seededForge();
    const a = await makeDevice(forge, 1);
    const w = new FakeTransport(forge);
    const mk = (id: string, type: string, schema: number) =>
      JSON.stringify({
        id,
        type,
        schema,
        hlc: '2026-10-09T10:00:00.000Z-0000-zz',
        fieldHlc: {},
        deletedAt: null,
        createdAt: 'c',
        data: { x: 1 },
      });
    await w.commit(forge.head, [
      {
        action: 'upsert',
        path: recordPath(a.keys, 'U1'),
        content: encodeRecord(a.keys, 'U1', mk('U1', 'hologram', 1)),
        exists: false,
      },
      {
        action: 'upsert',
        path: recordPath(a.keys, 'U2'),
        content: encodeRecord(a.keys, 'U2', mk('U2', 'task', 7)),
        exists: false,
      },
    ]);
    const r = await a.engine.sync();
    expect(r.newerSchema).toBe(true);
    expect(a.engine.status.newerSchema).toBe(true);
    expect((await a.store.getEnvelope('U1'))?.type).toBe('hologram');
    expect((await a.store.getEnvelope('U2'))?.schema).toBe(7);
  });

  it('syncs attachments and downloads referenced blobs', async () => {
    const forge = await seededForge();
    const a = await makeDevice(forge, 1);
    const b = await makeDevice(forge, 2);
    const ref = await a.blobs.put(new Uint8Array([1, 2, 3, 4]), 'image/png', 'scan.png');
    await a.store.create('document', {
      kind: 'passport',
      title: 'Passport',
      files: [ref],
      remindDaysBefore: [90],
      notes: '',
    });
    await a.engine.sync();
    expect(await a.blobs.state(ref.hash)).toBe('synced');
    await b.engine.sync();
    expect(await b.blobs.get(ref.hash)).toEqual(new Uint8Array([1, 2, 3, 4]));
    // A second put of the same content is already on the forge → marked synced without a commit.
    expect(blobRefsIn({ a: [{ b: ref }] })).toEqual([ref]);
  });

  it('uses the Merkle walk when recursive listing is truncated, and is cheap when nothing changed', async () => {
    const forge = await seededForge({ truncateRecursive: true });
    const a = await makeDevice(forge, 1);
    const b = await makeDevice(forge, 2);
    for (let i = 0; i < 30; i++) await a.store.create('task', task(`t${i}`));
    await a.engine.sync();
    await b.engine.sync();
    expect(await b.store.count('task')).toBe(30);
    // One more change: b's walk only re-lists the changed path.
    const one = await a.store.create('task', task('new'));
    await a.engine.sync();
    forge.calls = 0;
    const r = await b.engine.sync();
    expect(r.pulled).toBe(1);
    expect(forge.calls).toBeLessThanOrEqual(8);
    expect(await b.store.get('task', one.id)).not.toBeNull();
    forge.calls = 0;
    await b.engine.sync();
    expect(forge.calls).toBe(1); // only getHead
  });

  it('works with GitLab-style per-file CAS (interleaved commits)', async () => {
    const forge = await seededForge({ mode: 'gitlab' });
    const a = await makeDevice(forge, 1);
    const b = await makeDevice(forge, 2);
    const t = await a.store.create('task', task('shared'));
    await a.engine.sync();
    await b.engine.sync();
    // b commits a different file between a's getHead and commit → accepted (no overlap)
    await b.store.create('task', task('other'));
    let once = false;
    forge.beforeOp = async (op) => {
      if (op === 'commit' && !once) {
        once = true;
        forge.beforeOp = null;
        await b.engine.sync();
      }
    };
    await a.store.update('task', t.id, { title: 'edited by a' });
    const r = await a.engine.sync();
    expect(r.attempts).toBe(1);
    await a.engine.sync(); // picks up b's interleaved commit
    expect(await a.store.count('task')).toBe(2);
    // b updates the same file between a's getHead and commit → stale last_commit_id → conflict → refetch → merge
    await a.store.update('task', t.id, { priority: 1 });
    await b.engine.sync();
    forge.beforeOp = async (op) => {
      if (op === 'commit') {
        forge.beforeOp = null;
        await b.store.update('task', t.id, { notes: 'from b' });
        await b.engine.sync();
      }
    };
    const r2 = await a.engine.sync();
    expect(r2.attempts).toBe(2);
    await b.engine.sync();
    expect(await snapshot(a)).toBe(await snapshot(b));
    expect((await b.store.get('task', t.id))?.data).toMatchObject({
      priority: 1,
      notes: 'from b',
      title: 'edited by a',
    });
  });

  it('survives compaction (orphan commit with the same files)', async () => {
    const forge = await seededForge();
    const a = await makeDevice(forge, 1);
    const b = await makeDevice(forge, 2);
    await a.store.create('task', task('x'));
    await a.engine.sync();
    await b.engine.sync();
    await forge.compact(() => true);
    forge.calls = 0;
    const r = await b.engine.sync();
    expect(r.pulled).toBe(0);
    await b.store.create('task', task('y'));
    await b.engine.sync();
    await a.engine.sync();
    expect(await a.store.count('task')).toBe(2);
  });

  it('full resync re-pushes local records', async () => {
    const forge = await seededForge();
    const a = await makeDevice(forge, 1);
    await a.store.create('task', task('x'));
    await a.engine.sync();
    await a.engine.fullResync();
    expect(await a.store.dirty()).toHaveLength(1);
    await a.engine.sync();
    expect(await a.store.dirty()).toHaveLength(0);
  });

  it('reports auth, rate-limit, offline and empty-repo states', async () => {
    const forge = await seededForge();
    const a = await makeDevice(forge, 1);
    const seen: string[] = [];
    a.engine.onStatus((s) => seen.push(s.phase));
    forge.beforeOp = () => {
      throw new SyncAuthError();
    };
    await expect(a.engine.sync()).rejects.toThrow();
    expect(a.engine.status.phase).toBe('paused');
    forge.beforeOp = () => {
      throw new RateLimitedError(1);
    };
    await expect(a.engine.sync()).rejects.toThrow();
    expect(a.engine.status.phase).toBe('rateLimited');
    forge.beforeOp = () => {
      const e = new Error('fetch failed');
      e.name = 'HttpError';
      throw e;
    };
    await expect(a.engine.sync()).rejects.toThrow();
    expect(a.engine.status.phase).toBe('offline');
    forge.beforeOp = null;
    const empty = await makeDevice(new FakeForge(), 3);
    await expect(empty.engine.sync()).rejects.toThrow('empty');
    expect(seen).toContain('syncing');
  });

  it('coalesces concurrent sync calls', async () => {
    const forge = await seededForge();
    const a = await makeDevice(forge, 1);
    const [r1, r2] = await Promise.all([a.engine.sync(), a.engine.sync()]);
    expect(r1).toBe(r2);
  });

  it('gitBlobSha matches git hash-object', async () => {
    // `printf 'hello\n' | git hash-object --stdin`
    expect(await gitBlobSha('hello\n')).toBe('ce013625030ba8dba906f756967f9e9ca394464a');
  });
});
