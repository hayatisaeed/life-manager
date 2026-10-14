import { z } from 'zod';
const sha = z.string().regex(/^[0-9a-f]{40}$/);
export const treeEntrySchema = z.strictObject({
  path: z.string().min(1),
  sha,
  kind: z.enum(['tree', 'blob']),
});
export type TreeEntry = z.infer<typeof treeEntrySchema>;
export interface FileChange {
  path: string;
  content: Uint8Array;
}
export interface RateLimitState {
  remaining: number | null;
  resetAt: number | null;
}
export interface SyncTransport {
  getHead(): Promise<string>;
  getRoot(commit: string): Promise<string>;
  getTree(tree: string, path: string): Promise<TreeEntry[]>;
  getTreeRecursive?(commit: string): Promise<TreeEntry[] | 'truncated'>;
  readBlobs(entries: { path: string; sha: string }[]): Promise<Map<string, Uint8Array>>;
  readFile(path: string, commit: string): Promise<Uint8Array | null>;
  commit(parent: string, changes: FileChange[]): Promise<string | 'conflict'>;
  rateLimit(): RateLimitState;
}
export class SyncError extends Error {
  constructor(
    readonly code:
      | 'network'
      | 'authentication'
      | 'rate-limit'
      | 'invalid-remote'
      | 'update-required'
      | 'maintenance'
      | 'recovery-required'
      | 'conflict',
    readonly retryAt?: number,
  ) {
    super(code);
    this.name = 'SyncError';
  }
}
export const commitShaSchema = sha;
