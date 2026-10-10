// The forge as the sync engine sees it (SYNC.md §7, ADR-020). GitHub, GitLab
// and the fake forge implement this; the engine never talks HTTP itself.

export type CommitSha = string;

export interface TreeEntry {
  /** The entry's name inside its directory (not the full path). */
  name: string;
  sha: string;
  type: 'blob' | 'tree';
}

export type FileChange =
  { path: string; content: string | Uint8Array } | { path: string; delete: true };

export interface RateLimitState {
  /** Requests (or points) left in the current window, if the forge says. */
  remaining: number | null;
  /** When the window resets, in ms since the epoch. */
  resetAt: number | null;
}

export interface SyncTransport {
  /** The branch head, or null if the repo has no commits yet. */
  getHead(): Promise<CommitSha | null>;
  /**
   * Lists one directory of `commit`. `path` is '' for the root. `sha` is the
   * directory's tree SHA from its parent's listing (undefined for the root);
   * GitHub lists by SHA, GitLab by path and ref.
   */
  listTree(commit: CommitSha, path: string, sha: string | undefined): Promise<TreeEntry[]>;
  /** Reads blobs by SHA, batched as the forge allows. Missing ones are left out. */
  readBlobs(entries: readonly { path: string; sha: string }[]): Promise<Map<string, Uint8Array>>;
  /** Reads one file at a commit (`lm.json`), or null if it doesn't exist. */
  readFile(path: string, commit: CommitSha): Promise<Uint8Array | null>;
  /**
   * Creates one commit on top of `parent` and moves the branch to it, only if
   * the branch is still at `parent` (compare-and-swap). Returns 'conflict' if
   * it moved. `parent` is null only for the first commit of an empty repo.
   */
  commit(parent: CommitSha | null, changes: readonly FileChange[]): Promise<CommitSha | 'conflict'>;
  rateLimit(): RateLimitState;
}

/** The forge refused because of its rate limit; retry after `resetAt`. */
export class RateLimitedError extends Error {
  override name = 'RateLimitedError';
  constructor(readonly resetAt: number | null) {
    super('rate limited by the forge');
  }
}

/** The token was rejected (expired or revoked): sync pauses until it's fixed (SYNC.md §10). */
export class AuthError extends Error {
  override name = 'AuthError';
}
