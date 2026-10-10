// @lm/sync: the sync engine and forge transports (SYNC.md, ADR-020).
export { SyncEngine, type KeepReason, type SyncEngineOptions, type SyncOutcome } from './engine';
export { FakeForge, type FakeForgeHooks } from './fake-forge';
export { gitBlobSha } from './git-sha';
export {
  AuthError,
  RateLimitedError,
  type CommitSha,
  type FileChange,
  type RateLimitState,
  type SyncTransport,
  type TreeEntry,
} from './transport';
