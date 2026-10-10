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

/**
 * What `commit` did. A plain SHA: the commit sits directly on `parent`.
 * `rebased`: the forge put it on a newer head than `parent` because the
 * commits in between touched only other files (GitLab's per-file CAS, SYNC.md
 * §7), so the new head also holds changes this device hasn't pulled yet.
 */
export type CommitResult = CommitSha | 'conflict' | { sha: CommitSha; rebased: true };

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
   * it moved. A forge with per-file CAS (GitLab) instead returns 'conflict'
   * only if one of the changed files moved, and `rebased` if the commit landed
   * on a newer head. `parent` is null only for the first commit of an empty
   * repo; GitHub then takes exactly one file (`lm.json`, SYNC.md §8).
   */
  commit(parent: CommitSha | null, changes: readonly FileChange[]): Promise<CommitResult>;
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
