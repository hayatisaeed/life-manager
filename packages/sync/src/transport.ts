// The forge abstraction (SYNC.md §7). GitHub, GitLab and the in-memory fake
// implement it with the same compare-and-swap semantics.

export type CommitSha = string;

export interface TreeEntry {
  /** Full path from the repo root, e.g. `r/ab/cd/abcd….lmr`. */
  path: string;
  sha: string;
  type: 'blob' | 'tree';
}

export interface ReadResult {
  bytes: Uint8Array;
  /** Transport-specific per-path state to hand back on commit (GitLab: last commit id). */
  meta?: string;
}

export type FileChange =
  | {
      action: 'upsert';
      path: string;
      content: string | Uint8Array;
      exists: boolean;
      meta?: string | null;
    }
  | { action: 'delete'; path: string; meta?: string | null };

export interface CommitResult {
  sha: CommitSha;
  /** The commit's parent(s). If the first parent isn't the head we built on, other commits landed in between. */
  parents: CommitSha[];
  /** Updated per-path meta for the files this commit wrote. */
  meta?: Record<string, string>;
}

export interface RateLimitState {
  remaining: number | null;
  /** Epoch ms when the budget resets. */
  resetAt: number | null;
}

export interface SyncTransport {
  readonly kind: 'github' | 'gitlab' | 'fake';
  /** Current head of the default branch, or null when the repo has no commits. */
  getHead(): Promise<CommitSha | null>;
  /** Entries directly under `path` ('' = root) at `commit`. `sha` is the dir's tree sha when known. */
  listTree(commit: CommitSha, path: string, sha?: string): Promise<TreeEntry[]>;
  /** Every entry in the repo at `commit`, or 'truncated' when the forge can't return them all. */
  listTreeRecursive(commit: CommitSha): Promise<TreeEntry[] | 'truncated'>;
  /** Read files (batched internally). Missing files are absent from the result. */
  readFiles(
    commit: CommitSha,
    entries: { path: string; sha: string }[],
  ): Promise<Map<string, ReadResult>>;
  readFile(path: string, ref: CommitSha): Promise<Uint8Array | null>;
  /** Atomic commit on top of `parent`. Returns 'conflict' when the CAS fails (SYNC.md §7). */
  commit(parent: CommitSha | null, changes: FileChange[]): Promise<CommitResult | 'conflict'>;
  rateLimit(): RateLimitState;
  /** Checks that the repo is private and the token can write (SYNC.md §8). */
  checkAccess(): Promise<{ private: boolean; canWrite: boolean; defaultBranch: string }>;
}

export class SyncAuthError extends Error {
  constructor(message = 'The forge rejected the access token') {
    super(message);
    this.name = 'SyncAuthError';
  }
}

export class RateLimitedError extends Error {
  constructor(public readonly resetAt: number | null) {
    super('API rate limit reached');
    this.name = 'RateLimitedError';
  }
}

export class ForgeError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = 'ForgeError';
  }
}

export class NotFoundRepoError extends Error {
  constructor() {
    super('Repository or branch not found');
    this.name = 'NotFoundRepoError';
  }
}
