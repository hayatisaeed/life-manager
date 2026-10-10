import { describe, expect, it } from 'vitest';
import type { HttpClient, HttpRequest } from '@lm/platform';
import { makeResponse } from '@lm/platform';
import {
  ForgeError,
  GitHubTransport,
  GitLabTransport,
  NotFoundRepoError,
  RateLimitedError,
  SyncAuthError,
  base64ToBytes,
  bytesToBase64,
} from '../src';

type Handler = (req: HttpRequest) => {
  status: number;
  body?: unknown;
  raw?: Uint8Array;
  headers?: Record<string, string>;
};

function mockHttp(routes: [RegExp, Handler][]) {
  const calls: HttpRequest[] = [];
  const http: HttpClient = {
    async request(req) {
      calls.push(req);
      const key = `${req.method ?? 'GET'} ${req.url}`;
      for (const [re, h] of routes) {
        if (re.test(key)) {
          const r = h(req);
          const body =
            r.raw ?? new TextEncoder().encode(r.body === undefined ? '' : JSON.stringify(r.body));
          return makeResponse(r.status, r.headers ?? {}, body);
        }
      }
      throw new Error(`unrouted ${key}`);
    },
  };
  return { http, calls };
}

const repoInfo = { private: true, default_branch: 'main', permissions: { push: true } };

describe('GitHubTransport', () => {
  const gh = (routes: [RegExp, Handler][]) => {
    const m = mockHttp([
      [/GET https:\/\/api\.github\.com\/repos\/me\/data$/, () => ({ status: 200, body: repoInfo })],
      ...routes,
    ]);
    return {
      t: new GitHubTransport(m.http, { owner: 'me', repo: 'data', token: 'ghp_x' }),
      calls: m.calls,
    };
  };

  it('checks access and reads the head; empty repo → null', async () => {
    const { t, calls } = gh([
      [/git\/ref\/heads\/main$/, () => ({ status: 200, body: { object: { sha: 'abc' } } })],
    ]);
    expect(await t.checkAccess()).toEqual({ private: true, canWrite: true, defaultBranch: 'main' });
    expect(await t.getHead()).toBe('abc');
    expect(calls[0]?.headers?.['authorization']).toBe('Bearer ghp_x');
    const e = gh([
      [
        /git\/ref\/heads\/main$/,
        () => ({ status: 409, body: { message: 'Git Repository is empty.' } }),
      ],
    ]);
    expect(await e.t.getHead()).toBeNull();
  });

  it('maps errors', async () => {
    const m = mockHttp([[/data$/, () => ({ status: 404 })]]);
    await expect(
      new GitHubTransport(m.http, { owner: 'me', repo: 'data', token: 'x' }).checkAccess(),
    ).rejects.toBeInstanceOf(NotFoundRepoError);
    const a = mockHttp([[/./, () => ({ status: 401 })]]);
    await expect(
      new GitHubTransport(a.http, {
        owner: 'me',
        repo: 'data',
        token: 'x',
        branch: 'main',
      }).getHead(),
    ).rejects.toBeInstanceOf(SyncAuthError);
    const r = mockHttp([
      [
        /./,
        () => ({
          status: 403,
          headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '100' },
        }),
      ],
    ]);
    const rt = new GitHubTransport(r.http, {
      owner: 'me',
      repo: 'data',
      token: 'x',
      branch: 'main',
    });
    await expect(rt.getHead()).rejects.toBeInstanceOf(RateLimitedError);
    expect(rt.rateLimit()).toEqual({ remaining: 0, resetAt: 100_000 });
    const s = mockHttp([[/./, () => ({ status: 500, body: { message: 'boom' } })]]);
    await expect(
      new GitHubTransport(s.http, {
        owner: 'me',
        repo: 'data',
        token: 'x',
        branch: 'main',
      }).getHead(),
    ).rejects.toBeInstanceOf(ForgeError);
  });

  it('lists trees (plain and recursive, truncated)', async () => {
    const { t } = gh([
      [
        /git\/trees\/c1\?recursive=1/,
        () => ({
          status: 200,
          body: {
            truncated: false,
            tree: [
              { path: 'r', sha: 't1', type: 'tree' },
              { path: 'r/a', sha: 'b1', type: 'blob' },
              { path: 'm', sha: 'x', type: 'commit' },
            ],
          },
        }),
      ],
      [
        /git\/trees\/t1$/,
        () => ({ status: 200, body: { tree: [{ path: 'a', sha: 'b1', type: 'blob' }] } }),
      ],
      [/git\/trees\/c2\?recursive=1/, () => ({ status: 200, body: { truncated: true, tree: [] } })],
    ]);
    expect(await t.listTreeRecursive('c1')).toEqual([
      { path: 'r', sha: 't1', type: 'tree' },
      { path: 'r/a', sha: 'b1', type: 'blob' },
    ]);
    expect(await t.listTree('c1', 'r', 't1')).toEqual([{ path: 'r/a', sha: 'b1', type: 'blob' }]);
    expect(await t.listTreeRecursive('c2')).toBe('truncated');
  });

  it('reads text blobs via GraphQL and binary blobs via REST', async () => {
    const { t, calls } = gh([
      [
        /POST https:\/\/api\.github\.com\/graphql/,
        (req) => {
          const q = JSON.parse(String(req.body)).query as string;
          expect(q).toContain('f0: object(oid: "aa")');
          return {
            status: 200,
            body: { data: { repository: { f0: { text: 'LMR1.x', isBinary: false }, f1: null } } },
          };
        },
      ],
      [/git\/blobs\/cc$/, () => ({ status: 200, raw: new Uint8Array([1, 2]) })],
    ]);
    const out = await t.readFiles('c', [
      { path: 'r/a.lmr', sha: 'aa' },
      { path: 'r/b.lmr', sha: 'bb' },
      { path: 'b/c.lmb', sha: 'cc' },
    ]);
    expect(new TextDecoder().decode(out.get('r/a.lmr')!.bytes)).toBe('LMR1.x');
    expect(out.has('r/b.lmr')).toBe(false);
    expect(out.get('b/c.lmb')!.bytes).toEqual(new Uint8Array([1, 2]));
    expect(calls.find((c) => c.url.includes('blobs/cc'))?.headers?.['accept']).toBe(
      'application/vnd.github.raw',
    );
    const bad = gh([[/graphql/, () => ({ status: 200, body: { errors: [{ message: 'nope' }] } })]]);
    await expect(bad.t.readFiles('c', [{ path: 'r/a.lmr', sha: 'aa' }])).rejects.toThrow('nope');
  });

  it('commits via blobs → trees → commit → ref CAS; 422 → conflict', async () => {
    let refStatus = 200;
    const { t, calls } = gh([
      [/GET .*git\/commits\/p1$/, () => ({ status: 200, body: { tree: { sha: 'tree0' } } })],
      [/POST .*git\/blobs$/, () => ({ status: 201, body: { sha: 'blob1' } })],
      [/POST .*git\/trees$/, () => ({ status: 201, body: { sha: 'tree1' } })],
      [/POST .*git\/commits$/, () => ({ status: 201, body: { sha: 'c2' } })],
      [/PATCH .*git\/refs\/heads\/main$/, () => ({ status: refStatus, body: {} })],
    ]);
    const res = await t.commit('p1', [
      { action: 'upsert', path: 'r/a.lmr', content: 'LMR1.x', exists: false },
      { action: 'upsert', path: 'b/c.lmb', content: new Uint8Array([1]), exists: false },
      { action: 'delete', path: 'r/old.lmr' },
    ]);
    expect(res).toEqual({ sha: 'c2', parents: ['p1'] });
    const tree = JSON.parse(String(calls.find((c) => c.url.endsWith('/git/trees'))?.body));
    expect(tree.base_tree).toBe('tree0');
    expect(tree.tree).toEqual([
      { path: 'r/a.lmr', mode: '100644', type: 'blob', content: 'LMR1.x' },
      { path: 'b/c.lmb', mode: '100644', type: 'blob', sha: 'blob1' },
      { path: 'r/old.lmr', mode: '100644', type: 'blob', sha: null },
    ]);
    const commit = JSON.parse(
      String(calls.find((c) => c.url.endsWith('/git/commits') && c.method === 'POST')?.body),
    );
    expect(commit).toMatchObject({
      message: 'sync',
      parents: ['p1'],
      author: { name: 'Life Manager', email: 'noreply@invalid' },
    });
    expect(JSON.parse(String(calls.at(-1)?.body))).toEqual({ sha: 'c2', force: false });
    refStatus = 422;
    expect(
      await t.commit('p1', [{ action: 'upsert', path: 'x', content: 'y', exists: false }]),
    ).toBe('conflict');
  });

  it('first commit uses the contents API', async () => {
    const { t, calls } = gh([
      [/PUT .*contents\/lm\.json$/, () => ({ status: 201, body: { commit: { sha: 'first' } } })],
    ]);
    expect(
      await t.commit(null, [{ action: 'upsert', path: 'lm.json', content: '{}', exists: false }]),
    ).toEqual({ sha: 'first', parents: [] });
    expect(JSON.parse(String(calls.at(-1)?.body)).content).toBe(btoa('{}'));
    await expect(t.commit(null, [])).rejects.toThrow('exactly one');
  });

  it('readFile returns null on 404 and refuses non-https bases', async () => {
    const { t } = gh([[/contents\/lm\.json\?ref=c$/, () => ({ status: 404 })]]);
    expect(await t.readFile('lm.json', 'c')).toBeNull();
    const m = mockHttp([]);
    await expect(
      new GitHubTransport(m.http, {
        apiBase: 'http://evil',
        owner: 'a',
        repo: 'b',
        token: 't',
      }).checkAccess(),
    ).rejects.toThrow('Blocked');
  });

  it('derives the GraphQL endpoint for GitHub Enterprise', async () => {
    const m = mockHttp([
      [
        /POST https:\/\/ghe\.example\/api\/graphql/,
        () => ({ status: 200, body: { data: { repository: {} } } }),
      ],
    ]);
    const t = new GitHubTransport(m.http, {
      apiBase: 'https://ghe.example/api/v3',
      owner: 'a',
      repo: 'b',
      token: 't',
      branch: 'main',
    });
    await t.readFiles('c', [{ path: 'r/x.lmr', sha: 'aa' }]);
    expect(m.calls[0]?.url).toBe('https://ghe.example/api/graphql');
  });
});

describe('GitLabTransport', () => {
  const API = 'https://gitlab.com/api/v4/projects/me%2Fdata';
  const project = {
    visibility: 'private',
    default_branch: 'main',
    permissions: { project_access: { access_level: 40 }, group_access: null },
  };
  const gl = (routes: [RegExp, Handler][]) => {
    const m = mockHttp([
      [new RegExp(`GET ${API.replace(/[.]/g, '\\.')}$`), () => ({ status: 200, body: project })],
      ...routes,
    ]);
    return {
      t: new GitLabTransport(m.http, { project: 'me/data', token: 'glpat-x' }),
      calls: m.calls,
    };
  };

  it('access, head, empty branch', async () => {
    const { t } = gl([
      [/branches\/main$/, () => ({ status: 200, body: { commit: { id: 'h1' } } })],
    ]);
    expect(await t.checkAccess()).toEqual({ private: true, canWrite: true, defaultBranch: 'main' });
    expect(await t.getHead()).toBe('h1');
    const e = gl([[/branches\/main$/, () => ({ status: 404 })]]);
    expect(await e.t.getHead()).toBeNull();
  });

  it('paginates trees with keyset links', async () => {
    const { t } = gl([
      [
        /tree\?ref=c&per_page=100&pagination=keyset&recursive=true$/,
        () => ({
          status: 200,
          body: [{ id: 's1', path: 'r', type: 'tree' }],
          headers: { link: `<${API}/repository/tree?page2>; rel="next"` },
        }),
      ],
      [
        /tree\?page2$/,
        () => ({ status: 200, body: [{ id: 'b1', path: 'r/x.lmr', type: 'blob' }] }),
      ],
    ]);
    expect(await t.listTreeRecursive('c')).toEqual([
      { path: 'r', sha: 's1', type: 'tree' },
      { path: 'r/x.lmr', sha: 'b1', type: 'blob' },
    ]);
  });

  it('reads files with last-commit meta', async () => {
    const { t } = gl([
      [
        /files\/r%2Fx\.lmr\/raw\?ref=c$/,
        () => ({
          status: 200,
          raw: new Uint8Array([7]),
          headers: { 'x-gitlab-last-commit-id': 'lc1' },
        }),
      ],
    ]);
    const out = await t.readFiles('c', [{ path: 'r/x.lmr', sha: 'b1' }]);
    expect(out.get('r/x.lmr')).toEqual({ bytes: new Uint8Array([7]), meta: 'lc1' });
  });

  it('commits actions with last_commit_id; stale → conflict', async () => {
    let status = 201;
    let message = '';
    const { t, calls } = gl([
      [
        /POST .*repository\/commits$/,
        () =>
          status === 201
            ? { status, body: { id: 'c9', parent_ids: ['h1'] } }
            : { status, body: { message } },
      ],
    ]);
    const res = await t.commit('h1', [
      { action: 'upsert', path: 'r/a.lmr', content: 'LMR1.a', exists: true, meta: 'lc1' },
      { action: 'upsert', path: 'b/x.lmb', content: new Uint8Array([1, 2]), exists: false },
      { action: 'delete', path: 'r/z.lmr', meta: 'lc2' },
    ]);
    expect(res).toEqual({ sha: 'c9', parents: ['h1'], meta: { 'r/a.lmr': 'c9', 'b/x.lmb': 'c9' } });
    const body = JSON.parse(String(calls.at(-1)?.body));
    expect(body.actions).toEqual([
      {
        file_path: 'r/a.lmr',
        action: 'update',
        content: 'LMR1.a',
        encoding: 'text',
        last_commit_id: 'lc1',
      },
      {
        file_path: 'b/x.lmb',
        action: 'create',
        content: bytesToBase64(new Uint8Array([1, 2])),
        encoding: 'base64',
      },
      { file_path: 'r/z.lmr', action: 'delete', last_commit_id: 'lc2' },
    ]);
    expect(body).toMatchObject({
      branch: 'main',
      commit_message: 'sync',
      author_email: 'noreply@invalid',
    });
    status = 400;
    message = 'You are attempting to update a file that has changed since you started editing it.';
    expect(
      await t.commit('h1', [
        { action: 'upsert', path: 'r/a.lmr', content: 'x', exists: true, meta: 'old' },
      ]),
    ).toBe('conflict');
    message = 'A file with this name already exists';
    expect(
      await t.commit('h1', [{ action: 'upsert', path: 'r/a.lmr', content: 'x', exists: false }]),
    ).toBe('conflict');
    message = 'something else';
    await expect(
      t.commit('h1', [{ action: 'upsert', path: 'r/a.lmr', content: 'x', exists: false }]),
    ).rejects.toBeInstanceOf(ForgeError);
  });

  it('flags public projects and low access', async () => {
    const m = mockHttp([
      [
        /./,
        () => ({
          status: 200,
          body: { visibility: 'public', default_branch: null, permissions: {} },
        }),
      ],
    ]);
    expect(await new GitLabTransport(m.http, { project: '1', token: 't' }).checkAccess()).toEqual({
      private: false,
      canWrite: false,
      defaultBranch: 'main',
    });
  });
});

describe('base64', () => {
  it('round-trips large buffers', () => {
    const b = new Uint8Array(100_000).map((_, i) => i % 256);
    expect(base64ToBytes(bytesToBase64(b))).toEqual(b);
  });
});
