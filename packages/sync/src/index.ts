// @lm/sync: the sync engine and forge transports (SYNC.md, ADR-020).
export { SyncEngine, type KeepReason, type SyncEngineOptions, type SyncOutcome } from './engine';
export { FakeForge, type FakeForgeHooks, type FakeForgeOptions } from './fake-forge';
export { GitHubTransport, type GitHubTransportOptions } from './github';
export { GitLabTransport, type GitLabTransportOptions } from './gitlab';
export { ForgeHttpError, ForgeResponseError, type Fetch } from './http';
export { gitBlobSha } from './git-sha';
export {
  AuthError,
  RateLimitedError,
  type CommitResult,
  type CommitSha,
  type FileChange,
  type RateLimitState,
  type SyncTransport,
  type TreeEntry,
} from './transport';
