// GitHub transport (SYNC.md §7): git-data REST endpoints for trees, commits and
// refs, GraphQL for batched text-blob reads. Works on github.com and GitHub
// Enterprise (configurable API base).

import type { HttpClient } from '@lm/platform';
import type {
  CommitResult,
  CommitSha,
  FileChange,
  ReadResult,
  SyncTransport,
  TreeEntry,
} from '../transport';
import { ForgeError, NotFoundRepoError } from '../transport';
import {
  COMMIT_AUTHOR,
  COMMIT_MESSAGE,
  ForgeHttp,
  base64ToBytes,
  bytesToBase64,
  mapLimit,
} from './common';

export interface GitHubConfig {
  /** `https://api.github.com` or `https://<host>/api/v3` for GitHub Enterprise. */
  apiBase?: string;
  owner: string;
  repo: string;
  token: string;
  branch?: string;
}

const GRAPHQL_BATCH = 100;
const TREE_CHUNK = 500;

export class GitHubTransport implements SyncTransport {
  readonly kind = 'github' as const;
  private readonly api: string;
  private readonly graphql: string;
  private readonly h: ForgeHttp;
  private branch: string | null;

  constructor(
    http: HttpClient,
    private readonly cfg: GitHubConfig,
  ) {
    this.api = (cfg.apiBase ?? 'https://api.github.com').replace(/\/+$/, '');
    this.graphql = this.api.endsWith('/api/v3')
      ? `${this.api.slice(0, -3)}/graphql`
      : `${this.api}/graphql`;
    this.branch = cfg.branch ?? null;
    this.h = new ForgeHttp(
      http,
      {
        authorization: `Bearer ${cfg.token}`,
        accept: 'application/vnd.github+json',
        'x-github-api-version': '2022-11-28',
      },
      { remaining: 'x-ratelimit-remaining', reset: 'x-ratelimit-reset' },
    );
  }

  private repoUrl(path = ''): string {
    return `${this.api}/repos/${encodeURIComponent(this.cfg.owner)}/${encodeURIComponent(this.cfg.repo)}${path}`;
  }

  private async getBranch(): Promise<string> {
    if (!this.branch) this.branch = (await this.checkAccess()).defaultBranch;
    return this.branch;
  }

  async checkAccess() {
    const res = await this.h.send({ url: this.repoUrl() }, (s) => s === 200 || s === 404);
    if (res.status === 404) throw new NotFoundRepoError();
    const r = res.json<{
      private: boolean;
      default_branch: string;
      permissions?: { push?: boolean };
    }>();
    this.branch ??= r.default_branch;
    return { private: r.private, canWrite: !!r.permissions?.push, defaultBranch: r.default_branch };
  }

  async getHead(): Promise<CommitSha | null> {
    const branch = await this.getBranch();
    const res = await this.h.send(
      { url: this.repoUrl(`/git/ref/heads/${encodeURIComponent(branch)}`) },
      (s) => s === 200 || s === 404 || s === 409,
    );
    // 409 "Git Repository is empty"; 404 = branch not created yet.
    if (res.status !== 200) return null;
    return res.json<{ object: { sha: string } }>().object.sha;
  }

  private mapTree(
    prefix: string,
    tree: { path: string; sha: string; type: string }[],
  ): TreeEntry[] {
    return tree
      .filter((e) => e.type === 'blob' || e.type === 'tree')
      .map((e) => ({
        path: prefix ? `${prefix}/${e.path}` : e.path,
        sha: e.sha,
        type: e.type as 'blob' | 'tree',
      }));
  }

  async listTree(commit: CommitSha, path: string, sha?: string): Promise<TreeEntry[]> {
    const ref = sha ?? (path ? `${commit}:${path}` : commit);
    const res = await this.h.send({ url: this.repoUrl(`/git/trees/${encodeURIComponent(ref)}`) });
    return this.mapTree(
      path,
      res.json<{ tree: { path: string; sha: string; type: string }[] }>().tree,
    );
  }

  async listTreeRecursive(commit: CommitSha): Promise<TreeEntry[] | 'truncated'> {
    const res = await this.h.send({ url: this.repoUrl(`/git/trees/${commit}?recursive=1`) });
    const body = res.json<{
      truncated: boolean;
      tree: { path: string; sha: string; type: string }[];
    }>();
    if (body.truncated) return 'truncated';
    return this.mapTree('', body.tree);
  }

  async readFiles(
    _commit: CommitSha,
    entries: { path: string; sha: string }[],
  ): Promise<Map<string, ReadResult>> {
    const out = new Map<string, ReadResult>();
    const text = entries.filter((e) => e.path.endsWith('.lmr'));
    const binary = entries.filter((e) => !e.path.endsWith('.lmr'));
    for (let i = 0; i < text.length; i += GRAPHQL_BATCH) {
      const part = text.slice(i, i + GRAPHQL_BATCH);
      const fields = part
        .map(
          (e, j) =>
            `f${j}: object(oid: "${e.sha.replace(/[^0-9a-f]/g, '')}") { ... on Blob { text isBinary } }`,
        )
        .join('\n');
      const query = `query($o: String!, $r: String!) { repository(owner: $o, name: $r) { ${fields} } }`;
      const res = await this.h.send({
        url: this.graphql,
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ query, variables: { o: this.cfg.owner, r: this.cfg.repo } }),
      });
      const body = res.json<{
        data?: { repository?: Record<string, { text: string | null; isBinary: boolean } | null> };
        errors?: { message: string }[];
      }>();
      if (!body.data?.repository)
        throw new ForgeError(body.errors?.[0]?.message ?? 'GraphQL error', 502);
      part.forEach((e, j) => {
        const o = body.data?.repository?.[`f${j}`];
        if (o && typeof o.text === 'string')
          out.set(e.path, { bytes: new TextEncoder().encode(o.text) });
      });
    }
    await mapLimit(binary, 6, async (e) => {
      const res = await this.h.send(
        {
          url: this.repoUrl(`/git/blobs/${e.sha}`),
          headers: { accept: 'application/vnd.github.raw' },
        },
        (s) => s === 200 || s === 404,
      );
      if (res.status === 200) out.set(e.path, { bytes: res.bytes() });
    });
    return out;
  }

  async readFile(path: string, ref: CommitSha): Promise<Uint8Array | null> {
    const res = await this.h.send(
      {
        url: this.repoUrl(
          `/contents/${path.split('/').map(encodeURIComponent).join('/')}?ref=${encodeURIComponent(ref)}`,
        ),
        headers: { accept: 'application/vnd.github.raw' },
      },
      (s) => s === 200 || s === 404,
    );
    return res.status === 200 ? res.bytes() : null;
  }

  async commit(
    parent: CommitSha | null,
    changes: FileChange[],
  ): Promise<CommitResult | 'conflict'> {
    const branch = await this.getBranch();
    if (parent === null) return this.firstCommit(branch, changes);
    const parentCommit = (await this.h.send({ url: this.repoUrl(`/git/commits/${parent}`) })).json<{
      tree: { sha: string };
    }>();
    // Binary files become blobs first; text records go inline in the tree payload.
    const items = await mapLimit(changes, 6, async (c) => {
      if (c.action === 'delete') return { path: c.path, mode: '100644', type: 'blob', sha: null };
      if (typeof c.content === 'string')
        return { path: c.path, mode: '100644', type: 'blob', content: c.content };
      const blob = await this.h.send({
        url: this.repoUrl('/git/blobs'),
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ content: bytesToBase64(c.content), encoding: 'base64' }),
      });
      return { path: c.path, mode: '100644', type: 'blob', sha: blob.json<{ sha: string }>().sha };
    });
    let tree = parentCommit.tree.sha;
    for (let i = 0; i < items.length; i += TREE_CHUNK) {
      const res = await this.h.send({
        url: this.repoUrl('/git/trees'),
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ base_tree: tree, tree: items.slice(i, i + TREE_CHUNK) }),
      });
      tree = res.json<{ sha: string }>().sha;
    }
    const date = new Date().toISOString();
    const commit = await this.h.send({
      url: this.repoUrl('/git/commits'),
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        message: COMMIT_MESSAGE,
        tree,
        parents: [parent],
        author: { ...COMMIT_AUTHOR, date },
        committer: { ...COMMIT_AUTHOR, date },
      }),
    });
    const sha = commit.json<{ sha: string }>().sha;
    // Compare-and-swap: force:false fails with 422 if the branch moved (SYNC.md §7).
    const ref = await this.h.send(
      {
        url: this.repoUrl(`/git/refs/heads/${encodeURIComponent(branch)}`),
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sha, force: false }),
      },
      (s) => s === 200 || s === 422 || s === 409,
    );
    if (ref.status !== 200) return 'conflict';
    return { sha, parents: [parent] };
  }

  /** The git-data API refuses empty repos, so the first file goes through the contents API. */
  private async firstCommit(
    branch: string,
    changes: FileChange[],
  ): Promise<CommitResult | 'conflict'> {
    const [c] = changes;
    if (changes.length !== 1 || !c || c.action !== 'upsert') {
      throw new Error('The first commit must create exactly one file');
    }
    const bytes = typeof c.content === 'string' ? new TextEncoder().encode(c.content) : c.content;
    const res = await this.h.send(
      {
        url: this.repoUrl(`/contents/${c.path.split('/').map(encodeURIComponent).join('/')}`),
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          message: COMMIT_MESSAGE,
          content: bytesToBase64(bytes),
          branch,
          author: COMMIT_AUTHOR,
          committer: COMMIT_AUTHOR,
        }),
      },
      (s) => s === 201 || s === 200 || s === 409 || s === 422,
    );
    if (res.status === 409 || res.status === 422) {
      // The branch doesn't exist on a truly empty repo: retry without it.
      const retry = await this.h.send(
        {
          url: this.repoUrl(`/contents/${encodeURIComponent(c.path)}`),
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            message: COMMIT_MESSAGE,
            content: bytesToBase64(bytes),
            author: COMMIT_AUTHOR,
            committer: COMMIT_AUTHOR,
          }),
        },
        (s) => s === 201 || s === 200 || s === 409 || s === 422,
      );
      if (retry.status >= 300) return 'conflict';
      return { sha: retry.json<{ commit: { sha: string } }>().commit.sha, parents: [] };
    }
    return { sha: res.json<{ commit: { sha: string } }>().commit.sha, parents: [] };
  }

  rateLimit() {
    return { ...this.h.rate };
  }
}

export { base64ToBytes };
