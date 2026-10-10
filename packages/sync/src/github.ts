import { z } from 'zod';
import {
  COMMIT_AUTHOR,
  COMMIT_MESSAGE,
  ForgeHttpError,
  ForgeResponseError,
  RateLimitTracker,
  bytes,
  encodePath,
  headerNumber,
  json,
  mapLimit,
  throwForAuthOrLimit,
  toBase64,
  type Fetch,
} from './http';
import {
  RateLimitedError,
  type CommitResult,
  type CommitSha,
  type FileChange,
  type RateLimitState,
  type SyncTransport,
  type TreeEntry,
} from './transport';

// The GitHub transport (SYNC.md §7): git data API for trees and commits,
// GraphQL for batched text blob reads, a fast-forward-only ref update as the
// compare-and-swap. Works with github.com and GitHub Enterprise Server.

export interface GitHubTransportOptions {
  /** REST base. Default https://api.github.com; Enterprise: https://<host>/api/v3. */
  apiBase?: string;
  /** Default: derived from `apiBase` (…/graphql, or …/api/graphql on Enterprise). */
  graphqlUrl?: string;
  owner: string;
  repo: string;
  /** The branch to sync, normally the repo's default branch. */
  branch: string;
  /** A fine-grained PAT for this repo only (Contents: read and write). From platform.secrets. */
  token: string;
  fetch: Fetch;
  now?: () => number;
  /** Blobs per GraphQL query. GitHub allows about 100 aliased lookups. */
  graphqlBatch?: number;
  /** Concurrent REST requests for binary blobs and blob uploads. */
  concurrency?: number;
}

const sha = z.string().regex(/^[0-9a-f]{40}$/);
const refBody = z.object({ object: z.object({ sha }) });
const treeBody = z.object({
  truncated: z.boolean().optional(),
  tree: z.array(z.object({ path: z.string(), type: z.string(), sha })),
});
const commitBody = z.object({ sha, tree: z.object({ sha }) });
const shaBody = z.object({ sha });
const contentsBody = z.object({ commit: z.object({ sha }) });
const graphqlBody = z.object({
  data: z
    .object({
      repository: z
        .record(
          z.string(),
          z
            .object({
              text: z.string().nullable().optional(),
              isBinary: z.boolean().nullable().optional(),
              isTruncated: z.boolean().optional(),
            })
            .nullable(),
        )
        .nullable(),
    })
    .nullable()
    .optional(),
  errors: z.array(z.object({ type: z.string().optional() })).optional(),
});

type Method = 'GET' | 'POST' | 'PATCH' | 'PUT';

export class GitHubTransport implements SyncTransport {
  private readonly api: string;
  private readonly graphqlUrl: string;
  private readonly limits: RateLimitTracker;
  private readonly batch: number;
  private readonly concurrency: number;
  /** Commit → its root tree, so a push doesn't re-read the commit it builds on. */
  private readonly treeOf = new Map<CommitSha, string>();

  constructor(private readonly options: GitHubTransportOptions) {
    const apiBase = (options.apiBase ?? 'https://api.github.com').replace(/\/+$/, '');
    this.api = `${apiBase}/repos/${encodeURIComponent(options.owner)}/${encodeURIComponent(options.repo)}`;
    this.graphqlUrl = options.graphqlUrl ?? graphqlUrlFor(apiBase);
    this.limits = new RateLimitTracker(options.now ?? Date.now);
    this.batch = options.graphqlBatch ?? 100;
    this.concurrency = options.concurrency ?? 6;
  }

  rateLimit(): RateLimitState {
    return this.limits.current();
  }

  async getHead(): Promise<CommitSha | null> {
    const res = await this.request('GET', `/git/ref/heads/${encodePath(this.options.branch)}`, {
      allow: [409],
    });
    // 409 "Git Repository is empty": no commits yet (the onboarding case).
    if (res.status === 409) return null;
    return (await json(res, refBody, 'read the branch head')).object.sha;
  }

  async listTree(
    commit: CommitSha,
    path: string,
    treeSha: string | undefined,
  ): Promise<TreeEntry[]> {
    if (treeSha === undefined && path !== '') {
      // The engine always passes the SHA; walk down for callers that don't.
      let entries = await this.listTree(commit, '', undefined);
      let at = '';
      for (const name of path.split('/')) {
        const dir = entries.find((e) => e.name === name && e.type === 'tree');
        if (!dir) return [];
        at = at === '' ? name : `${at}/${name}`;
        entries = await this.listTree(commit, at, dir.sha);
      }
      return entries;
    }
    // A commit SHA lists its root tree.
    const res = await this.request('GET', `/git/trees/${treeSha ?? commit}`);
    const body = await json(res, treeBody, 'list a tree');
    // Directories stay small by design (SYNC.md §1); a truncated listing would
    // silently hide records, so refuse it.
    if (body.truncated === true) throw new ForgeResponseError('list a tree (truncated)');
    return body.tree.flatMap((e): TreeEntry[] =>
      // 'commit' entries are submodules: not ours, never synced.
      e.type === 'blob' || e.type === 'tree' ? [{ name: e.path, sha: e.sha, type: e.type }] : [],
    );
  }

  async readBlobs(
    entries: readonly { path: string; sha: string }[],
  ): Promise<Map<string, Uint8Array>> {
    const out = new Map<string, Uint8Array>();
    // Binary attachments can't come through GraphQL's `text`.
    const viaRest = entries.filter((e) => e.path.endsWith('.lmb'));
    const viaGraphql = entries.filter((e) => !e.path.endsWith('.lmb'));
    for (let i = 0; i < viaGraphql.length; i += this.batch) {
      const chunk = viaGraphql.slice(i, i + this.batch);
      const texts = await this.readTexts(chunk.map((e) => e.sha));
      for (const e of chunk) {
        const text = texts.get(e.sha);
        if (text === undefined) continue;
        if (text === null) viaRest.push(e);
        else out.set(e.path, new TextEncoder().encode(text));
      }
    }
    const found = await mapLimit(viaRest, this.concurrency, (e) => this.readBlobRest(e.sha));
    viaRest.forEach((e, i) => {
      const data = found[i];
      if (data) out.set(e.path, data);
    });
    return out;
  }

  async readFile(path: string, commit: CommitSha): Promise<Uint8Array | null> {
    const res = await this.request(
      'GET',
      `/contents/${encodePath(path)}?ref=${encodeURIComponent(commit)}`,
      { allow: [404], raw: true },
    );
    return res.status === 404 ? null : bytes(res);
  }

  async commit(parent: CommitSha | null, changes: readonly FileChange[]): Promise<CommitResult> {
    if (parent === null) return this.firstCommit(changes);

    const baseTree = this.treeOf.get(parent) ?? (await this.commitTree(parent));
    const tree = await mapLimit(changes, this.concurrency, async (c) => {
      const entry = { path: c.path, mode: '100644', type: 'blob' } as const;
      if ('delete' in c) return { ...entry, sha: null };
      if (typeof c.content === 'string') return { ...entry, content: c.content };
      return { ...entry, sha: await this.createBlob(c.content) };
    });
    const treeRes = await this.request('POST', '/git/trees', {
      body: { base_tree: baseTree, tree },
    });
    const newTree = (await json(treeRes, shaBody, 'create a tree')).sha;
    const commitRes = await this.request('POST', '/git/commits', {
      body: {
        message: COMMIT_MESSAGE,
        tree: newTree,
        parents: [parent],
        author: COMMIT_AUTHOR,
        committer: COMMIT_AUTHOR,
      },
    });
    const created = (await json(commitRes, shaBody, 'create a commit')).sha;
    // The compare-and-swap: without force, GitHub moves the branch only if
    // the new commit descends from the current head. Our commit's only parent
    // is `parent`, so that holds only while the branch is still at `parent`.
    // 422 "Update is not a fast forward" means another device got there first.
    const refRes = await this.request(
      'PATCH',
      `/git/refs/heads/${encodePath(this.options.branch)}`,
      { body: { sha: created, force: false }, allow: [422] },
    );
    if (refRes.status === 422) return 'conflict';
    this.treeOf.set(created, newTree);
    return created;
  }

  /**
   * An empty repo has no objects, and the git data API refuses to write to it
   * (409), so the first commit goes through the contents API, one file:
   * `lm.json` (SYNC.md §8). Creating a file that exists fails, which is the
   * compare-and-swap when two devices set up the same repo at once.
   */
  private async firstCommit(changes: readonly FileChange[]): Promise<CommitResult> {
    const [first, ...rest] = changes;
    if (!first || rest.length > 0 || 'delete' in first) {
      throw new Error('The first commit of a GitHub repo must add exactly one file');
    }
    const content =
      typeof first.content === 'string' ? new TextEncoder().encode(first.content) : first.content;
    const res = await this.request('PUT', `/contents/${encodePath(first.path)}`, {
      body: {
        message: COMMIT_MESSAGE,
        content: toBase64(content),
        branch: this.options.branch,
        author: COMMIT_AUTHOR,
        committer: COMMIT_AUTHOR,
      },
      allow: [409, 422],
    });
    if (res.status === 409 || res.status === 422) return 'conflict';
    return (await json(res, contentsBody, 'create the first commit')).commit.sha;
  }

  private async commitTree(commit: CommitSha): Promise<string> {
    const res = await this.request('GET', `/git/commits/${commit}`);
    const tree = (await json(res, commitBody, 'read a commit')).tree.sha;
    this.treeOf.set(commit, tree);
    return tree;
  }

  private async createBlob(data: Uint8Array): Promise<string> {
    const res = await this.request('POST', '/git/blobs', {
      body: { content: toBase64(data), encoding: 'base64' },
    });
    return (await json(res, shaBody, 'upload a blob')).sha;
  }

  private async readBlobRest(blobSha: string): Promise<Uint8Array | null> {
    const res = await this.request('GET', `/git/blobs/${blobSha}`, { allow: [404], raw: true });
    return res.status === 404 ? null : bytes(res);
  }

  /**
   * One GraphQL query for many blobs (SYNC.md §7). Returns the text per SHA,
   * null when GraphQL can't give it (binary or truncated: read it over REST),
   * and leaves out SHAs the repo doesn't have.
   */
  private async readTexts(shas: readonly string[]): Promise<Map<string, string | null>> {
    const unique = [...new Set(shas)];
    for (const s of unique) if (!sha.safeParse(s).success) throw new ForgeResponseError('blob id');
    const vars = unique.map((_, i) => `$o${String(i)}: GitObjectID!`).join(', ');
    const fields = unique
      .map(
        (_, i) =>
          `b${String(i)}: object(oid: $o${String(i)}) { ... on Blob { text isBinary isTruncated } }`,
      )
      .join('\n');
    const variables: Record<string, string> = {
      owner: this.options.owner,
      name: this.options.repo,
    };
    unique.forEach((s, i) => (variables[`o${String(i)}`] = s));
    const res = await this.request('POST', this.graphqlUrl, {
      absolute: true,
      body: {
        query: `query($owner: String!, $name: String!, ${vars}) { repository(owner: $owner, name: $name) { ${fields} } }`,
        variables,
      },
    });
    const body = await json(res, graphqlBody, 'read blobs');
    // GraphQL reports its rate limit as an error inside a 200.
    if (body.errors?.some((e) => e.type === 'RATE_LIMITED')) {
      throw new RateLimitedError(this.limits.resetAt('graphql'));
    }
    const repo = body.data?.repository;
    if (!repo) throw new ForgeResponseError('read blobs');
    const out = new Map<string, string | null>();
    unique.forEach((s, i) => {
      const blob = repo[`b${String(i)}`];
      if (!blob) return;
      const usable = typeof blob.text === 'string' && blob.isBinary !== true && !blob.isTruncated;
      out.set(s, usable ? (blob.text as string) : null);
    });
    return out;
  }

  private async request(
    method: Method,
    path: string,
    opts: { body?: unknown; allow?: number[]; raw?: boolean; absolute?: boolean } = {},
  ): Promise<Response> {
    const headers: Record<string, string> = {
      authorization: `Bearer ${this.options.token}`,
      accept: opts.raw ? 'application/vnd.github.raw+json' : 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28',
    };
    if (opts.body !== undefined) headers['content-type'] = 'application/json';
    const res = await this.options.fetch(opts.absolute ? path : `${this.api}${path}`, {
      method,
      headers,
      // Never let a cache answer for the branch head or a CAS.
      cache: 'no-store',
      ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
    });
    const resource = res.headers.get('x-ratelimit-resource') ?? 'core';
    const remaining = headerNumber(res, 'x-ratelimit-remaining');
    const reset = headerNumber(res, 'x-ratelimit-reset');
    const resetAt = reset === null ? null : reset * 1000;
    this.limits.update(resource, remaining, resetAt);
    if (res.ok || opts.allow?.includes(res.status)) return res;
    // Secondary rate limits come as 403/429 with Retry-After instead.
    const retryAfter = headerNumber(res, 'retry-after');
    throwForAuthOrLimit(res, {
      exhausted: remaining === 0 || retryAfter !== null,
      resetAt: retryAfter !== null ? (this.options.now ?? Date.now)() + retryAfter * 1000 : resetAt,
    });
    throw new ForgeHttpError(res.status, `GitHub ${method} ${describe(path)}`);
  }
}

/** api.github.com/graphql; Enterprise serves REST at /api/v3 and GraphQL at /api/graphql. */
function graphqlUrlFor(apiBase: string): string {
  return apiBase.endsWith('/api/v3') ? `${apiBase.slice(0, -2)}graphql` : `${apiBase}/graphql`;
}

/** The endpoint without ids, refs or file names, for error messages. */
function describe(path: string): string {
  if (path.startsWith('http')) return 'graphql';
  const parts = path.split('?')[0]?.split('/').filter(Boolean) ?? [];
  return parts.slice(0, 2).join('/');
}
