import { gitBlobSha } from './git-sha';
import {
  type CommitResult,
  type CommitSha,
  type FileChange,
  type RateLimitState,
  type SyncTransport,
  type TreeEntry,
} from './transport';

// An in-memory forge with exactly the CAS semantics of SYNC.md §7. Shared by
// every simulated device; tests can inject races, rate limits and failures.
//   'branch' (GitHub): a commit lands only if the branch is still at its parent.
//   'perFile' (GitLab, `last_commit_id`): it lands on the current head unless a
//   file it changes was changed after its parent.

interface Commit {
  parent: CommitSha | null;
  files: ReadonlyMap<string, string>; // path → blob sha
  /** path → the last commit that changed it (GitLab's `last_commit_id`). */
  touched: ReadonlyMap<string, CommitSha>;
}

export interface FakeForgeOptions {
  cas?: 'branch' | 'perFile';
}

export interface FakeForgeHooks {
  /** Runs before a commit is checked; a test can push a competing commit here. */
  beforeCommit?: () => Promise<void> | void;
  /** Called on every request; throw to simulate failures or rate limits. */
  onRequest?: (op: string) => void;
}

export class FakeForge {
  readonly blobs = new Map<string, Uint8Array>();
  private readonly commits = new Map<CommitSha, Commit>();
  private readonly trees = new Map<CommitSha, Map<string, TreeEntry[]>>();
  head: CommitSha | null = null;
  commitCount = 0;
  /** Commits refused because the branch had moved (CAS conflicts). */
  rejected = 0;
  requestCount = 0;
  /** Commits that landed on a newer head than their parent ('perFile' only). */
  rebased = 0;

  constructor(private readonly options: FakeForgeOptions = {}) {}

  /** A transport for one device. Each device gets its own hooks and rate-limit view. */
  transport(hooks: FakeForgeHooks = {}): SyncTransport & { hooks: FakeForgeHooks } {
    const request = (op: string) => {
      this.requestCount++;
      hooks.onRequest?.(op);
    };
    return {
      hooks,
      getHead: () => {
        request('getHead');
        return Promise.resolve(this.head);
      },
      listTree: (commit, path) => {
        request('listTree');
        return Promise.resolve(this.listTree(commit, path));
      },
      readBlobs: (entries) => {
        request('readBlobs');
        const out = new Map<string, Uint8Array>();
        for (const { path, sha } of entries) {
          const blob = this.blobs.get(sha);
          if (blob) out.set(path, blob.slice());
        }
        return Promise.resolve(out);
      },
      readFile: (path, commit) => {
        request('readFile');
        const sha = this.commits.get(commit)?.files.get(path);
        const blob = sha === undefined ? undefined : this.blobs.get(sha);
        return Promise.resolve(blob ? blob.slice() : null);
      },
      commit: async (parent, changes) => {
        request('commit');
        await hooks.beforeCommit?.();
        return this.commit(parent, changes);
      },
      rateLimit: (): RateLimitState => ({ remaining: null, resetAt: null }),
    };
  }

  /** Commits directly, as another device or a setup step would. */
  commit(parent: CommitSha | null, changes: readonly FileChange[]): CommitResult {
    const moved = parent !== this.head;
    if (moved) {
      const was = this.touched(parent);
      const now = this.touched(this.head);
      if (
        this.options.cas !== 'perFile' ||
        changes.some((c) => was.get(c.path) !== now.get(c.path))
      ) {
        this.rejected++;
        return 'conflict';
      }
    }
    const onto = this.head === null ? undefined : this.commits.get(this.head);
    const files = new Map(onto?.files);
    const touched = new Map(onto?.touched);
    const sha = `c${String(++this.commitCount).padStart(39, '0')}`;
    for (const change of changes) {
      if ('delete' in change) {
        files.delete(change.path);
      } else {
        const bytes =
          typeof change.content === 'string'
            ? new TextEncoder().encode(change.content)
            : change.content;
        const blobSha = gitBlobSha(bytes);
        this.blobs.set(blobSha, bytes.slice());
        files.set(change.path, blobSha);
      }
      touched.set(change.path, sha);
    }
    this.commits.set(sha, { parent: this.head, files, touched });
    this.head = sha;
    if (!moved) return sha;
    this.rebased++;
    return { sha, rebased: true };
  }

  private touched(commit: CommitSha | null): ReadonlyMap<string, CommitSha> {
    return (commit === null ? undefined : this.commits.get(commit)?.touched) ?? new Map();
  }

  /** Files at a commit (tests). */
  files(commit: CommitSha | null = this.head): ReadonlyMap<string, string> {
    return (commit === null ? undefined : this.commits.get(commit)?.files) ?? new Map();
  }

  private listTree(commit: CommitSha, path: string): TreeEntry[] {
    let cache = this.trees.get(commit);
    if (!cache) {
      cache = buildTrees(this.files(commit));
      this.trees.set(commit, cache);
    }
    return cache.get(path) ?? [];
  }
}

/**
 * Builds every directory listing of a commit. A tree's SHA is a hash of its
 * sorted listing, so it changes exactly when something below it changes:
 * the Merkle property the engine relies on.
 */
function buildTrees(files: ReadonlyMap<string, string>): Map<string, TreeEntry[]> {
  type Node = { type: 'blob'; sha: string } | { type: 'tree' };
  const children = new Map<string, Map<string, Node>>();
  const dir = (p: string) => {
    let d = children.get(p);
    if (!d) children.set(p, (d = new Map()));
    return d;
  };
  for (const [path, sha] of files) {
    const parts = path.split('/');
    parts.forEach((name, i) => {
      const node: Node = i === parts.length - 1 ? { type: 'blob', sha } : { type: 'tree' };
      dir(parts.slice(0, i).join('/')).set(name, node);
    });
  }
  const out = new Map<string, TreeEntry[]>();
  const list = (p: string): TreeEntry[] => {
    const entries = [...dir(p)]
      .map(([name, node]): TreeEntry => {
        const child = p === '' ? name : `${p}/${name}`;
        const sha =
          node.type === 'blob'
            ? node.sha
            : gitBlobSha(new TextEncoder().encode(JSON.stringify(list(child))));
        return { name, type: node.type, sha };
      })
      // Names are unique within a directory.
      .sort((a, b) => (a.name < b.name ? -1 : 1));
    out.set(p, entries);
    return entries;
  };
  list('');
  return out;
}
