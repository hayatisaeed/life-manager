import { describe, expect, it } from 'vitest';
import { GitLabTransport, type GitLabTransportOptions } from './gitlab';
import { ForgeHttpError } from './http';
import { deviceOn, note } from './test-support/devices';
import { GitLabEmulator } from './test-support/gitlab-emulator';
import { AuthError, RateLimitedError, type CommitSha } from './transport';

const NOW = Date.UTC(2026, 9, 10);

function setup() {
  const gl = new GitLabEmulator();
  const make = (more: Partial<GitLabTransportOptions> = {}) =>
    new GitLabTransport({
      project: gl.project,
      branch: gl.branch,
      token: gl.token,
      fetch: gl.fetch,
      now: () => NOW,
      ...more,
    });
  return { gl, t: make(), make };
}

async function initialized() {
  const s = setup();
  const head = await s.t.commit(null, [{ path: 'lm.json', content: '{"format":"life-manager"}' }]);
  return { ...s, head: head as CommitSha };
}

const reply = (status: number, body: unknown = {}, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers });
const lookups = (gl: GitLabEmulator) =>
  gl.requests.filter((r) => r.method === 'GET' && /\/files\/[^/]+$/.test(r.url.pathname)).length;

describe('GitLab transport', () => {
  it('syncs two devices through the engine, picking up commits a rebased push skipped', async () => {
    const { gl, make } = await initialized();
    const a = await deviceOn(make(), 1);
    const b = await deviceOn(make(), 2);
    const na = await a.db.create('note', note('from a'));
    const nb = await b.db.create('note', note('from b'));
    // a pushes while b is between its pull and its commit. b's commit touches
    // a different file, so GitLab puts it on top of a's: no conflict.
    let raced = false;
    gl.intercept = async (req) => {
      if (!raced && req.method === 'POST') {
        raced = true;
        await a.engine.sync();
      }
      return undefined;
    };
    expect(await b.engine.sync()).toMatchObject({ status: 'ok', pushed: 1, pulled: 0 });
    expect(b.sleeps).toEqual([]);
    // b hasn't seen a's note yet; its next cycle walks the skipped commit.
    expect(await b.db.get('note', na.id)).toBeNull();
    expect(await b.engine.sync()).toMatchObject({ status: 'ok', pulled: 1, pushed: 0 });
    expect((await b.db.get('note', na.id))?.data.title).toBe('from a');
    expect(await a.engine.sync()).toMatchObject({ status: 'ok', pulled: 1 });
    expect((await a.db.get('note', nb.id))?.data.title).toBe('from b');
    expect(await b.engine.sync()).toMatchObject({ status: 'ok', pulled: 0, pushed: 0 });

    const commits = gl.requests.filter((r) => r.method === 'POST');
    for (const c of commits) {
      expect(c.body).toMatchObject({
        commit_message: 'sync',
        author_name: 'Life Manager',
        author_email: 'noreply@invalid',
      });
    }
  });

  it('edits of the same record conflict, then merge through the engine', async () => {
    const { make } = await initialized();
    const a = await deviceOn(make(), 1);
    const b = await deviceOn(make(), 2);
    const n = await a.db.create('note', note('shared', 'one'));
    await a.engine.sync();
    await b.engine.sync();
    a.clock.now += 1000;
    b.clock.now += 2000;
    await a.db.update('note', n.id, { title: 'title by a' });
    await b.db.update('note', n.id, { content: 'one\ntwo' });
    await a.engine.sync();
    // b's cached last_commit_id for the file is stale: one refused commit,
    // then a fresh lookup, a merge and a push.
    expect(await b.engine.sync()).toMatchObject({ status: 'ok', pulled: 1, pushed: 1 });
    await a.engine.sync();
    for (const d of [a, b]) {
      expect((await d.db.get('note', n.id))?.data).toMatchObject({
        title: 'title by a',
        content: 'one\ntwo',
      });
    }
  });

  it('remembers last_commit_id for files it pushed and drops it after a refusal', async () => {
    const { gl, t, make, head } = await initialized();
    const c1 = (await t.commit(head, [{ path: 'r/a.lmr', content: '1' }])) as CommitSha;
    const before = lookups(gl);
    const c2 = (await t.commit(c1, [{ path: 'r/a.lmr', content: '2' }])) as CommitSha;
    expect(lookups(gl)).toBe(before);
    // Another device changes the file; our cached id is now stale.
    await make().commit(c2, [{ path: 'r/a.lmr', content: 'other' }]);
    expect(await t.commit(c2, [{ path: 'r/a.lmr', content: '3' }])).toBe('conflict');
    const head2 = (await t.getHead()) as CommitSha;
    expect(await t.commit(head2, [{ path: 'r/a.lmr', content: '3' }])).toMatch(/^[0-9a-f]{40}$/);
    // One lookup by the other device (empty cache), one by us after the refusal.
    expect(lookups(gl)).toBe(before + 2);
  });

  it('skips deleting a file that is already gone, and deletes with last_commit_id', async () => {
    const { gl, t, head } = await initialized();
    expect(await t.commit(head, [{ path: 'r/none.lmr', delete: true }])).toBe(head);
    const c1 = (await t.commit(head, [
      { path: 'r/x.lmb', content: new Uint8Array([0, 255]) },
    ])) as CommitSha;
    expect(gl.blobs.get(gl.files().get('r/x.lmb') ?? '')).toEqual(new Uint8Array([0, 255]));
    await t.commit(c1, [{ path: 'r/x.lmb', delete: true }]);
    expect(gl.files().has('r/x.lmb')).toBe(false);
    expect(gl.requests.at(-1)?.body).toMatchObject({
      actions: [{ action: 'delete', file_path: 'r/x.lmb', last_commit_id: c1 }],
    });
  });

  it('pages through large directories', async () => {
    const { t, head } = await initialized();
    const files = Array.from({ length: 230 }, (_, i) => ({
      path: `r/${i.toString(16).padStart(2, '0')}/f.lmr`,
      content: String(i),
    }));
    const c = (await t.commit(head, files)) as CommitSha;
    expect(await t.listTree(c, 'r')).toHaveLength(230);
  });

  it('tells an empty project apart from a missing one', async () => {
    const { t, make } = setup();
    expect(await t.getHead()).toBeNull();
    await expect(make({ project: 'someone/else' }).getHead()).rejects.toBeInstanceOf(
      ForgeHttpError,
    );
  });

  it('maps tokens and rate limits to AuthError and RateLimitedError', async () => {
    const { gl, t, make } = await initialized();
    await expect(make({ token: 'wrong' }).getHead()).rejects.toBeInstanceOf(AuthError);
    gl.intercept = () => reply(403, { message: '403 Forbidden' });
    await expect(t.getHead()).rejects.toBeInstanceOf(AuthError);
    gl.intercept = () => reply(429, {}, { 'retry-after': '30' });
    await expect(t.getHead()).rejects.toEqual(new RateLimitedError(NOW + 30_000));
    gl.intercept = () =>
      reply(403, {}, { 'ratelimit-remaining': '0', 'ratelimit-reset': '1900000000' });
    await expect(t.getHead()).rejects.toEqual(new RateLimitedError(1_900_000_000_000));
    gl.intercept = undefined;
    await t.getHead();
    expect(t.rateLimit()).toEqual({ remaining: 1999, resetAt: 1_900_000_000_000 });
  });

  it('reports a 400 that is not a CAS failure as an error', async () => {
    const { gl, t, head } = await initialized();
    gl.intercept = (req) =>
      req.method === 'POST' ? reply(400, { message: { branch: ['is invalid'] } }) : undefined;
    const err = (await t
      .commit(head, [{ path: 'r/a.lmr', content: 'x' }])
      .catch((e: unknown) => e)) as Error;
    expect(err).toBeInstanceOf(ForgeHttpError);
    expect(err.message).toBe('GitLab POST repository/commits failed with HTTP 400');
    gl.intercept = () => new Response('<html>', { status: 400 });
    await expect(t.commit(head, [{ path: 'r/a.lmr', content: 'x' }])).rejects.toBeInstanceOf(
      ForgeHttpError,
    );
    gl.intercept = () => reply(500);
    await expect(t.readFile('lm.json', head)).rejects.toThrow(
      'GitLab GET repository/files failed with HTTP 500',
    );
  });

  it('reads files and blobs, leaving out missing ones', async () => {
    const { t, head, gl } = await initialized();
    expect(
      new TextDecoder().decode((await t.readFile('lm.json', head)) ?? new Uint8Array()),
    ).toContain('life-manager');
    expect(await t.readFile('nope', head)).toBeNull();
    const sha = gl.files().get('lm.json') ?? '';
    const out = await t.readBlobs([
      { path: 'lm.json', sha },
      { path: 'x', sha: 'f'.repeat(40) },
    ]);
    expect([...out.keys()]).toEqual(['lm.json']);
  });

  it('uses the configured instance URL', async () => {
    const urls: string[] = [];
    const t = new GitLabTransport({
      baseUrl: 'https://git.example.com/',
      project: '42',
      branch: 'main',
      token: 'x',
      fetch: (url) => {
        urls.push(url);
        return Promise.resolve(reply(200, { commit: { id: 'abc' } }));
      },
    });
    expect(await t.getHead()).toBe('abc');
    expect(urls).toEqual(['https://git.example.com/api/v4/projects/42/repository/branches/main']);
  });
});
