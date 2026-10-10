// GitLab transport (SYNC.md §7): repository tree/files APIs and the commits API
// with multi-file actions. CAS uses per-file `last_commit_id` (P0.2 spike:
// the X-Gitlab-Last-Commit-Id header is exposed over CORS).

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
import { COMMIT_AUTHOR, COMMIT_MESSAGE, ForgeHttp, bytesToBase64, mapLimit } from './common';

export interface GitLabConfig {
  /** `https://gitlab.com` or a self-managed instance. */
  baseUrl?: string;
  /** `group/subgroup/project` or a numeric project id. */
  project: string;
  token: string;
  branch?: string;
}

const CONFLICT_MESSAGES = [
  /already exists/i,
  /has changed since/i,
  /doesn't exist/i,
  /does not exist/i,
  /not found/i,
];

export class GitLabTransport implements SyncTransport {
  readonly kind = 'gitlab' as const;
  private readonly api: string;
  private readonly h: ForgeHttp;
  private branch: string | null;

  constructor(http: HttpClient, cfg: GitLabConfig) {
    this.api = `${(cfg.baseUrl ?? 'https://gitlab.com').replace(/\/+$/, '')}/api/v4/projects/${encodeURIComponent(cfg.project)}`;
    this.branch = cfg.branch ?? null;
    this.h = new ForgeHttp(
      http,
      { authorization: `Bearer ${cfg.token}` },
      { remaining: 'ratelimit-remaining', reset: 'ratelimit-reset' },
    );
  }

  private async getBranch(): Promise<string> {
    if (!this.branch) this.branch = (await this.checkAccess()).defaultBranch;
    return this.branch;
  }

  async checkAccess() {
    const res = await this.h.send({ url: this.api }, (s) => s === 200 || s === 404);
    if (res.status === 404) throw new NotFoundRepoError();
    const p = res.json<{
      visibility: string;
      default_branch: string | null;
      permissions?: {
        project_access?: { access_level: number } | null;
        group_access?: { access_level: number } | null;
      };
    }>();
    const level = Math.max(
      p.permissions?.project_access?.access_level ?? 0,
      p.permissions?.group_access?.access_level ?? 0,
    );
    const defaultBranch = p.default_branch ?? 'main';
    this.branch ??= defaultBranch;
    // 30 = Developer, the minimum that can push.
    return { private: p.visibility === 'private', canWrite: level >= 30, defaultBranch };
  }

  async getHead(): Promise<CommitSha | null> {
    const branch = await this.getBranch();
    const res = await this.h.send(
      { url: `${this.api}/repository/branches/${encodeURIComponent(branch)}` },
      (s) => s === 200 || s === 404,
    );
    return res.status === 200 ? res.json<{ commit: { id: string } }>().commit.id : null;
  }

  private async pagedTree(
    commit: CommitSha,
    path: string,
    recursive: boolean,
  ): Promise<TreeEntry[]> {
    const out: TreeEntry[] = [];
    const params = new URLSearchParams({ ref: commit, per_page: '100', pagination: 'keyset' });
    if (path) params.set('path', path);
    if (recursive) params.set('recursive', 'true');
    let url: string | null = `${this.api}/repository/tree?${params}`;
    while (url) {
      const res = await this.h.send({ url }, (s) => s === 200 || s === 404);
      if (res.status === 404) return out;
      for (const e of res.json<{ id: string; path: string; type: string }[]>()) {
        if (e.type === 'blob' || e.type === 'tree')
          out.push({ path: e.path, sha: e.id, type: e.type });
      }
      url = nextLink(res.headers['link']);
    }
    return out;
  }

  listTree(commit: CommitSha, path: string): Promise<TreeEntry[]> {
    return this.pagedTree(commit, path, false);
  }

  listTreeRecursive(commit: CommitSha): Promise<TreeEntry[]> {
    return this.pagedTree(commit, '', true);
  }

  private fileUrl(path: string, ref: string): string {
    return `${this.api}/repository/files/${encodeURIComponent(path)}/raw?ref=${encodeURIComponent(ref)}`;
  }

  async readFiles(
    commit: CommitSha,
    entries: { path: string; sha: string }[],
  ): Promise<Map<string, ReadResult>> {
    const out = new Map<string, ReadResult>();
    await mapLimit(entries, 6, async (e) => {
      const res = await this.h.send(
        { url: this.fileUrl(e.path, commit) },
        (s) => s === 200 || s === 404,
      );
      if (res.status !== 200) return;
      const meta = res.headers['x-gitlab-last-commit-id'];
      out.set(e.path, meta ? { bytes: res.bytes(), meta } : { bytes: res.bytes() });
    });
    return out;
  }

  async readFile(path: string, ref: CommitSha): Promise<Uint8Array | null> {
    const res = await this.h.send({ url: this.fileUrl(path, ref) }, (s) => s === 200 || s === 404);
    return res.status === 200 ? res.bytes() : null;
  }

  async commit(
    parent: CommitSha | null,
    changes: FileChange[],
  ): Promise<CommitResult | 'conflict'> {
    const branch = await this.getBranch();
    const actions = changes.map((c) => {
      const base: Record<string, unknown> = { file_path: c.path };
      if (c.action === 'delete') {
        base['action'] = 'delete';
      } else {
        base['action'] = c.exists ? 'update' : 'create';
        if (typeof c.content === 'string') {
          base['content'] = c.content;
          base['encoding'] = 'text';
        } else {
          base['content'] = bytesToBase64(c.content);
          base['encoding'] = 'base64';
        }
      }
      if ((c.action === 'delete' || c.exists) && c.meta) base['last_commit_id'] = c.meta;
      return base;
    });
    const res = await this.h.send(
      {
        url: `${this.api}/repository/commits`,
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          branch,
          commit_message: COMMIT_MESSAGE,
          author_name: COMMIT_AUTHOR.name,
          author_email: COMMIT_AUTHOR.email,
          actions,
        }),
      },
      (s) => s === 201 || s === 400 || s === 409,
    );
    if (res.status !== 201) {
      let msg = '';
      try {
        msg = String(res.json<{ message?: unknown }>().message ?? '');
      } catch {
        /* ignore */
      }
      if (res.status === 409 || CONFLICT_MESSAGES.some((re) => re.test(msg))) return 'conflict';
      throw new ForgeError(msg || `HTTP ${res.status}`, res.status);
    }
    const body = res.json<{ id: string; parent_ids: string[] }>();
    const meta: Record<string, string> = {};
    for (const c of changes) if (c.action === 'upsert') meta[c.path] = body.id;
    void parent;
    return { sha: body.id, parents: body.parent_ids, meta };
  }

  rateLimit() {
    return { ...this.h.rate };
  }
}

function nextLink(link: string | undefined): string | null {
  if (!link) return null;
  for (const part of link.split(',')) {
    const m = /<([^>]+)>;\s*rel="next"/.exec(part);
    if (m?.[1]) return m[1];
  }
  return null;
}
