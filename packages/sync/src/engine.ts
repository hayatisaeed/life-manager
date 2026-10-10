// The sync cycle, SYNC.md §5:
//   1. read the forge head
//   2. if it moved: Merkle-diff the tree against our snapshot, fetch changed
//      record files, decrypt, 3-way merge with local edits, apply
//   3. push dirty records (and pending attachments) in one CAS commit
//   4. on a CAS conflict: back off, re-fetch, re-merge, retry (max 5 per cycle)
//
// Invariants (AGENTS.md §4.3): nothing is ever deleted because it failed to
// decrypt or parse; every merge goes through `mergeDetailed`; local edits made
// while a cycle runs are never overwritten (merge + write happen under the
// store lock, and change-log entries are only cleared if the HLC we pushed is
// still current).

import type { BlobRef, Env, Envelope } from '@lm/core';
import { deepEqual, instantFromMs, mergeDetailed, parseEnvelope } from '@lm/core';
import type { Keys } from '@lm/crypto';
import {
  CryptoError,
  assertRecordName,
  blobPath,
  decodeRecord,
  encodeRecord,
  nameFromRecordPath,
  recordPath,
} from '@lm/crypto';
import type { BlobStore, RemoteEntry, Store, SyncState } from '@lm/db';
import type { SqlStatement } from '@lm/platform';
import { redact } from '@lm/platform';
import { gitBlobSha } from './gitsha';
import type { CommitSha, FileChange, SyncTransport, TreeEntry } from './transport';
import { RateLimitedError, SyncAuthError } from './transport';

export type SyncPhase = 'idle' | 'syncing' | 'offline' | 'error' | 'paused' | 'rateLimited';

export interface SyncStatus {
  phase: SyncPhase;
  lastSyncAt: number | null;
  error: string | null;
  progress: { done: number; total: number } | null;
  /** Records restored because an edit beat a delete (UI shows a toast). */
  restored: number;
  /** Text merges that produced a conflict block. */
  conflicts: number;
  /** Records from a newer app version were seen (UI shows "update the app"). */
  newerSchema: boolean;
}

export interface SyncReport {
  pulled: number;
  pushed: number;
  restored: number;
  conflicts: number;
  problems: number;
  attempts: number;
  newerSchema: boolean;
}

export interface SyncEngineOptions {
  store: Store;
  state: SyncState;
  transport: SyncTransport;
  keys: Keys;
  env: Env;
  blobs?: BlobStore | null;
  /** 'auto': recursive listing on first sync (and on GitHub below ~50k entries), Merkle walk otherwise. */
  listing?: 'auto' | 'walk' | 'recursive';
  maxAttempts?: number;
  sleep?: (ms: number) => Promise<void>;
  /** Records fetched and merged per transaction. */
  chunkSize?: number;
}

const META_LAST = 'lastSyncedCommit';
const RECURSIVE_LIMIT = 50_000;

const isRecordPath = (p: string) => nameFromRecordPath(p) !== null;
const dirsOf = (path: string): string[] => {
  const segs = path.split('/');
  return segs.slice(0, -1).map((_, i) => segs.slice(0, i + 1).join('/'));
};

/** Finds BlobRef-shaped values anywhere in a record's data. */
export function blobRefsIn(v: unknown, out: BlobRef[] = []): BlobRef[] {
  if (Array.isArray(v)) for (const x of v) blobRefsIn(x, out);
  else if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    if (
      typeof o['hash'] === 'string' &&
      /^[0-9a-f]{64}$/.test(o['hash']) &&
      typeof o['mime'] === 'string'
    ) {
      out.push(o as unknown as BlobRef);
    } else for (const x of Object.values(o)) blobRefsIn(x, out);
  }
  return out;
}

export class SyncEngine {
  private running: Promise<SyncReport> | null = null;
  private listeners = new Set<(s: SyncStatus) => void>();
  private forceRefetch = new Set<string>();
  status: SyncStatus = {
    phase: 'idle',
    lastSyncAt: null,
    error: null,
    progress: null,
    restored: 0,
    conflicts: 0,
    newerSchema: false,
  };

  constructor(private readonly o: SyncEngineOptions) {}

  onStatus(cb: (s: SyncStatus) => void): () => void {
    this.listeners.add(cb);
    cb(this.status);
    return () => this.listeners.delete(cb);
  }

  private setStatus(p: Partial<SyncStatus>): void {
    this.status = { ...this.status, ...p };
    for (const l of this.listeners) l(this.status);
  }

  get isRunning(): boolean {
    return this.running !== null;
  }

  /** Run one cycle (coalesces concurrent calls). */
  sync(): Promise<SyncReport> {
    this.running ??= this.cycle().finally(() => {
      this.running = null;
    });
    return this.running;
  }

  private async cycle(): Promise<SyncReport> {
    const report: SyncReport = {
      pulled: 0,
      pushed: 0,
      restored: 0,
      conflicts: 0,
      problems: 0,
      attempts: 0,
      newerSchema: false,
    };
    const maxAttempts = this.o.maxAttempts ?? 5;
    const sleep = this.o.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
    this.setStatus({ phase: 'syncing', error: null, progress: null });
    try {
      for (;;) {
        report.attempts++;
        const head = await this.o.transport.getHead();
        if (head === null) throw new Error('The repository is empty; set it up first.');
        const last = await this.o.state.getMeta<string>(META_LAST);
        if (head !== last || this.forceRefetch.size) await this.pull(head, report);
        const r = await this.push(head, report);
        if (r !== 'conflict') break;
        if (report.attempts >= maxAttempts)
          throw new Error('Too many concurrent changes; will retry later.');
        const jitter = (this.o.env.random(1)[0] ?? 0) * 2;
        await sleep(250 * 2 ** (report.attempts - 1) + jitter);
      }
      this.setStatus({
        phase: 'idle',
        lastSyncAt: this.o.env.now(),
        progress: null,
        restored: report.restored,
        conflicts: report.conflicts,
        newerSchema: this.status.newerSchema || report.newerSchema,
      });
      return report;
    } catch (e) {
      if (e instanceof SyncAuthError)
        this.setStatus({ phase: 'paused', error: e.message, progress: null });
      else if (e instanceof RateLimitedError)
        this.setStatus({ phase: 'rateLimited', error: e.message, progress: null });
      else if (isNetworkError(e)) this.setStatus({ phase: 'offline', error: null, progress: null });
      else this.setStatus({ phase: 'error', error: redact(e), progress: null });
      throw e;
    }
  }

  // --- pull -------------------------------------------------------------------

  private async diff(
    head: CommitSha,
    known: Map<string, RemoteEntry>,
  ): Promise<{ snapshot: Map<string, TreeEntry>; changed: TreeEntry[] }> {
    const t = this.o.transport;
    const knownBlobs = [...known.values()].filter((e) => e.kind === 'blob').length;
    const mode = this.o.listing ?? 'auto';
    const tryRecursive =
      mode === 'recursive' ||
      (mode === 'auto' &&
        (known.size === 0 || (t.kind !== 'gitlab' && knownBlobs < RECURSIVE_LIMIT)));
    const snapshot = new Map<string, TreeEntry>();
    if (tryRecursive) {
      const all = await t.listTreeRecursive(head);
      if (all !== 'truncated') {
        for (const e of all) snapshot.set(e.path, e);
        const changed = all.filter((e) => e.type === 'blob' && known.get(e.path)?.sha !== e.sha);
        return { snapshot, changed };
      }
    }
    // Merkle walk: only descend into directories whose tree SHA changed.
    const changed: TreeEntry[] = [];
    const walk = async (dir: string, sha?: string): Promise<void> => {
      const entries = await t.listTree(head, dir, sha);
      const subdirs: TreeEntry[] = [];
      for (const e of entries) {
        snapshot.set(e.path, e);
        const k = known.get(e.path);
        if (e.type === 'tree') {
          if (k?.kind === 'tree' && k.sha === e.sha) {
            const prefix = `${e.path}/`;
            for (const [p, ke] of known) {
              if (p.startsWith(prefix)) snapshot.set(p, { path: p, sha: ke.sha, type: ke.kind });
            }
          } else subdirs.push(e);
        } else if (k?.sha !== e.sha) changed.push(e);
      }
      await mapLimit(subdirs, 6, (d) => walk(d.path, d.sha));
    };
    await walk('');
    return { snapshot, changed };
  }

  private async pull(head: CommitSha, report: SyncReport): Promise<void> {
    const { store, state, transport, keys } = this.o;
    const known = new Map((await state.remoteEntries()).map((e) => [e.path, e]));
    const { snapshot, changed } = await this.diff(head, known);
    const toFetch = new Map<string, string>();
    for (const e of changed) if (isRecordPath(e.path)) toFetch.set(e.path, e.sha);
    for (const p of this.forceRefetch) {
      const e = snapshot.get(p);
      if (e) toFetch.set(p, e.sha);
    }
    this.forceRefetch.clear();
    const list = [...toFetch].map(([path, sha]) => ({ path, sha }));
    const chunk = this.o.chunkSize ?? 200;
    const blobRefs: BlobRef[] = [];
    this.setStatus({ progress: { done: 0, total: list.length } });

    for (let i = 0; i < list.length; i += chunk) {
      const part = list.slice(i, i + chunk);
      const files = await transport.readFiles(head, part);
      const decoded: { path: string; sha: string; meta?: string; env: Envelope }[] = [];
      const problems: SqlStatement[] = [];
      const at = instantFromMs(this.o.env.now());
      for (const { path, sha } of part) {
        const f = files.get(path);
        if (!f) continue;
        try {
          const plain = decodeRecord(keys, path, new TextDecoder().decode(f.bytes));
          const parsed = parseEnvelope(JSON.parse(plain));
          if (!parsed.ok && parsed.reason === 'invalid') throw new RecordError('invalid-envelope');
          const env = parsed.ok ? parsed.envelope : (parsed.envelope as Envelope);
          if (!parsed.ok && parsed.reason === 'newerSchema') report.newerSchema = true;
          assertRecordName(keys, path, env.id);
          decoded.push(
            f.meta === undefined ? { path, sha, env } : { path, sha, meta: f.meta, env },
          );
          problems.push(state.problemClear(path));
        } catch (e) {
          // Never delete: record the problem and keep going (SYNC.md §10).
          report.problems++;
          const reason =
            e instanceof CryptoError || e instanceof RecordError
              ? e.code
              : e instanceof SyntaxError
                ? 'bad-json'
                : redact(e);
          problems.push(state.problemStatement({ path, reason, sha, at }));
          problems.push(state.remoteUpsert({ path, sha, kind: 'blob', meta: f.meta ?? null }));
        }
      }

      await store.syncTransaction(async () => {
        const dirty = new Map((await store.dirty()).map((d) => [d.id, d.hlc]));
        const items: { envelope: Envelope; dirty: boolean }[] = [];
        const clearDirty: { id: string }[] = [];
        const extra: SqlStatement[] = [...problems];
        for (const d of decoded) {
          const theirs = d.env;
          store.observe(theirs.hlc);
          if (!dirty.has(theirs.id)) {
            items.push({ envelope: theirs, dirty: false });
          } else {
            const ours = (await store.getEnvelope(theirs.id)) ?? theirs;
            const base = await state.getBase(theirs.id);
            const m = mergeDetailed(base, ours, theirs);
            if (m.restored) report.restored++;
            if (m.textConflict) report.conflicts++;
            if (deepEqual(m.envelope, theirs)) {
              items.push({ envelope: theirs, dirty: false });
              clearDirty.push({ id: theirs.id });
            } else {
              items.push({ envelope: m.envelope, dirty: true });
            }
          }
          blobRefsIn(theirs.data, blobRefs);
          extra.push(state.baseStatement(theirs));
          extra.push(
            state.remoteUpsert({ path: d.path, sha: d.sha, kind: 'blob', meta: d.meta ?? null }),
          );
        }
        return { items, extra, clearDirty };
      });
      report.pulled += decoded.length;
      this.setStatus({ progress: { done: Math.min(i + chunk, list.length), total: list.length } });
    }

    // Commit the rest of the snapshot: tree SHAs, non-record files, deletions.
    const extra: SqlStatement[] = [];
    for (const [p, e] of snapshot) {
      if (e.type === 'blob' && toFetch.has(p)) continue; // written above with meta
      const k = known.get(p);
      if (!k || k.sha !== e.sha || k.kind !== e.type) {
        extra.push(state.remoteUpsert({ path: p, sha: e.sha, kind: e.type }));
      }
    }
    for (const p of known.keys()) if (!snapshot.has(p)) extra.push(state.remoteDelete(p));
    extra.push(state.metaStatement(META_LAST, head));
    await store.syncTransaction(async () => ({ items: [], extra }));

    await this.fetchMissingBlobs(head, blobRefs, snapshot, report);
  }

  private async fetchMissingBlobs(
    head: CommitSha,
    refs: BlobRef[],
    snapshot: Map<string, TreeEntry>,
    report: SyncReport,
  ): Promise<void> {
    const blobs = this.o.blobs;
    if (!blobs || !refs.length) return;
    const wanted = new Map<string, BlobRef>();
    for (const r of refs) if (!(await blobs.has(r.hash))) wanted.set(r.hash, r);
    if (!wanted.size) return;
    const entries: { path: string; sha: string; ref: BlobRef }[] = [];
    for (const ref of wanted.values()) {
      const path = blobPath(this.o.keys, ref.hash);
      const e = snapshot.get(path);
      if (e) entries.push({ path, sha: e.sha, ref });
    }
    for (let i = 0; i < entries.length; i += 20) {
      const part = entries.slice(i, i + 20);
      const files = await this.o.transport.readFiles(head, part);
      for (const e of part) {
        const f = files.get(e.path);
        if (!f) continue;
        try {
          await blobs.putRaw(e.ref.hash, f.bytes, e.ref.mime);
        } catch (err) {
          report.problems++;
          await this.o.store.applySync(
            [],
            [
              this.o.state.problemStatement({
                path: e.path,
                reason: err instanceof CryptoError ? err.code : redact(err),
                sha: e.sha,
                at: instantFromMs(this.o.env.now()),
              }),
            ],
          );
        }
      }
    }
  }

  // --- push -------------------------------------------------------------------

  private async push(head: CommitSha, report: SyncReport): Promise<'ok' | 'nothing' | 'conflict'> {
    const { store, state, transport, keys } = this.o;
    const dirty = await store.dirty();
    const pending = this.o.blobs ? await this.o.blobs.pending() : [];
    if (!dirty.length && !pending.length) return 'nothing';
    const known = new Map((await state.remoteEntries()).map((e) => [e.path, e]));
    const changes: FileChange[] = [];
    const pushed: { id: string; hlc: string; env: Envelope; path: string; content: string }[] = [];
    const pushedBlobs: { hash: string; path: string; bytes: Uint8Array }[] = [];
    const alreadyThere: string[] = [];
    for (const d of dirty) {
      const env = await store.getEnvelope(d.id);
      if (!env) continue;
      const path = recordPath(keys, env.id);
      const content = encodeRecord(keys, env.id, JSON.stringify(env));
      const k = known.get(path);
      changes.push({ action: 'upsert', path, content, exists: !!k, meta: k?.meta ?? null });
      pushed.push({ id: d.id, hlc: d.hlc, env, path, content });
    }
    for (const b of pending) {
      const path = blobPath(keys, b.hash);
      if (known.has(path)) {
        alreadyThere.push(b.hash);
        continue;
      }
      changes.push({ action: 'upsert', path, content: b.bytes, exists: false });
      pushedBlobs.push({ hash: b.hash, path, bytes: b.bytes });
    }
    if (!changes.length) {
      await this.o.blobs?.markSynced(alreadyThere);
      return 'nothing';
    }
    const res = await transport.commit(head, changes);
    if (res === 'conflict') {
      // Re-read the files we tried to write so their content and transport meta are fresh.
      for (const p of pushed) if (known.has(p.path)) this.forceRefetch.add(p.path);
      return 'conflict';
    }
    const extra: SqlStatement[] = [];
    const touchedDirs = new Set<string>();
    for (const p of pushed) {
      extra.push(state.baseStatement(p.env));
      extra.push(
        state.remoteUpsert({
          path: p.path,
          sha: await gitBlobSha(p.content),
          kind: 'blob',
          meta: res.meta?.[p.path] ?? null,
        }),
      );
      for (const d of dirsOf(p.path)) touchedDirs.add(d);
    }
    for (const b of pushedBlobs) {
      extra.push(
        state.remoteUpsert({
          path: b.path,
          sha: await gitBlobSha(b.bytes),
          kind: 'blob',
          meta: res.meta?.[b.path] ?? null,
        }),
      );
      for (const d of dirsOf(b.path)) touchedDirs.add(d);
    }
    extra.push(...state.remoteForgetTrees([...touchedDirs]));
    // If other commits landed between our head and this commit (possible on GitLab),
    // keep the old head so the next cycle walks and picks them up.
    extra.push(state.metaStatement(META_LAST, res.parents[0] === head ? res.sha : head));
    await store.syncTransaction(async () => ({
      items: [],
      extra,
      clearDirty: pushed.map((p) => ({ id: p.id, hlc: p.hlc })),
    }));
    await this.o.blobs?.markSynced([...pushedBlobs.map((b) => b.hash), ...alreadyThere]);
    report.pushed += pushed.length;
    return 'ok';
  }

  /** Forget the remote snapshot so the next cycle re-reads everything (Settings → Sync → "Full resync"). */
  async fullResync(): Promise<void> {
    await this.o.state.reset(true);
    await this.o.state.markAllDirty();
  }

  /** Retry files listed under Settings → Sync → Problems. */
  async retryProblems(): Promise<void> {
    const probs = await this.o.state.problems();
    for (const p of probs) this.forceRefetch.add(p.path);
  }
}

class RecordError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

function isNetworkError(e: unknown): boolean {
  return e instanceof Error && (e.name === 'HttpError' || e.name === 'TypeError');
}

async function mapLimit<T>(items: T[], limit: number, fn: (t: T) => Promise<void>): Promise<void> {
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const item = items[i++] as T;
      await fn(item);
    }
  });
  await Promise.all(workers);
}
