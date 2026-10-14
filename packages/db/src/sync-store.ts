import {
  canonical,
  parseRecord,
  mergeRecords,
  tickHlc,
  parseHlc,
  formatHlc,
  compareHlc,
} from '@lm/core';
import type { Envelope, ClockState } from '@lm/core';
import type { SqlDriver, SqlValue } from './driver';

export interface SyncProblem {
  path: string;
  reason: 'authentication' | 'invalid-record' | 'incompatible-record' | 'missing-remote';
  ciphertext: Uint8Array;
}
export interface SyncSnapshot {
  head: string | null;
  remote: Map<string, string>;
  dirty: Envelope[];
  problems: SyncProblem[];
}
/** SYNC.md §§4–5: the DB owns merge/ack transactions so local writes cannot race a snapshot. */
export interface SyncStore {
  snapshot(): Promise<SyncSnapshot>;
  pull(
    head: string,
    remote: Map<string, string>,
    records: { path: string; record: Envelope; ciphertext: Uint8Array }[],
    problems: SyncProblem[],
  ): Promise<void>;
  acknowledge(head: string, remote: Map<string, string>, pushed: Envelope[]): Promise<void>;
}
const decode = (value: SqlValue | undefined): Envelope => {
  if (typeof value !== 'string') throw new Error('Invalid stored envelope');
  return parseRecord(JSON.parse(value)).record;
};
export function createSyncStore(
  driver: SqlDriver,
  options: { deviceId: string; now: () => number },
  notify: () => void,
): SyncStore {
  const checkpoint = async (
    db: Pick<SqlDriver, 'query'>,
    head: string,
    remote: Map<string, string>,
  ) => {
    await db.query('DELETE FROM sync_remote');
    for (const [path, sha] of remote)
      await db.query('INSERT INTO sync_remote(path,sha) VALUES(?,?)', [path, sha]);
    await db.query(
      "INSERT INTO sync_meta(key,value) VALUES('lastSyncedCommit',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
      [head],
    );
  };
  const preserve = async (db: Pick<SqlDriver, 'query'>, problem: SyncProblem) => {
    await db.query(
      'INSERT INTO sync_problems(path,reason,ciphertext) VALUES(?,?,?) ON CONFLICT(path,ciphertext) DO UPDATE SET reason=excluded.reason, resolved=0',
      [problem.path, problem.reason, problem.ciphertext],
    );
  };
  return {
    snapshot: () =>
      driver.transaction(async (db) => {
        const meta = await db.query("SELECT value FROM sync_meta WHERE key='lastSyncedCommit'");
        const remote = await db.query('SELECT path,sha FROM sync_remote');
        const dirty = await db.query(
          'SELECT r.envelope FROM records r JOIN change_log c ON r.id=c.id',
        );
        const problems = await db.query(
          'SELECT path,reason,ciphertext FROM sync_problems WHERE resolved=0',
        );
        return {
          head: typeof meta[0]?.value === 'string' ? meta[0].value : null,
          remote: new Map(remote.map((row) => [String(row.path), String(row.sha)])),
          dirty: dirty.map((row) => decode(row.envelope)),
          problems: problems.map((row) => {
            if (!(row.ciphertext instanceof Uint8Array))
              throw new Error('Invalid stored ciphertext');
            if (
              ![
                'authentication',
                'invalid-record',
                'incompatible-record',
                'missing-remote',
              ].includes(String(row.reason))
            )
              throw new Error('Invalid sync problem');
            return {
              path: String(row.path),
              reason: row.reason as SyncProblem['reason'],
              ciphertext: row.ciphertext,
            };
          }),
        };
      }),
    pull: async (head, remote, incoming, problems) => {
      await driver.transaction(async (db) => {
        const saved = await db.query("SELECT value FROM sync_meta WHERE key='hlc'");
        let clock: ClockState =
          typeof saved[0]?.value === 'string'
            ? { ...parseHlc(saved[0].value), deviceId: options.deviceId }
            : { millis: 0, counter: 0, deviceId: options.deviceId };
        for (const item of incoming) {
          const old = await db.query('SELECT envelope FROM records WHERE id=?', [item.record.id]);
          const ours = old.length ? decode(old[0]?.envelope) : undefined;
          const dirty = await db.query('SELECT hlc FROM change_log WHERE id=?', [item.record.id]);
          const rows = await db.query('SELECT envelope FROM sync_base WHERE id=?', [
            item.record.id,
          ]);
          const base = rows.length ? decode(rows[0]?.envelope) : undefined;
          let merged: Envelope;
          try {
            const theirs = parseRecord(item.record);
            merged = theirs.record;
            if (ours && !dirty.length) {
              if (compareHlc(theirs.record.hlc, ours.hlc) < 0)
                throw new Error('Remote clock regression');
              // ADR-013/016 forbid causal pruning: a clean pull cannot erase original versions either.
              for (const [field, versions] of Object.entries(ours.textVersions ?? {})) {
                const received = new Map(
                  theirs.record.textVersions?.[field]?.map((node) => [node.clock, node]),
                );
                for (const version of versions) {
                  const node = received.get(version.clock);
                  if (
                    !node ||
                    node.value !== version.value ||
                    canonical([...node.parents].sort()) !== canonical([...version.parents].sort())
                  )
                    throw new Error('Remote text ancestry regression');
                }
              }
            }
            if (ours && dirty.length && canonical(ours) !== canonical(item.record)) {
              if (parseRecord(ours).kind !== 'known' || theirs.kind !== 'known')
                throw new Error('Preserved record cannot merge');
              merged = parseRecord(mergeRecords(base, ours, theirs.record)).record;
            } else if (
              ours &&
              (ours.type !== theirs.record.type ||
                (parseRecord(ours).kind !== 'known' && canonical(ours) !== canonical(item.record)))
            )
              throw new Error('Cannot overwrite preserved record');
          } catch {
            await preserve(db, {
              path: item.path,
              reason: 'incompatible-record',
              ciphertext: item.ciphertext,
            });
            continue;
          }
          await db.query(
            'INSERT INTO records(id,type,envelope,deleted_at) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET envelope=excluded.envelope, deleted_at=excluded.deleted_at',
            [merged.id, merged.type, JSON.stringify(merged), merged.deletedAt],
          );
          await db.query('DELETE FROM search_index WHERE id=?', [merged.id]);
          if (!merged.deletedAt)
            await db.query('INSERT INTO search_index(id,content) VALUES(?,?)', [
              merged.id,
              Object.values(merged.data)
                .filter((value) => typeof value === 'string')
                .join(' '),
            ]);
          await db.query(
            'INSERT INTO sync_base(id,envelope) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET envelope=excluded.envelope',
            [merged.id, JSON.stringify(item.record)],
          );
          if (canonical(merged) === canonical(item.record))
            await db.query('DELETE FROM change_log WHERE id=?', [merged.id]);
          else
            await db.query(
              'INSERT INTO change_log(id,hlc) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET hlc=excluded.hlc',
              [merged.id, merged.hlc],
            );
          for (const hlc of [item.record.hlc, ...Object.values(item.record.fieldHlc)])
            clock = tickHlc(clock, options.now(), parseHlc(hlc));
          await db.query('UPDATE sync_problems SET resolved=1 WHERE path=?', [item.path]);
          await db.query(
            'INSERT INTO record_origins(id,ever_synced) VALUES(?,1) ON CONFLICT(id) DO UPDATE SET ever_synced=1',
            [merged.id],
          );
        }
        for (const problem of problems) await preserve(db, problem);
        await db.query(
          "INSERT INTO sync_meta(key,value) VALUES('hlc',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
          [formatHlc(clock)],
        );
        await checkpoint(db, head, remote);
      });
      notify();
    },
    acknowledge: async (head, remote, pushed) => {
      await driver.transaction(async (db) => {
        for (const record of pushed) {
          await db.query(
            'INSERT INTO sync_base(id,envelope) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET envelope=excluded.envelope',
            [record.id, JSON.stringify(record)],
          );
          await db.query('DELETE FROM change_log WHERE id=? AND hlc=?', [record.id, record.hlc]);
          await db.query(
            'INSERT INTO record_origins(id,ever_synced) VALUES(?,1) ON CONFLICT(id) DO UPDATE SET ever_synced=1',
            [record.id],
          );
        }
        await checkpoint(db, head, remote);
      });
    },
  };
}
