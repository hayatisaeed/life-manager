import { describe, expect, it } from 'vitest';
import { GitHubTransport, type GitHubTransportOptions } from './github';
import { ForgeHttpError, ForgeResponseError } from './http';
import { deviceOn, note, task } from './test-support/devices';
import { GitHubEmulator } from './test-support/github-emulator';
import { AuthError, RateLimitedError, type CommitSha } from './transport';

const NOW = Date.UTC(2026, 9, 10);

function setup(over: Partial<GitHubTransportOptions> = {}) {
  const gh = new GitHubEmulator();
  const make = (more: Partial<GitHubTransportOptions> = {}) =>
    new GitHubTransport({
      owner: gh.owner,
      repo: gh.repo,
      branch: gh.branch,
      token: gh.token,
      fetch: gh.fetch,
      now: () => NOW,
      ...over,
      ...more,
    });
  return { gh, t: make(), make };
}

async function initialized() {
  const s = setup();
  const head = await s.t.commit(null, [{ path: 'lm.json', content: '{"format":"life-manager"}' }]);
  return { ...s, head: head as CommitSha };
}

const reply = (status: number, body: unknown = {}, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers });

describe('GitHub transport', () => {
  it('syncs two devices through the engine, with ciphertext only on the forge', async () => {
    const { gh, make } = await initialized();
    const a = await deviceOn(make(), 1);
    const b = await deviceOn(make(), 2);
    const t = await a.db.create('task', task({ title: 'Buy milk' }));
    expect(await a.engine.sync()).toMatchObject({ status: 'ok', pushed: 1 });
    expect(await b.engine.sync()).toMatchObject({ status: 'ok', pulled: 1 });
    expect((await b.db.get('task', t.id))?.data.title).toBe('Buy milk');

    // Concurrent edits on both devices: one CAS loses, retries, and both converge.
    a.clock.now += 1000;
    b.clock.now += 2000;
    await a.db.update('task', t.id, { status: 'done' });
    await b.db.create('note', note('from b'));
    await b.engine.sync();
    expect(await a.engine.sync()).toMatchObject({ status: 'ok', pulled: 1, pushed: 1 });
    expect(await b.engine.sync()).toMatchObject({ status: 'ok', pulled: 1 });
    expect((await b.db.get('task', t.id))?.data.status).toBe('done');

    for (const req of gh.requests) {
      if (req.method === 'POST' && req.url.pathname.endsWith('/git/commits')) {
        expect(req.body).toMatchObject({
          message: 'sync',
          author: { name: 'Life Manager', email: 'noreply@invalid' },
          committer: { name: 'Life Manager', email: 'noreply@invalid' },
        });
      }
    }
    for (const [path, sha] of gh.files()) {
      if (path === 'lm.json') continue;
      expect(path).toMatch(/^r\/[0-9a-f]{2}\/[0-9a-f]{2}\/[0-9a-f]{64}\.lmr$/);
      expect(new TextDecoder().decode(gh.blobs.get(sha))).not.toContain('milk');
    }
  });

  it('resolves a CAS race through the engine', async () => {
    const { gh, make } = await initialized();
    const a = await deviceOn(make(), 1);
    const b = await deviceOn(make(), 2);
    await a.db.create('note', note('a'));
    await b.db.create('note', note('b'));
    let raced = false;
    gh.intercept = async (req) => {
      if (!raced && req.method === 'PATCH') {
        raced = true;
        await b.engine.sync();
      }
      return undefined;
    };
    expect(await a.engine.sync()).toMatchObject({ status: 'ok', pushed: 1, pulled: 1 });
    expect(a.sleeps).toHaveLength(1);
    expect(await b.engine.sync()).toMatchObject({ status: 'ok', pulled: 1 });
  });

  it('reuses the tree of a commit it made instead of reading it again', async () => {
    const { gh, t, head } = await initialized();
    const c1 = (await t.commit(head, [{ path: 'r/a.lmr', content: 'x' }])) as CommitSha;
    const reads = () =>
      gh.requests.filter((r) => r.method === 'GET' && r.url.pathname.includes('/git/commits/'))
        .length;
    const before = reads();
    await t.commit(c1, [{ path: 'r/b.lmr', content: 'y' }]);
    expect(reads()).toBe(before);
  });

  it('only takes one added file for the first commit', async () => {
    const { t } = setup();
    await expect(
      t.commit(null, [
        { path: 'a', content: '1' },
        { path: 'b', content: '2' },
      ]),
    ).rejects.toThrow(/exactly one file/);
    await expect(t.commit(null, [{ path: 'a', delete: true }])).rejects.toThrow(/exactly one/);
    await expect(t.commit(null, [])).rejects.toThrow(/exactly one/);
    expect(
      await t.commit(null, [{ path: 'lm.json', content: new Uint8Array([123, 125]) }]),
    ).toMatch(/^[0-9a-f]{40}$/);
  });

  it('treats a missing branch as an error, not as an empty repo', async () => {
    const { make } = await initialized();
    await expect(make({ branch: 'other' }).getHead()).rejects.toBeInstanceOf(ForgeHttpError);
  });

  it('maps bad tokens and missing permissions to AuthError', async () => {
    const { make } = await initialized();
    await expect(make({ token: 'wrong' }).getHead()).rejects.toBeInstanceOf(AuthError);
    const { gh, t } = await initialized();
    gh.intercept = () =>
      reply(403, { message: 'Resource not accessible by personal access token' });
    await expect(t.getHead()).rejects.toBeInstanceOf(AuthError);
  });

  it('maps exhausted and secondary rate limits to RateLimitedError, and tracks the budget', async () => {
    expect(setup().t.rateLimit()).toEqual({ remaining: null, resetAt: null });
    const { gh, t } = await initialized();
    await t.getHead();
    expect(t.rateLimit()).toEqual({ remaining: 4999, resetAt: 1_900_000_000_000 });

    gh.intercept = () =>
      reply(403, {}, { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1900000123' });
    await expect(t.getHead()).rejects.toEqual(new RateLimitedError(1_900_000_123_000));
    expect(t.rateLimit().remaining).toBe(0);

    gh.intercept = () => reply(429, {}, { 'retry-after': '60' });
    const err = await t.getHead().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RateLimitedError);
    expect((err as RateLimitedError).resetAt).toBe(NOW + 60_000);
  });

  it('ignores a rate-limit window that has already reset', async () => {
    const { gh, make } = await initialized();
    const t = make({ now: () => 2_000_000_000_000 });
    gh.rateRemaining = 3;
    await t.getHead();
    expect(t.rateLimit()).toEqual({ remaining: null, resetAt: null });
  });

  it('reports other failures without the token or the repo in the message', async () => {
    const { gh, t, head } = await initialized();
    gh.intercept = () => reply(502, { message: 'bad gateway' });
    const err = (await t.listTree(head, '', undefined).catch((e: unknown) => e)) as Error;
    expect(err).toBeInstanceOf(ForgeHttpError);
    expect(err.message).toBe('GitHub GET git/trees failed with HTTP 502');
    expect(err.message).not.toContain(gh.token);
    expect(err.message).not.toContain(gh.repo);
  });

  it('rejects malformed responses', async () => {
    const { gh, t, head } = await initialized();
    gh.intercept = () => new Response('not json', { status: 200 });
    await expect(t.getHead()).rejects.toBeInstanceOf(ForgeResponseError);
    gh.intercept = () => reply(200, { object: { sha: 'nope' } });
    await expect(t.getHead()).rejects.toBeInstanceOf(ForgeResponseError);
    gh.intercept = () => reply(200, { truncated: true, tree: [] });
    await expect(t.listTree(head, '', undefined)).rejects.toThrow(/truncated/);
    gh.intercept = undefined;
    await expect(t.readBlobs([{ path: 'r/x.lmr', sha: 'not-a-sha' }])).rejects.toBeInstanceOf(
      ForgeResponseError,
    );
  });

  it('skips submodule entries in trees', async () => {
    const { gh, t, head } = await initialized();
    const sub = 'a'.repeat(40);
    gh.intercept = () =>
      reply(200, {
        tree: [
          { path: 'lib', type: 'commit', sha: sub },
          { path: 'lm.json', type: 'blob', sha: sub },
        ],
      });
    expect(await t.listTree(head, '', undefined)).toEqual([
      { name: 'lm.json', type: 'blob', sha: sub },
    ]);
  });

  it('reads blobs GraphQL cannot give as text over REST', async () => {
    const { gh, t, head } = await initialized();
    const binary = new Uint8Array([0, 1, 2, 255]);
    await t.commit(head, [
      { path: 'r/odd.lmr', content: binary },
      { path: 'r/ok.lmr', content: 'LMR1.ok' },
    ]);
    const shaOf = (p: string) => gh.files().get(p) ?? '';
    // Two lookups of one SHA go into the query once.
    const out = await t.readBlobs([
      { path: 'r/odd.lmr', sha: shaOf('r/odd.lmr') },
      { path: 'r/ok.lmr', sha: shaOf('r/ok.lmr') },
      { path: 'r/ok-again.lmr', sha: shaOf('r/ok.lmr') },
    ]);
    expect(out.get('r/odd.lmr')).toEqual(binary);
    expect(out.get('r/ok-again.lmr')).toEqual(new TextEncoder().encode('LMR1.ok'));
    const graphql = gh.requests.filter((r) => r.url.pathname === '/graphql');
    expect(graphql).toHaveLength(1);
    expect(Object.keys((graphql[0]?.body as { variables: object }).variables)).toHaveLength(4);
  });

  it('batches GraphQL reads and handles its errors', async () => {
    const { gh, make, head } = await initialized();
    const t = make({ graphqlBatch: 2 });
    const files = ['a', 'b', 'c'].map((n) => ({ path: `r/${n}.lmr`, content: `LMR1.${n}` }));
    await t.commit(head, files);
    const entries = files.map((f) => ({ path: f.path, sha: gh.files().get(f.path) ?? '' }));
    expect((await t.readBlobs(entries)).size).toBe(3);
    expect(gh.requests.filter((r) => r.url.pathname === '/graphql')).toHaveLength(2);

    gh.intercept = (req) =>
      req.url.pathname === '/graphql'
        ? reply(200, { data: null, errors: [{ type: 'RATE_LIMITED' }] })
        : undefined;
    await expect(t.readBlobs(entries)).rejects.toBeInstanceOf(RateLimitedError);
    gh.intercept = (req) =>
      req.url.pathname === '/graphql' ? reply(200, { errors: [{ type: 'NOT_FOUND' }] }) : undefined;
    await expect(t.readBlobs(entries)).rejects.toBeInstanceOf(ForgeResponseError);
  });

  it('derives the GraphQL endpoint for GitHub Enterprise', async () => {
    const urls: string[] = [];
    const t = new GitHubTransport({
      apiBase: 'https://git.example.com/api/v3/',
      owner: 'o',
      repo: 'r',
      branch: 'main',
      token: 'x',
      fetch: (url) => {
        urls.push(url);
        return Promise.resolve(reply(200, { data: { repository: {} } }));
      },
    });
    await t.readBlobs([{ path: 'r/a.lmr', sha: 'a'.repeat(40) }]);
    await t.readFile('lm.json', 'b'.repeat(40));
    expect(urls).toEqual([
      'https://git.example.com/api/graphql',
      `https://git.example.com/api/v3/repos/o/r/contents/lm.json?ref=${'b'.repeat(40)}`,
    ]);
  });

  it('turns a refused first commit into a conflict', async () => {
    const { gh, t } = setup();
    gh.intercept = () => reply(409, { message: 'conflict' });
    expect(await t.commit(null, [{ path: 'lm.json', content: '{}' }])).toBe('conflict');
  });
});
