import { beforeAll, describe, expect, it } from 'vitest';
import { createCrypto } from '@lm/crypto';
import type { Http, HttpRequest, HttpResponse, SecretStore } from '@lm/platform';
import {
  createGitHubTransport,
  createGitLabTransport,
  createEncryptedSecrets,
  createSyncVault,
  unlockSyncVault,
} from './index';
let crypto: Awaited<ReturnType<typeof createCrypto>>;
beforeAll(async () => {
  crypto = await createCrypto();
});
const parent = 'a'.repeat(40),
  tree = 'b'.repeat(40),
  blob = 'c'.repeat(40),
  next = 'd'.repeat(40),
  fileCommit = 'e'.repeat(40);
const secrets: SecretStore = {
  get: async () => 'synthetic-test-token',
  set: async () => undefined,
  remove: async () => undefined,
};
const response = (
  body: unknown,
  status = 200,
  headers: Record<string, string> = {},
): HttpResponse => ({ status, headers, body: crypto.encodeUtf8(JSON.stringify(body)) });
function mock(run: (url: URL, request: HttpRequest) => HttpResponse | Promise<HttpResponse>) {
  const calls: { url: URL; input: HttpRequest }[] = [];
  const http: Http = {
    request: async (url, input) => {
      const target = new URL(url);
      calls.push({ url: target, input });
      return run(target, input);
    },
  };
  return { http, calls };
}
const gh = {
  apiBase: 'https://forge.example',
  owner: 'test',
  repository: 'vault',
  branch: 'main',
  secrets,
  tokenName: 'forge',
};
const gl = {
  apiBase: 'https://forge.example/api/v4',
  project: 'test/vault',
  branch: 'main',
  secrets,
  tokenName: 'forge',
  verifiedWriteGate: false,
};
describe('GitHub API transport', () => {
  it('reads pinned refs/trees/content and batches 100 record blobs through GraphQL', async () => {
    const m = mock((url, input) => {
      if (url.pathname === '/repos/test/vault')
        return response({ private: true, default_branch: 'main', permissions: { push: true } });
      if (url.pathname.includes('/git/ref/')) return response({ object: { sha: parent } });
      if (url.pathname.includes('/git/commits/')) return response({ tree: { sha: tree } });
      if (url.pathname.includes('/git/trees/'))
        return response({
          sha: tree,
          truncated: false,
          tree: [{ path: 'lm.json', sha: blob, type: 'blob', mode: '100644' }],
        });
      if (url.pathname.includes('/contents/')) {
        expect(url.searchParams.get('ref')).toBe(parent);
        return response({
          type: 'file',
          encoding: 'base64',
          content: crypto.encodeBase64(crypto.encodeUtf8('header')),
        });
      }
      if (url.pathname === '/graphql') {
        const inputBody = JSON.parse(input.body ?? '{}') as { query: string };
        const aliases = inputBody.query.match(/b\d+:/g) ?? [];
        expect(aliases).toHaveLength(100);
        return response({
          data: {
            repository: Object.fromEntries(
              aliases.map((name) => [name.slice(0, -1), { text: 'LMR1.synthetic' }]),
            ),
          },
        });
      }
      throw new Error('Unexpected API call');
    });
    const transport = await createGitHubTransport({ ...gh, http: m.http });
    expect(await transport.getHead()).toBe(parent);
    expect(await transport.getRoot(parent)).toBe(tree);
    expect(await transport.getTree(tree, '')).toEqual([
      { path: 'lm.json', sha: blob, kind: 'blob' },
    ]);
    expect(await transport.readFile('lm.json', parent)).toEqual(crypto.encodeUtf8('header'));
    const entries = Array.from({ length: 100 }, (_, i) => ({ path: `record${i}.lmr`, sha: blob }));
    expect((await transport.readBlobs(entries)).size).toBe(100);
    expect(m.calls.filter((call) => call.url.pathname === '/graphql')).toHaveLength(1);
  });
  it('creates blob/tree/single-parent commit and uses a non-forced ref update', async () => {
    const m = mock((url, input) => {
      if (url.pathname === '/repos/test/vault')
        return response({ private: true, default_branch: 'main' });
      if (url.pathname.includes('/git/ref/')) return response({ object: { sha: parent } });
      if (url.pathname.endsWith('/git/blobs')) return response({ sha: blob }, 201);
      if (url.pathname.endsWith(`/git/commits/${parent}`)) return response({ tree: { sha: tree } });
      if (url.pathname.endsWith('/git/trees')) {
        const body = JSON.parse(input.body ?? '{}') as { base_tree: string };
        expect(body.base_tree).toBe(tree);
        return response({ sha: tree }, 201);
      }
      if (url.pathname.endsWith('/git/commits')) {
        const body = JSON.parse(input.body ?? '{}') as {
          message: string;
          parents: string[];
          author: { email: string };
          committer: { email: string };
        };
        expect(body.message).toBe('sync');
        expect(body.parents).toEqual([parent]);
        expect(body.author.email).toBe('noreply@invalid');
        expect(body.committer.email).toBe('noreply@invalid');
        return response({ sha: next }, 201);
      }
      if (url.pathname.includes('/git/refs/')) {
        expect(JSON.parse(input.body ?? '{}')).toEqual({ sha: next, force: false });
        return response({ object: { sha: next } });
      }
      throw new Error('Unexpected API call');
    });
    const transport = await createGitHubTransport({ ...gh, http: m.http });
    expect(
      await transport.commit(parent, [
        { path: 'lm.json', content: crypto.encodeUtf8('synthetic header') },
      ]),
    ).toBe(next);
  });
  it('distinguishes ref races from validation errors and rejects public repositories', async () => {
    let changed = false,
      publicRepo = false;
    const m = mock((url, input) => {
      if (url.pathname === '/repos/test/vault')
        return response({ private: !publicRepo, default_branch: 'main' });
      if (url.pathname.includes('/git/ref/'))
        return response({ object: { sha: changed ? next : parent } });
      if (url.pathname.includes('/git/refs/')) {
        changed = true;
        return response({}, 422);
      }
      if (url.pathname.endsWith(`/git/commits/${parent}`)) return response({ tree: { sha: tree } });
      if (input.method === 'POST') return response({ sha: blob }, 201);
      throw new Error('Unexpected API call');
    });
    const transport = await createGitHubTransport({ ...gh, http: m.http });
    expect(
      await transport.commit(parent, [{ path: 'lm.json', content: crypto.encodeUtf8('header') }]),
    ).toBe('conflict');
    publicRepo = true;
    await expect(transport.getHead()).rejects.toMatchObject({ code: 'authentication' });
    const invalid = mock((url, input) => {
      if (url.pathname === '/repos/test/vault')
        return response({ private: true, default_branch: 'main' });
      if (url.pathname.includes('/git/ref/')) return response({ object: { sha: parent } });
      if (url.pathname.includes('/git/refs/')) return response({}, 422);
      if (url.pathname.endsWith(`/git/commits/${parent}`)) return response({ tree: { sha: tree } });
      if (input.method === 'POST') return response({ sha: blob }, 201);
      throw new Error('Unexpected API call');
    });
    await expect(
      (await createGitHubTransport({ ...gh, http: invalid.http })).commit(parent, [
        { path: 'lm.json', content: crypto.encodeUtf8('header') },
      ]),
    ).rejects.toMatchObject({ code: 'invalid-remote' });
  });
  it('rejects truncated nonrecursive trees, revoked credentials and rate-limit responses', async () => {
    const m = mock(() => response({ sha: tree, tree: [], truncated: true }));
    const transport = await createGitHubTransport({ ...gh, http: m.http });
    await expect(transport.getTree(tree, '')).rejects.toMatchObject({ code: 'invalid-remote' });
    await expect(
      (await createGitHubTransport({ ...gh, http: mock(() => response({}, 401)).http })).getHead(),
    ).rejects.toMatchObject({ code: 'authentication' });
    const limited = await createGitHubTransport({
      ...gh,
      http: mock(() =>
        response({}, 403, { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '123' }),
      ).http,
    });
    await expect(limited.getHead()).rejects.toMatchObject({ code: 'rate-limit', retryAt: 123000 });
  });
});
describe('GitLab experimental shared-gate transport', () => {
  it('uses pinned keyset pagination and rejects unconfigured pagination destinations', async () => {
    let hostile = false;
    const m = mock((url) => {
      if (!url.searchParams.has('page_token'))
        return response([{ path: 'r', id: tree, type: 'tree', mode: '040000' }], 200, {
          link: `<${hostile ? 'https://other.example' : 'https://forge.example'}/api/v4/projects/test%2Fvault/repository/tree?path=&ref=${parent}&per_page=100&pagination=keyset&page_token=next>; rel="next"`,
        });
      return response([{ path: 'lm.json', id: blob, type: 'blob', mode: '100644' }], 200, {
        link: '',
      });
    });
    const transport = await createGitLabTransport({ ...gl, http: m.http });
    await transport.getRoot(parent);
    expect(await transport.getTree(parent, '')).toHaveLength(2);
    expect(m.calls.every((call) => call.url.searchParams.get('ref') === parent)).toBe(true);
    hostile = true;
    await expect(transport.getTree(parent, '')).rejects.toMatchObject({ code: 'invalid-remote' });
  });
  it('blocks writes until a dedicated real-forge gate verification exists', async () => {
    const m = mock(() => {
      throw new Error('Should not call HTTP');
    });
    const transport = await createGitLabTransport({ ...gl, http: m.http });
    await expect(
      transport.commit(parent, [{ path: 'lm.json', content: crypto.encodeUtf8('header') }]),
    ).rejects.toMatchObject({ code: 'update-required' });
    expect(m.calls).toHaveLength(0);
  });
  it('gates create-only record batches with the header file last-commit ID', async () => {
    const key = crypto.deriveKeys(crypto.randomKey()),
      path = crypto.recordPath('synthetic', key.path);
    const m = mock((url, input) => {
      if (url.pathname === '/api/v4/projects/test%2Fvault')
        return response({ visibility: 'private', default_branch: 'main' });
      if (url.pathname.includes('/branches/')) return response({ commit: { id: parent } });
      if (input.method === 'HEAD')
        return url.pathname.endsWith('/lm.json')
          ? response(null, 200, { 'x-gitlab-last-commit-id': fileCommit })
          : response(null, 404);
      if (url.pathname.endsWith('/commits')) {
        const body = JSON.parse(input.body ?? '{}') as {
          force: boolean;
          actions: { file_path: string; action: string; last_commit_id?: string }[];
        };
        expect(body.force).toBe(false);
        expect(body.actions.find((action) => action.file_path === 'lm.json')).toMatchObject({
          action: 'update',
          last_commit_id: fileCommit,
        });
        expect(body.actions.find((action) => action.file_path === path)).toMatchObject({
          action: 'create',
        });
        return response({ id: next }, 201);
      }
      throw new Error('Unexpected API call');
    });
    const transport = await createGitLabTransport({ ...gl, http: m.http, verifiedWriteGate: true });
    expect(
      await transport.commit(parent, [
        { path: 'lm.json', content: crypto.encodeUtf8('header') },
        { path, content: crypto.encodeUtf8('LMR1.synthetic') },
      ]),
    ).toBe(next);
  });
});
it('encrypts persisted secrets, binds slot names and zeroes its wrapping subkey on lock', async () => {
  const rows = new Map<string, Uint8Array>();
  const store = await createEncryptedSecrets(
    {
      get: async (name) => rows.get(name) ?? null,
      set: async (name, value) => {
        rows.set(name, value);
      },
      remove: async (name) => {
        rows.delete(name);
      },
    },
    crypto.randomKey(),
  );
  await store.set('forge', 'synthetic-token');
  expect(await store.get('forge')).toBe('synthetic-token');
  expect(rows.get('forge')).not.toEqual(crypto.encodeUtf8('synthetic-token'));
  const ciphertext = rows.get('forge');
  if (!ciphertext) throw new Error('Missing encrypted fixture');
  rows.set('ai', ciphertext);
  await expect(store.get('ai')).rejects.toThrow('Secret unlock failed');
  await store.remove('forge');
  expect(await store.get('forge')).toBeNull();
  store.dispose();
  await expect(store.get('ai')).rejects.toThrow('Secrets locked');
});
it('creates only authenticated v2 sync vaults and unlocks maintenance states without unfreezing them', async () => {
  const vault = await createSyncVault('synthetic vault passphrase', '2026-10-13');
  expect(vault.header.version).toBe(2);
  expect(vault.control.state).toBe('active');
  const unlocked = await unlockSyncVault(vault.header, vault.recoveryKey, 'recovery');
  expect(unlocked.control).toEqual(vault.control);
  expect(unlocked.dataKey).toEqual(vault.dataKey);
  const frozen = crypto.controlHeader(vault.header, vault.dataKey, {
    ...vault.control,
    state: 'frozen',
    operationId: 'c'.repeat(64),
  });
  const recovering = await unlockSyncVault(frozen, vault.recoveryKey, 'recovery');
  expect(recovering.control.state).toBe('frozen');
  const legacy = crypto.createVault('legacy synthetic passphrase', '2026-10-13');
  await expect(
    unlockSyncVault(legacy.header, legacy.recoveryKey, 'recovery'),
  ).rejects.toMatchObject({ code: 'update-required' });
  for (const key of [unlocked.dataKey, recovering.dataKey, vault.dataKey, legacy.dataKey])
    crypto.dispose(key);
});
