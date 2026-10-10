// In-memory forge with GitHub-style (branch CAS) or GitLab-style (per-file
// last_commit_id) concurrency, plus fault injection (SYNC.md §7 "Fake").

import { gitBlobSha, sha1Hex, toBytes } from '../gitsha';
import type {
  CommitResult,
  CommitSha,
  FileChange,
  ReadResult,
  SyncTransport,
  TreeEntry,
} from '../transport';
import { RateLimitedError, SyncAuthError } from '../transport';

interface FileObj {
  sha: string;
  bytes: Uint8Array;
  /** Commit that last changed this file (GitLab's last_commit_id). */
  lastCommit: string;
}

interface Commit {
  sha: string;
  parents: string[];
  files: Map<string, FileObj>;
}

export interface FakeForgeOptions {
  mode?: 'github' | 'gitlab';
  /** Return 'truncated' from recursive listings (forces the Merkle walk). */
  truncateRecursive?: boolean;
}

/** Shared server state; give each device its own `FakeTransport` view onto it. */
export class FakeForge {
  readonly commits = new Map<string, Commit>();
  head: string | null = null;
  counter = 0;
  /** Count of API calls, for rate-limit/efficiency assertions. */
  calls = 0;
  /** Fault injection: called before each operation; may throw. */
  beforeOp: ((op: string) => void | Promise<void>) | null = null;
  isPrivate = true;
  constructor(readonly opts: FakeForgeOptions = {}) {}

  async hook(op: string): Promise<void> {
    this.calls++;
    if (this.beforeOp) await this.beforeOp(op);
  }

  filesAt(commit: string): Map<string, FileObj> {
    const c = this.commits.get(commit);
    if (!c) throw new Error(`unknown commit ${commit}`);
    return c.files;
  }

  /** Deterministic fake tree sha for a directory (changes iff anything beneath changes). */
  async treeSha(files: Map<string, FileObj>, dir: string): Promise<string> {
    const prefix = dir ? `${dir}/` : '';
    const parts = [...files.entries()]
      .filter(([p]) => p.startsWith(prefix))
      .map(([p, f]) => `${p}:${f.sha}`)
      .sort()
      .join('\n');
    return sha1Hex(new TextEncoder().encode(`tree:${dir}\n${parts}`));
  }

  /** Simulate compaction (SYNC.md §9): an orphan commit with only `keep` files. */
  async compact(keep: (path: string) => boolean): Promise<void> {
    if (!this.head) return;
    const files = new Map([...this.filesAt(this.head)].filter(([p]) => keep(p)));
    const sha = await sha1Hex(new TextEncoder().encode(`orphan${this.counter++}`));
    for (const f of files.values()) f.lastCommit = sha;
    this.commits.set(sha, { sha, parents: [], files });
    this.head = sha;
  }
}

export class FakeTransport implements SyncTransport {
  readonly kind = 'fake' as const;
  constructor(readonly forge: FakeForge) {}

  async getHead(): Promise<CommitSha | null> {
    await this.forge.hook('getHead');
    return this.forge.head;
  }

  async listTree(commit: CommitSha, path: string): Promise<TreeEntry[]> {
    await this.forge.hook('listTree');
    const files = this.forge.filesAt(commit);
    const prefix = path ? `${path}/` : '';
    const out = new Map<string, TreeEntry>();
    for (const [p, f] of files) {
      if (!p.startsWith(prefix)) continue;
      const rest = p.slice(prefix.length);
      const slash = rest.indexOf('/');
      if (slash < 0) out.set(p, { path: p, sha: f.sha, type: 'blob' });
      else {
        const dir = prefix + rest.slice(0, slash);
        if (!out.has(dir))
          out.set(dir, { path: dir, sha: await this.forge.treeSha(files, dir), type: 'tree' });
      }
    }
    return [...out.values()];
  }

  async listTreeRecursive(commit: CommitSha): Promise<TreeEntry[] | 'truncated'> {
    await this.forge.hook('listTreeRecursive');
    if (this.forge.opts.truncateRecursive) return 'truncated';
    const files = this.forge.filesAt(commit);
    const dirs = new Set<string>();
    const out: TreeEntry[] = [];
    for (const [p, f] of files) {
      out.push({ path: p, sha: f.sha, type: 'blob' });
      const segs = p.split('/');
      for (let i = 1; i < segs.length; i++) dirs.add(segs.slice(0, i).join('/'));
    }
    for (const d of dirs)
      out.push({ path: d, sha: await this.forge.treeSha(files, d), type: 'tree' });
    return out;
  }

  async readFiles(
    commit: CommitSha,
    entries: { path: string; sha: string }[],
  ): Promise<Map<string, ReadResult>> {
    await this.forge.hook('readFiles');
    const files = this.forge.filesAt(commit);
    const out = new Map<string, ReadResult>();
    for (const e of entries) {
      const f = files.get(e.path);
      if (f) out.set(e.path, { bytes: f.bytes, meta: f.lastCommit });
    }
    return out;
  }

  async readFile(path: string, ref: CommitSha): Promise<Uint8Array | null> {
    await this.forge.hook('readFile');
    return this.forge.filesAt(ref).get(path)?.bytes ?? null;
  }

  async commit(
    parent: CommitSha | null,
    changes: FileChange[],
  ): Promise<CommitResult | 'conflict'> {
    await this.forge.hook('commit');
    const f = this.forge;
    const gitlab = f.opts.mode === 'gitlab';
    if (!gitlab && parent !== f.head) return 'conflict';
    const base = f.head ? f.filesAt(f.head) : new Map<string, FileObj>();
    if (gitlab) {
      for (const c of changes) {
        const cur = base.get(c.path);
        if (c.action === 'upsert' && !c.exists && cur) return 'conflict';
        if ((c.action === 'delete' || c.exists) && (!cur || (c.meta && c.meta !== cur.lastCommit)))
          return 'conflict';
      }
    }
    const sha = await sha1Hex(new TextEncoder().encode(`commit${f.counter++}`));
    const files = new Map(base);
    const meta: Record<string, string> = {};
    for (const c of changes) {
      if (c.action === 'delete') files.delete(c.path);
      else {
        const bytes = toBytes(c.content);
        files.set(c.path, { sha: await gitBlobSha(bytes), bytes, lastCommit: sha });
        meta[c.path] = sha;
      }
    }
    const parents = f.head ? [f.head] : [];
    f.commits.set(sha, { sha, parents, files });
    f.head = sha;
    return { sha, parents, meta };
  }

  rateLimit() {
    return { remaining: null, resetAt: null };
  }

  async checkAccess() {
    await this.forge.hook('checkAccess');
    return { private: this.forge.isPrivate, canWrite: true, defaultBranch: 'main' };
  }
}

/** Fault helpers for tests. */
export const faults = {
  authFail: () => {
    throw new SyncAuthError();
  },
  rateLimited: () => {
    throw new RateLimitedError(Date.now() + 60_000);
  },
};
