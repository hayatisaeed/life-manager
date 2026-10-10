// One contract suite for every SyncTransport (STATUS handoff, SYNC.md §7): the
// fake forge, the GitHub and GitLab transports against their emulators, and
// (opt-in) against real repos. A real transport must behave like FakeForge.
import { expect, it } from 'vitest';
import { gitBlobSha } from '../git-sha';
import type { CommitResult, CommitSha, SyncTransport } from '../transport';

export interface ContractForge {
  /** A new transport on the shared repo: a second call is a second device. */
  transport(): SyncTransport;
  /** 'branch' (GitHub, the fake) or 'perFile' (GitLab). */
  cas: 'branch' | 'perFile';
  /** The repo has no commits yet. Real-repo runs use a scratch branch with history. */
  startsEmpty: boolean;
}

const enc = (s: string) => new TextEncoder().encode(s);

function landed(result: CommitResult): CommitSha {
  if (typeof result !== 'string')
    throw new Error(`expected a plain commit, got ${JSON.stringify(result)}`);
  return result;
}

export function transportContract(setup: () => Promise<ContractForge>): void {
  // Each test writes under its own directory, so real-repo runs don't collide.
  let n = 0;
  const dir = () => `t${Date.now().toString(36)}${String(n++)}`;

  async function start(): Promise<{ forge: ContractForge; t: SyncTransport; head: CommitSha }> {
    const forge = await setup();
    const t = forge.transport();
    let head = await t.getHead();
    if (head === null) head = landed(await t.commit(null, [{ path: 'lm.json', content: '{}' }]));
    return { forge, t, head };
  }

  it('reports an empty repo and takes exactly one first commit', async () => {
    const forge = await setup();
    if (!forge.startsEmpty) return;
    const a = forge.transport();
    const b = forge.transport();
    expect(await a.getHead()).toBeNull();
    const first = landed(await a.commit(null, [{ path: 'lm.json', content: '{"v":1}' }]));
    expect(await b.getHead()).toBe(first);
    // A second device setting up the same repo at the same time loses.
    expect(await b.commit(null, [{ path: 'lm.json', content: '{"v":2}' }])).toBe('conflict');
    expect(await b.readFile('lm.json', first)).toEqual(enc('{"v":1}'));
  });

  it('commits text and binary files, lists them with git SHAs and reads them back', async () => {
    const { t, head } = await start();
    const d = dir();
    const binary = new Uint8Array([0x4c, 0x4d, 0x42, 0x31, 0, 255, 1, 2, 0, 9]);
    const c = landed(
      await t.commit(head, [
        { path: `${d}/ab/cd/one.lmr`, content: 'LMR1.one' },
        { path: `${d}/ab/two.lmr`, content: 'LMR1.two' },
        { path: `${d}/b.lmb`, content: binary },
      ]),
    );
    expect(await t.getHead()).toBe(c);

    const root = await t.listTree(c, '', undefined);
    const top = root.find((e) => e.name === d);
    expect(top?.type).toBe('tree');
    const listing = await t.listTree(c, d, top?.sha);
    expect(listing.map((e) => [e.name, e.type])).toEqual([
      ['ab', 'tree'],
      ['b.lmb', 'blob'],
    ]);
    expect(listing[1]?.sha).toBe(gitBlobSha(binary));
    const ab = await t.listTree(c, `${d}/ab`, listing[0]?.sha);
    expect(ab.map((e) => e.name)).toEqual(['cd', 'two.lmr']);
    // The engine computes pushed SHAs locally (SYNC.md §5); they must match.
    expect(ab[1]?.sha).toBe(gitBlobSha(enc('LMR1.two')));
    // Path-only listing (no SHA) works too.
    expect((await t.listTree(c, `${d}/ab/cd`, undefined)).map((e) => e.sha)).toEqual([
      gitBlobSha(enc('LMR1.one')),
    ]);
    expect(await t.listTree(c, `${d}/nothing`, undefined)).toEqual([]);

    const blobs = await t.readBlobs([
      { path: `${d}/ab/two.lmr`, sha: gitBlobSha(enc('LMR1.two')) },
      { path: `${d}/ab/cd/one.lmr`, sha: gitBlobSha(enc('LMR1.one')) },
      { path: `${d}/b.lmb`, sha: gitBlobSha(binary) },
      { path: `${d}/gone.lmr`, sha: gitBlobSha(enc('never pushed')) },
    ]);
    expect(blobs.get(`${d}/ab/two.lmr`)).toEqual(enc('LMR1.two'));
    expect(blobs.get(`${d}/ab/cd/one.lmr`)).toEqual(enc('LMR1.one'));
    expect(blobs.get(`${d}/b.lmb`)).toEqual(binary);
    expect(blobs.has(`${d}/gone.lmr`)).toBe(false);

    expect(await t.readFile(`${d}/ab/two.lmr`, c)).toEqual(enc('LMR1.two'));
    expect(await t.readFile(`${d}/missing.lmr`, c)).toBeNull();
    // Reading at an older commit sees the older state.
    expect(await t.readFile(`${d}/ab/two.lmr`, head)).toBeNull();
    const limit = t.rateLimit();
    expect(limit).toHaveProperty('remaining');
    expect(limit).toHaveProperty('resetAt');
  });

  it('changes a tree SHA exactly when something below it changes, and deletes files', async () => {
    const { t, head } = await start();
    const d = dir();
    const c1 = landed(
      await t.commit(head, [
        { path: `${d}/a/1.lmr`, content: 'x' },
        { path: `${d}/b/2.lmr`, content: 'y' },
      ]),
    );
    const c2 = landed(await t.commit(c1, [{ path: `${d}/a/1.lmr`, content: 'z' }]));
    const sha = async (c: CommitSha, name: string) =>
      (await t.listTree(c, d, undefined)).find((e) => e.name === name)?.sha;
    expect(await sha(c1, 'b')).toBe(await sha(c2, 'b'));
    expect(await sha(c1, 'a')).not.toBe(await sha(c2, 'a'));

    const c3 = landed(await t.commit(c2, [{ path: `${d}/a/1.lmr`, delete: true }]));
    expect(await t.readFile(`${d}/a/1.lmr`, c3)).toBeNull();
    // The emptied directory disappears (or lists as empty).
    expect((await t.listTree(c3, d, undefined)).map((e) => e.name)).toEqual(['b']);
    expect(await t.listTree(c3, `${d}/a`, undefined)).toEqual([]);
  });

  it('refuses a commit when a file it changes moved since its parent', async () => {
    const { forge, t, head } = await start();
    const other = forge.transport();
    const path = `${dir()}/same.lmr`;
    const base = landed(await t.commit(head, [{ path, content: 'base' }]));
    // Two devices edit the same record from the same parent: the second loses.
    landed(await t.commit(base, [{ path, content: 'mine' }]));
    expect(await other.commit(base, [{ path, content: 'theirs' }])).toBe('conflict');
    // A device that has never seen the file can't create it either.
    expect(await other.commit(head, [{ path, content: 'new' }])).toBe('conflict');
    const now = await other.getHead();
    expect(now).not.toBeNull();
    expect(await other.readFile(path, now as CommitSha)).toEqual(enc('mine'));
  });

  it('handles a commit on an old parent that touches only other files per its CAS kind', async () => {
    const { forge, t, head } = await start();
    const other = forge.transport();
    const d = dir();
    const moved = landed(await t.commit(head, [{ path: `${d}/a.lmr`, content: 'a' }]));
    const result = await other.commit(head, [{ path: `${d}/b.lmr`, content: 'b' }]);
    if (forge.cas === 'branch') {
      expect(result).toBe('conflict');
      expect(await t.getHead()).toBe(moved);
      return;
    }
    // GitLab: it lands on top of the moved head, and says so.
    expect(result).toEqual({ sha: expect.any(String) as string, rebased: true });
    const now = (await t.getHead()) as CommitSha;
    expect(await t.readFile(`${d}/a.lmr`, now)).toEqual(enc('a'));
    expect(await t.readFile(`${d}/b.lmr`, now)).toEqual(enc('b'));
  });
}
