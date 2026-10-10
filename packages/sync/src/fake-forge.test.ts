import { describe, expect, it } from 'vitest';
import { SyncEngine } from './engine';
import { FakeForge } from './fake-forge';
import { gitBlobSha } from './git-sha';
import type { CommitResult } from './transport';
import { device, initializedForge, note, repoKeys } from './test-support/devices';

/** A commit that must have landed directly on its parent. */
function landed(result: CommitResult): string {
  if (typeof result !== 'string')
    throw new Error(`expected a plain commit, got ${JSON.stringify(result)}`);
  return result;
}

describe('fake forge', () => {
  it('commits with compare-and-swap and reads files back', async () => {
    const forge = new FakeForge();
    const t = forge.transport();
    expect(await t.getHead()).toBeNull();
    const c1 = landed(
      await t.commit(null, [
        { path: 'lm.json', content: '{}' },
        { path: 'b/x', content: new Uint8Array([1, 2]) },
      ]),
    );
    expect(await t.commit(null, [])).toBe('conflict');
    expect(await t.readFile('lm.json', c1)).toEqual(new TextEncoder().encode('{}'));
    expect(await t.readFile('missing', c1)).toBeNull();
    expect(await t.readFile('lm.json', 'no-such-commit')).toBeNull();
    const c2 = landed(await t.commit(c1, [{ path: 'b/x', delete: true }]));
    expect([...forge.files(c2).keys()]).toEqual(['lm.json']);
    expect([...forge.files(null).keys()]).toEqual([]);
    expect(await t.listTree(c2, 'b', undefined)).toEqual([]);
    expect(t.rateLimit()).toEqual({ remaining: null, resetAt: null });
    expect(gitBlobSha(new Uint8Array())).toBe('e69de29bb2d1d6434b8b29ae775ad8c2e48c5391');
  });

  it('changes a tree SHA exactly when something below it changes', async () => {
    const forge = new FakeForge();
    const t = forge.transport();
    const c1 = landed(
      await t.commit(null, [
        { path: 'r/a/1', content: 'x' },
        { path: 'r/b/2', content: 'y' },
      ]),
    );
    const c2 = landed(await t.commit(c1, [{ path: 'r/a/1', content: 'z' }]));
    const sha = async (c: string, dir: string, name: string) =>
      (await t.listTree(c, dir, undefined)).find((e) => e.name === name)?.sha;
    expect(await sha(c1, 'r', 'b')).toBe(await sha(c2, 'r', 'b'));
    expect(await sha(c1, 'r', 'a')).not.toBe(await sha(c2, 'r', 'a'));
    expect(await sha(c1, '', 'r')).not.toBe(await sha(c2, '', 'r'));
  });
});

describe('engine defaults', () => {
  it('uses real timers and Date.now when none are injected', async () => {
    const forge = initializedForge();
    const a = await device(forge, 1);
    await a.db.create('note', note('x'));
    const transport = forge.transport();
    let raced = false;
    transport.hooks.beforeCommit = () => {
      if (!raced) forge.commit(forge.head, [{ path: 'other', content: 'o' }]);
      raced = true;
    };
    const engine = new SyncEngine({
      db: a.db,
      transport,
      keys: await repoKeys(),
      rng: () => 0,
      backoffMs: 1,
    });
    expect(await engine.sync()).toMatchObject({ status: 'ok', pushed: 1 });
  });
});
