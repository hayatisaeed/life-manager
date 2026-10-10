import { decodeRecord, mergeRecords, type EntityRecord, type KeptReason, type Rng } from '@lm/core';
import { decryptRecord, encryptRecord, recordPath, type SubKeys } from '@lm/crypto';
import type { LmDatabase, SyncTx } from '@lm/db';
import { gitBlobSha } from './git-sha';
import {
  AuthError,
  RateLimitedError,
  type CommitSha,
  type FileChange,
  type SyncTransport,
} from './transport';

// The sync cycle (SYNC.md §5, ADR-020):
//   1. read the head; if it moved, walk changed trees (Merkle diff), fetch the
//      changed record files, decrypt, decode and merge them into the local DB;
//   2. push every record in the change log as one commit with compare-and-swap
//      on the branch; on conflict, back off and start again from 1;
//   3. remember the head as lastSyncedCommit.

/** Why a remote file was kept instead of applied. Kept files are never deleted. */
export type KeepReason =
  KeptReason | 'decryptFailed' | 'notJson' | 'wrongPath' | 'localUndecodable';

export type SyncOutcome =
  | {
      status: 'ok';
      pulled: number;
      pushed: number;
      kept: number;
      restored: string[];
      issues: string[];
    }
  | { status: 'conflict'; attempts: number }
  | { status: 'rateLimited'; resetAt: number | null }
  | { status: 'authError'; message: string }
  | { status: 'error'; message: string };

export interface SyncEngineOptions {
  db: LmDatabase;
  transport: SyncTransport;
  keys: SubKeys;
  rng: Rng;
  /** Injected so tests and the simulator don't wait for real. */
  sleep?: (ms: number) => Promise<void>;
  /** Conflict retries per cycle (SYNC.md §5: max 5). */
  maxAttempts?: number;
  /** Base delay for exponential backoff on conflicts, in ms. */
  backoffMs?: number;
  /** Remote records read and applied per transaction. */
  batchSize?: number;
  /** Files per commit; a longer change log is pushed over several commits. */
  maxFilesPerCommit?: number;
  /** Skip the cycle when the forge reports fewer requests left than this. */
  minRateLimitRemaining?: number;
  clock?: () => number;
}

const RECORDS_DIR = 'r';
const META_LAST = 'lastSyncedCommit';

interface PullStats {
  pulled: number;
  kept: number;
  restored: string[];
  issues: string[];
}

export class SyncEngine {
  private running: Promise<SyncOutcome> | null = null;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly maxAttempts: number;
  private readonly backoffMs: number;
  private readonly batchSize: number;
  private readonly maxFilesPerCommit: number;
  private readonly minRemaining: number;
  private readonly clock: () => number;

  constructor(private readonly options: SyncEngineOptions) {
    this.sleep = options.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.maxAttempts = options.maxAttempts ?? 5;
    this.backoffMs = options.backoffMs ?? 1000;
    this.batchSize = options.batchSize ?? 100;
    this.maxFilesPerCommit = options.maxFilesPerCommit ?? 500;
    this.minRemaining = options.minRateLimitRemaining ?? 50;
    this.clock = options.clock ?? Date.now;
  }

  /**
   * Runs one sync cycle. Only one runs at a time per engine: a call while one
   * is running gets that cycle's result (SYNC.md §5, the lock). Across tabs
   * the web shell holds a Web Lock (ADR-011).
   */
  sync(): Promise<SyncOutcome> {
    this.running ??= this.cycle().finally(() => {
      this.running = null;
    });
    return this.running;
  }

  private async cycle(): Promise<SyncOutcome> {
    const { transport } = this.options;
    const limit = transport.rateLimit();
    if (
      limit.remaining !== null &&
      limit.remaining < this.minRemaining &&
      (limit.resetAt === null || limit.resetAt > this.clock())
    ) {
      return { status: 'rateLimited', resetAt: limit.resetAt };
    }
    const stats: PullStats = { pulled: 0, kept: 0, restored: [], issues: [] };
    let pushed = 0;
    try {
      for (let attempt = 1; ; attempt++) {
        const head = await transport.getHead();
        if (head === null)
          throw new Error('The repository has no commits; set it up first (SYNC.md §8)');
        await this.pull(head, stats);
        const result = await this.push(head);
        if (result !== 'conflict') {
          pushed += result.pushed;
          if (!result.more) {
            return { status: 'ok', pushed, ...stats };
          }
          // More than one commit's worth of changes: go round again without a
          // delay, starting from the head we just made.
          attempt = 0;
          continue;
        }
        if (attempt >= this.maxAttempts) return { status: 'conflict', attempts: attempt };
        // Exponential backoff with jitter, so two devices racing don't retry in lockstep.
        await this.sleep(this.backoffMs * 2 ** (attempt - 1) * (1 + this.options.rng()));
      }
    } catch (error) {
      if (error instanceof RateLimitedError)
        return { status: 'rateLimited', resetAt: error.resetAt };
      if (error instanceof AuthError) return { status: 'authError', message: error.message };
      return { status: 'error', message: error instanceof Error ? error.message : String(error) };
    }
  }

  // --- pull ------------------------------------------------------------------

  private async pull(head: CommitSha, stats: PullStats): Promise<void> {
    const { db } = this.options;
    const last = await db.syncTransaction((tx) => tx.getMeta(META_LAST));
    if (last === head) return;

    const remote = await db.syncTransaction((tx) => tx.remote());
    const walk = await this.diff(head, remote);

    for (let i = 0; i < walk.changed.length; i += this.batchSize) {
      const batch = walk.changed.slice(i, i + this.batchSize);
      const blobs = await this.options.transport.readBlobs(batch);
      await db.syncTransaction(async (tx) => {
        const dirty = new Set((await tx.changeLog()).map((c) => c.recordId));
        for (const { path, sha } of batch) {
          const bytes = blobs.get(path);
          if (!bytes) throw new Error(`The forge did not return ${path}`);
          await this.applyFile(tx, path, sha, bytes, dirty, stats);
          await tx.setRemote(path, sha, 'blob');
        }
      });
    }

    await db.syncTransaction(async (tx) => {
      for (const path of walk.removed) await tx.deleteRemote(path);
      for (const [path, sha] of walk.trees) await tx.setRemote(path, sha, 'tree');
      await tx.setMeta(META_LAST, head);
    });
  }

  /**
   * Merkle diff (SYNC.md §5): compare tree SHAs top-down and list only the
   * directories that changed since the snapshot in sync_remote.
   */
  private async diff(head: CommitSha, remote: ReadonlyMap<string, { sha: string; kind: string }>) {
    const { transport } = this.options;
    const changed: { path: string; sha: string }[] = [];
    const removed: string[] = [];
    const trees = new Map<string, string>();

    const root = await transport.listTree(head, '', undefined);
    const records = root.find((e) => e.name === RECORDS_DIR && e.type === 'tree');
    if (!records) {
      // No records at all any more: forget the whole snapshot below r/.
      for (const known of remote.keys()) {
        if (known === RECORDS_DIR || known.startsWith(`${RECORDS_DIR}/`)) removed.push(known);
      }
      return { changed, removed, trees };
    }

    const visit = async (path: string, sha: string): Promise<void> => {
      trees.set(path, sha);
      if (remote.get(path)?.sha === sha) return;
      const entries = await transport.listTree(head, path, sha);
      const seen = new Set<string>();
      for (const e of entries) {
        const child = `${path}/${e.name}`;
        seen.add(child);
        if (e.type === 'tree') await visit(child, e.sha);
        else if (remote.get(child)?.sha !== e.sha) changed.push({ path: child, sha: e.sha });
      }
      // Anything we knew below this directory whose top-level entry is gone
      // (compaction, or a directory emptied), at any depth: the snapshot may
      // not know the directories in between. Local records stay; only the
      // snapshot forgets them.
      for (const known of remote.keys()) {
        if (!known.startsWith(`${path}/`)) continue;
        const top = `${path}/${known.slice(path.length + 1).split('/')[0] ?? ''}`;
        if (!seen.has(top)) removed.push(known);
      }
    };
    await visit(RECORDS_DIR, records.sha);
    return { changed, removed, trees };
  }

  /** Decrypts, checks, decodes and merges one remote record file (SYNC.md §5, §10). */
  private async applyFile(
    tx: SyncTx,
    path: string,
    sha: string,
    bytes: Uint8Array,
    dirty: ReadonlySet<string>,
    stats: PullStats,
  ) {
    const { keys } = this.options;
    const keep = async (
      reason: KeepReason,
      issues: string[],
      extra: { recordId?: string; raw?: unknown } = {},
    ) => {
      stats.kept++;
      await tx.keep({ path, blobSha: sha, reason, issues, ...extra });
    };

    let plaintext: Uint8Array;
    try {
      plaintext = decryptRecord(
        keys,
        path,
        new TextDecoder('utf-8', { fatal: true }).decode(bytes),
      );
    } catch (error) {
      return keep('decryptFailed', [error instanceof Error ? error.message : String(error)]);
    }
    let raw: unknown;
    try {
      raw = JSON.parse(new TextDecoder().decode(plaintext));
    } catch {
      return keep('notJson', ['decrypted content is not JSON']);
    }
    const id = typeof raw === 'object' && raw !== null && 'id' in raw ? raw.id : undefined;
    // The AEAD binds the file to its name; this binds the name to the id inside (ADR-019).
    if (typeof id !== 'string' || recordPath(keys, id) !== path) {
      return keep('wrongPath', ['record id does not match its path'], { raw });
    }
    const decoded = decodeRecord(raw);
    if (decoded.status === 'kept')
      return keep(decoded.reason, decoded.issues, { recordId: id, raw });
    const theirs = decoded.record;

    tx.receive(theirs.hlc);
    const local = await tx.get(theirs.type, theirs.id);
    if (local.status === 'undecodable') {
      // Never overwrite a local row this version can't read.
      return keep('localUndecodable', ['the local copy of this record cannot be read'], {
        recordId: id,
        raw,
      });
    }
    await tx.unkeep(path);
    stats.pulled++;

    if (local.status === 'missing' || !dirty.has(theirs.id)) {
      await tx.put(theirs, { dirty: false });
      await tx.setBase(theirs);
      return;
    }
    const baseRaw = await tx.base(theirs.id);
    const base = baseRaw === null ? null : decodeRecord(baseRaw);
    const merged = mergeRecords(base?.status === 'ok' ? base.record : null, local.record, theirs);
    if (merged.restored) stats.restored.push(theirs.id);
    stats.issues.push(...merged.issues.map((i) => `${theirs.type} ${theirs.id}: ${i}`));
    // The merge differs from theirs, so it stays in the change log and is pushed next.
    await tx.put(merged.record, { dirty: true });
    await tx.setBase(theirs);
  }

  // --- push ------------------------------------------------------------------

  private async push(head: CommitSha): Promise<'conflict' | { pushed: number; more: boolean }> {
    const { db, keys, transport } = this.options;
    const prepared = await db.syncTransaction(async (tx) => {
      const log = await tx.changeLog();
      const out: { record: EntityRecord; path: string; content: string }[] = [];
      for (const entry of log.slice(0, this.maxFilesPerCommit)) {
        const local = await tx.get(entry.type, entry.recordId);
        if (local.status !== 'ok') continue;
        const content = encryptRecord(
          keys,
          local.record.id,
          new TextEncoder().encode(JSON.stringify(local.record)),
        );
        out.push({ record: local.record, path: recordPath(keys, local.record.id), content });
      }
      return { files: out, more: log.length > this.maxFilesPerCommit };
    });
    if (prepared.files.length === 0) return { pushed: 0, more: false };

    const changes: FileChange[] = prepared.files.map((f) => ({ path: f.path, content: f.content }));
    const newHead = await transport.commit(head, changes);
    if (newHead === 'conflict') return 'conflict';

    await db.syncTransaction(async (tx) => {
      for (const f of prepared.files) {
        await tx.setBase(f.record);
        await tx.clearDirty(f.record.id, f.record.hlc);
        await tx.setRemote(f.path, gitBlobSha(new TextEncoder().encode(f.content)), 'blob');
        // The directories above the file changed; forget their SHAs so the
        // next walk lists them (and finds our blob already known).
        for (const dir of parents(f.path)) await tx.deleteRemote(dir);
      }
      // A rebased commit sits on changes we haven't pulled, so remember the
      // head we pulled instead: the next cycle walks the new head and picks
      // them up (our own blobs are already in the snapshot, so they aren't
      // downloaded again).
      await tx.setMeta(META_LAST, typeof newHead === 'string' ? newHead : head);
    });
    return { pushed: prepared.files.length, more: prepared.more };
  }
}

/** 'r/ab/cd/x.lmr' → ['r', 'r/ab', 'r/ab/cd'] */
function parents(path: string): string[] {
  const parts = path.split('/').slice(0, -1);
  return parts.map((_, i) => parts.slice(0, i + 1).join('/'));
}
