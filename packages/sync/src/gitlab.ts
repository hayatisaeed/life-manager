import { z } from 'zod';
import {
  COMMIT_AUTHOR,
  COMMIT_MESSAGE,
  ForgeHttpError,
  RateLimitTracker,
  bytes,
  errorMessage,
  headerNumber,
  json,
  mapLimit,
  throwForAuthOrLimit,
  toBase64,
  type Fetch,
} from './http';
import type {
  CommitResult,
  CommitSha,
  FileChange,
  RateLimitState,
  SyncTransport,
  TreeEntry,
} from './transport';

// The GitLab transport (SYNC.md §7). GitLab has no "move the branch only if
// it is still at X", so the compare-and-swap is per file: every update or
// delete names the file's `last_commit_id` as of our parent, and a create
// fails if the file already exists. A commit that touches only files nobody
// else changed lands on the current head even if that moved; that is safe
// because records merge per file, and the engine is told (`rebased`) so it
// pulls the commits it skipped.

export interface GitLabTransportOptions {
  /** Default https://gitlab.com; self-managed: the instance URL. */
  baseUrl?: string;
  /** Numeric project id or the full path ("group/project"). */
  project: string;
  branch: string;
  /** A project access token (Developer) or a PAT with `api`. From platform.secrets. */
  token: string;
  fetch: Fetch;
  now?: () => number;
  /** Concurrent requests for blob reads and file lookups (SYNC.md §7: 6). */
  concurrency?: number;
}

const PER_PAGE = 100;
const branchBody = z.object({ commit: z.object({ id: z.string() }) });
const treeBody = z.array(z.object({ id: z.string(), name: z.string(), type: z.string() }));
const fileBody = z.object({ last_commit_id: z.string() });
const commitBody = z.object({ id: z.string(), parent_ids: z.array(z.string()) });

// The commits API answers a failed per-file check with 400 and one of these
// messages (create on an existing file; update or delete of a missing one;
// a stale last_commit_id).
const CAS_FAILURE = /already exists|doesn't exist|does not exist|has changed since/i;

type Method = 'GET' | 'POST';

export class GitLabTransport implements SyncTransport {
  private readonly api: string;
  private readonly limits: RateLimitTracker;
  private readonly concurrency: number;
  /**
   * path → the commit that last changed it, for files this device pushed.
   * Saves a lookup per file on the next push; a stale entry only costs one
   * refused commit (the check fails safe), after which the map is cleared.
   */
  private readonly lastCommit = new Map<string, string>();

  constructor(private readonly options: GitLabTransportOptions) {
    const base = (options.baseUrl ?? 'https://gitlab.com').replace(/\/+$/, '');
    this.api = `${base}/api/v4/projects/${encodeURIComponent(options.project)}`;
    this.limits = new RateLimitTracker(options.now ?? Date.now);
    this.concurrency = options.concurrency ?? 6;
  }

  rateLimit(): RateLimitState {
    return this.limits.current();
  }

  async getHead(): Promise<CommitSha | null> {
    const res = await this.request(
      'GET',
      `/repository/branches/${encodeURIComponent(this.options.branch)}`,
      { allow: [404] },
    );
    if (res.status === 404) {
      // An empty project has no branches. Any other 404 (no such project, or
      // a token that can't see it) is an error, not "empty".
      if (/branch not found/i.test(await errorMessage(res))) return null;
      throw new ForgeHttpError(404, 'GitLab GET repository/branches');
    }
    return (await json(res, branchBody, 'read the branch head')).commit.id;
  }

  async listTree(commit: CommitSha, path: string): Promise<TreeEntry[]> {
    const out: TreeEntry[] = [];
    // Offset pages: directories are small (SYNC.md §1), so at most a few pages,
    // and no dependence on the Link header being exposed to the browser.
    for (let page = 1; ; page++) {
      const query = new URLSearchParams({
        ref: commit,
        per_page: String(PER_PAGE),
        page: String(page),
      });
      if (path !== '') query.set('path', path);
      const res = await this.request('GET', `/repository/tree?${query.toString()}`, {
        allow: [404],
      });
      if (res.status === 404) return []; // "Tree Not Found": the directory is gone
      const entries = await json(res, treeBody, 'list a tree');
      for (const e of entries) {
        if (e.type === 'blob' || e.type === 'tree')
          out.push({ name: e.name, sha: e.id, type: e.type });
      }
      if (entries.length < PER_PAGE) return out;
    }
  }

  async readBlobs(
    entries: readonly { path: string; sha: string }[],
  ): Promise<Map<string, Uint8Array>> {
    const found = await mapLimit(entries, this.concurrency, async (e) => {
      const res = await this.request('GET', `/repository/blobs/${encodeURIComponent(e.sha)}/raw`, {
        allow: [404],
      });
      return res.status === 404 ? null : bytes(res);
    });
    const out = new Map<string, Uint8Array>();
    entries.forEach((e, i) => {
      const data = found[i];
      if (data) out.set(e.path, data);
    });
    return out;
  }

  async readFile(path: string, commit: CommitSha): Promise<Uint8Array | null> {
    const res = await this.request(
      'GET',
      `/repository/files/${encodeURIComponent(path)}/raw?ref=${encodeURIComponent(commit)}`,
      { allow: [404] },
    );
    return res.status === 404 ? null : bytes(res);
  }

  async commit(parent: CommitSha | null, changes: readonly FileChange[]): Promise<CommitResult> {
    const known = await mapLimit(changes, this.concurrency, (c) =>
      this.lastCommitAt(c.path, parent),
    );
    const actions = changes.flatMap((c, i): Record<string, string>[] => {
      const last = known[i] ?? null;
      if ('delete' in c) {
        // Already gone at our parent: nothing to delete.
        return last === null ? [] : [{ action: 'delete', file_path: c.path, last_commit_id: last }];
      }
      const content =
        typeof c.content === 'string'
          ? { content: c.content, encoding: 'text' }
          : { content: toBase64(c.content), encoding: 'base64' };
      return last === null
        ? [{ action: 'create', file_path: c.path, ...content }]
        : [{ action: 'update', file_path: c.path, last_commit_id: last, ...content }];
    });
    if (actions.length === 0) return parent ?? 'conflict';

    const res = await this.request('POST', '/repository/commits', {
      body: {
        branch: this.options.branch,
        commit_message: COMMIT_MESSAGE,
        author_name: COMMIT_AUTHOR.name,
        author_email: COMMIT_AUTHOR.email,
        actions,
      },
      allow: [400],
    });
    if (res.status === 400) {
      const message = await errorMessage(res);
      if (!CAS_FAILURE.test(message))
        throw new ForgeHttpError(400, 'GitLab POST repository/commits');
      this.lastCommit.clear();
      return 'conflict';
    }
    const created = await json(res, commitBody, 'create a commit');
    for (const c of changes) {
      if ('delete' in c) this.lastCommit.delete(c.path);
      else this.lastCommit.set(c.path, created.id);
    }
    const landedOn = created.parent_ids[0] ?? null;
    return landedOn === parent ? created.id : { sha: created.id, rebased: true };
  }

  /** The commit that last changed `path` as of `parent`, or null if it doesn't exist there. */
  private async lastCommitAt(path: string, parent: CommitSha | null): Promise<string | null> {
    if (parent === null) return null;
    const cached = this.lastCommit.get(path);
    if (cached !== undefined) return cached;
    const res = await this.request(
      'GET',
      `/repository/files/${encodeURIComponent(path)}?ref=${encodeURIComponent(parent)}`,
      { allow: [404] },
    );
    if (res.status === 404) return null;
    return (await json(res, fileBody, 'look up a file')).last_commit_id;
  }

  private async request(
    method: Method,
    path: string,
    opts: { body?: unknown; allow?: number[] } = {},
  ): Promise<Response> {
    const headers: Record<string, string> = { authorization: `Bearer ${this.options.token}` };
    if (opts.body !== undefined) headers['content-type'] = 'application/json';
    const res = await this.options.fetch(`${this.api}${path}`, {
      method,
      headers,
      cache: 'no-store',
      ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
    });
    const remaining = headerNumber(res, 'ratelimit-remaining');
    const reset = headerNumber(res, 'ratelimit-reset');
    const resetAt = reset === null ? null : reset * 1000;
    this.limits.update('api', remaining, resetAt);
    if (res.ok || opts.allow?.includes(res.status)) return res;
    const retryAfter = headerNumber(res, 'retry-after');
    throwForAuthOrLimit(res, {
      exhausted: remaining === 0,
      resetAt: retryAfter !== null ? (this.options.now ?? Date.now)() + retryAfter * 1000 : resetAt,
    });
    const endpoint = path.split('?')[0]?.split('/').slice(1, 3).join('/') ?? '';
    throw new ForgeHttpError(res.status, `GitLab ${method} ${endpoint}`);
  }
}
