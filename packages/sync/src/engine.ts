import { canonical, parseRecord, renderTextGraph } from '@lm/core';
import { createCrypto } from '@lm/crypto';
import { z } from 'zod';
import type { VaultControl, ControlledVaultHeader } from '@lm/crypto';
import type { Envelope } from '@lm/core';
import type { SyncStore, SyncProblem } from '@lm/db';
import { SyncError, commitShaSchema } from './transport';
import type { SyncTransport } from './transport';
import { remoteTree } from './tree';

export interface SyncResult {
  state: 'synced' | 'problems';
  problems: number;
  attempts: number;
}
export interface SyncLock {
  run<T>(work: () => Promise<T>): Promise<T>;
}
/** Local serialization; web hosts must additionally inject a Web Locks-backed lock. */
export function createSyncLock(): SyncLock {
  let queue: Promise<unknown> = Promise.resolve();
  return {
    run: <T>(work: () => Promise<T>) => {
      const result = queue.then(work);
      queue = result.then(
        () => undefined,
        () => undefined,
      );
      return result;
    },
  };
}
export async function createSyncEngine(options: {
  transport: SyncTransport;
  store: SyncStore;
  dataKey: Uint8Array;
  expected: { vaultId: string; generation: number };
  lock: SyncLock;
  now: () => number;
  random: () => number;
  wait: (millis: number) => Promise<void>;
}) {
  const crypto = await createCrypto();
  const keys = crypto.deriveKeys(options.dataKey);
  const fingerprint = crypto.keyFingerprint(options.dataKey);
  let disposed = false;
  const assertUnlocked = () => {
    if (disposed) throw new SyncError('authentication');
  };
  const transient = (error: unknown) =>
    error instanceof SyncError && ['network', 'rate-limit', 'conflict'].includes(error.code);
  const isRecord = (path: string) => /^r\/[0-9a-f]{2}\/[0-9a-f]{2}\/[0-9a-f]{64}\.lmr$/.test(path);
  async function cycle(): Promise<SyncResult> {
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        assertUnlocked();
        const rate = options.transport.rateLimit();
        if (
          rate.remaining !== null &&
          rate.remaining <= 0 &&
          (rate.resetAt ?? Infinity) > options.now()
        )
          throw new SyncError('rate-limit', rate.resetAt ?? undefined);
        const head = commitShaSchema.parse(await options.transport.getHead());
        assertUnlocked();
        const headerBytes = await options.transport.readFile('lm.json', head);
        assertUnlocked();
        if (!headerBytes) throw new SyncError('invalid-remote');
        let header: ControlledVaultHeader, control: VaultControl;
        try {
          const input: unknown = JSON.parse(crypto.decodeUtf8(headerBytes));
          const version = z
            .object({ format: z.literal('life-manager'), version: z.number().int().positive() })
            .parse(input);
          if (version.version !== 2) throw new SyncError('update-required');
          const parsed = crypto.parseHeader(input);
          if (parsed.version !== 2) throw new SyncError('update-required');
          header = parsed;
          control = crypto.decodeControl(header, keys.record);
        } catch (error) {
          if (error instanceof SyncError) throw error;
          throw new SyncError('authentication');
        }
        if (
          control.vaultId !== options.expected.vaultId ||
          control.generation !== options.expected.generation
        )
          throw new SyncError('recovery-required');
        if (control.state !== 'active') throw new SyncError('maintenance');
        if (control.transition && control.transition.keyFingerprint !== fingerprint)
          throw new SyncError('authentication');
        let snapshot = await options.store.snapshot();
        assertUnlocked();
        let remote = snapshot.remote;
        if (snapshot.head !== head) {
          remote = await remoteTree(options.transport, head, snapshot.remote);
          assertUnlocked();
          const changed = [...remote]
            .filter(([path, sha]) => isRecord(path) && snapshot.remote.get(path) !== sha)
            .map(([path, sha]) => ({ path, sha }));
          const problems: SyncProblem[] = [];
          // Absence is never an instruction to purge or re-create a record (maintenance §8).
          for (const [path] of snapshot.remote)
            if (isRecord(path) && !remote.has(path))
              problems.push({ path, reason: 'missing-remote', ciphertext: new Uint8Array() });
          const incoming: { path: string; record: Envelope; ciphertext: Uint8Array }[] = [];
          for (let offset = 0; offset < changed.length; offset += 100) {
            const batch = changed.slice(offset, offset + 100);
            const blobs = await options.transport.readBlobs(batch);
            assertUnlocked();
            for (const entry of batch) {
              const ciphertext = blobs.get(entry.path);
              if (!ciphertext) throw new SyncError('invalid-remote');
              let plain: Uint8Array;
              try {
                plain = crypto.decodeRecord(crypto.decodeUtf8(ciphertext), entry.path, keys.record);
              } catch {
                problems.push({ path: entry.path, reason: 'authentication', ciphertext });
                continue;
              }
              try {
                const parsed = parseRecord(JSON.parse(crypto.decodeUtf8(plain)));
                if (crypto.recordPath(parsed.record.id, keys.path) !== entry.path)
                  throw new Error('Relocated identifier');
                if (parsed.kind === 'known')
                  for (const [field, graph] of Object.entries(parsed.record.textVersions ?? {}))
                    if (renderTextGraph(graph).value !== parsed.record.data[field])
                      throw new Error('Invalid text rendering');
                incoming.push({ path: entry.path, record: parsed.record, ciphertext });
              } catch {
                problems.push({ path: entry.path, reason: 'invalid-record', ciphertext });
              } finally {
                crypto.dispose(plain);
              }
            }
          }
          await options.store.pull(head, remote, incoming, problems);
          snapshot = await options.store.snapshot();
          assertUnlocked();
        }
        const blocked = new Set(snapshot.problems.map((problem) => problem.path));
        const pushed = snapshot.dirty.filter(
          (record) =>
            parseRecord(record).kind === 'known' &&
            !blocked.has(crypto.recordPath(record.id, keys.path)),
        );
        if (pushed.length === 0)
          return {
            state: snapshot.problems.length ? 'problems' : 'synced',
            problems: snapshot.problems.length,
            attempts: attempt + 1,
          };
        const changes = pushed.map((record) => {
          const path = crypto.recordPath(record.id, keys.path);
          const plain = crypto.encodeUtf8(canonical(record));
          try {
            return {
              path,
              content: crypto.encodeUtf8(crypto.encodeRecord(plain, path, keys.record)),
            };
          } finally {
            crypto.dispose(plain);
          }
        });
        const { control: _oldControl, ...binding } = header;
        const nextHeader = {
          ...binding,
          control: crypto.encodeControl(
            binding,
            { ...control, writeNonce: crypto.randomControlId() },
            keys.record,
          ),
        };
        changes.push({ path: 'lm.json', content: crypto.encodeUtf8(JSON.stringify(nextHeader)) });
        const result = await options.transport.commit(head, changes);
        assertUnlocked();
        if (result === 'conflict') throw new SyncError('conflict');
        commitShaSchema.parse(result);
        // Pinned read-back obtains actual forge SHAs, avoiding another SHA-1 implementation.
        const nextRemote = await remoteTree(options.transport, result, remote);
        await options.store.acknowledge(result, nextRemote, pushed);
        return {
          state: snapshot.problems.length ? 'problems' : 'synced',
          problems: snapshot.problems.length,
          attempts: attempt + 1,
        };
      } catch (error) {
        if (!transient(error) || attempt === 4) throw error;
        // Long provider reset windows surface to the caller instead of holding a lock for minutes.
        const reset = error instanceof SyncError ? error.retryAt : undefined;
        if (reset !== undefined && reset - options.now() > 30000) throw error;
        const jitter = options.random();
        if (!Number.isFinite(jitter) || jitter < 0 || jitter >= 1)
          throw new Error('Invalid jitter source');
        await options.wait(
          Math.max(
            reset === undefined ? 0 : reset - options.now(),
            Math.min(16000, 500 * 2 ** attempt) * (0.5 + jitter),
          ),
        );
      }
    }
    throw new SyncError('conflict');
  }
  return {
    sync: () => options.lock.run(cycle),
    dispose: () => {
      disposed = true;
      for (const key of Object.values(keys)) crypto.dispose(key);
    },
  };
}
