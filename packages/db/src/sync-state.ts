// Sync bookkeeping tables (SYNC.md §4) behind a small API for packages/sync.

import type { Envelope } from '@lm/core';
import type { SqlStatement } from '@lm/platform';
import type { Store } from './store';

export interface RemoteEntry {
  path: string;
  sha: string;
  kind: 'blob' | 'tree';
  meta?: string | null;
}

export interface SyncProblem {
  path: string;
  reason: string;
  sha: string | null;
  at: string;
}

export class SyncState {
  constructor(private readonly store: Store) {}

  private get db() {
    return this.store.driver;
  }

  async getMeta<T>(key: string): Promise<T | null> {
    const r = await this.db.query<{ value: string }>('SELECT value FROM sync_meta WHERE key = ?', [
      key,
    ]);
    return r[0] ? (JSON.parse(r[0].value) as T) : null;
  }

  metaStatement(key: string, value: unknown): SqlStatement {
    return value === null
      ? { sql: 'DELETE FROM sync_meta WHERE key = ?', params: [key] }
      : {
          sql: 'INSERT INTO sync_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
          params: [key, JSON.stringify(value)],
        };
  }

  async setMeta(key: string, value: unknown): Promise<void> {
    const s = this.metaStatement(key, value);
    await this.store.runExclusive(() => this.db.exec(s.sql, s.params));
  }

  async getBase(id: string): Promise<Envelope | null> {
    const r = await this.db.query<{ envelope: string }>(
      'SELECT envelope FROM sync_base WHERE id = ?',
      [id],
    );
    return r[0] ? (JSON.parse(r[0].envelope) as Envelope) : null;
  }

  baseStatement(env: Envelope): SqlStatement {
    return {
      sql: 'INSERT INTO sync_base (id, envelope) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET envelope = excluded.envelope',
      params: [env.id, JSON.stringify(env)],
    };
  }

  async remoteEntries(): Promise<RemoteEntry[]> {
    return this.db.query<RemoteEntry & Record<string, string | null>>(
      'SELECT path, sha, kind, meta FROM sync_remote',
    );
  }

  remoteUpsert(e: RemoteEntry): SqlStatement {
    return {
      sql: 'INSERT INTO sync_remote (path, sha, kind, meta) VALUES (?, ?, ?, ?) ON CONFLICT(path) DO UPDATE SET sha = excluded.sha, kind = excluded.kind, meta = coalesce(excluded.meta, sync_remote.meta)',
      params: [e.path, e.sha, e.kind, e.meta ?? null],
    };
  }

  remoteDelete(path: string): SqlStatement {
    return { sql: 'DELETE FROM sync_remote WHERE path = ?', params: [path] };
  }

  /** Forget a directory's tree SHA so the next Merkle walk re-lists it. */
  remoteForgetTrees(paths: string[]): SqlStatement[] {
    return paths.map((p) => ({
      sql: "DELETE FROM sync_remote WHERE path = ? AND kind = 'tree'",
      params: [p],
    }));
  }

  remoteClear(): SqlStatement {
    return { sql: 'DELETE FROM sync_remote' };
  }

  async problems(): Promise<SyncProblem[]> {
    return this.db.query<SyncProblem & Record<string, string | null>>(
      'SELECT path, reason, sha, at FROM sync_problems ORDER BY at DESC',
    );
  }

  problemStatement(p: SyncProblem): SqlStatement {
    return {
      sql: 'INSERT INTO sync_problems (path, reason, sha, at) VALUES (?, ?, ?, ?) ON CONFLICT(path) DO UPDATE SET reason = excluded.reason, sha = excluded.sha, at = excluded.at',
      params: [p.path, p.reason, p.sha, p.at],
    };
  }

  problemClear(path: string): SqlStatement {
    return { sql: 'DELETE FROM sync_problems WHERE path = ?', params: [path] };
  }

  /** Forget everything sync knows (used by "full resync" and sign-out). */
  async reset(keepConfig = true): Promise<void> {
    await this.store.runExclusive(() =>
      this.db.batch([
        { sql: 'DELETE FROM sync_remote' },
        { sql: 'DELETE FROM sync_base' },
        { sql: 'DELETE FROM sync_problems' },
        keepConfig
          ? { sql: "DELETE FROM sync_meta WHERE key NOT IN ('config')" }
          : { sql: 'DELETE FROM sync_meta' },
      ]),
    );
  }

  /** Mark every live record dirty so it is re-pushed (full resync, SYNC.md §9). */
  async markAllDirty(): Promise<void> {
    await this.store.runExclusive(() =>
      this.db.exec(
        'INSERT INTO change_log (id, hlc) SELECT id, hlc FROM records WHERE true ON CONFLICT(id) DO UPDATE SET hlc = excluded.hlc',
      ),
    );
  }
}
