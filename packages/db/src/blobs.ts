// Encrypted, content-addressed attachment store (ARCHITECTURE.md §4). The
// cipher is injected (packages/crypto via the app) so `db` doesn't depend on
// crypto. Bytes are stored in SQLite so every platform behaves the same.

import type { BlobRef } from '@lm/core';
import { instantFromMs } from '@lm/core';
import type { Store } from './store';

export interface BlobCipher {
  /** Encrypt plaintext; returns its content hash and the ciphertext. */
  seal(plaintext: Uint8Array): { hash: string; bytes: Uint8Array };
  open(hash: string, ciphertext: Uint8Array): Uint8Array;
}

/** 'pending' = not yet uploaded; 'synced'; 'localOnly' = too large to sync (SYNC.md §1). */
export type BlobState = 'pending' | 'synced' | 'localOnly';

export class BlobStore {
  constructor(
    private readonly store: Store,
    private cipher: BlobCipher,
    private readonly syncCap = 25 * 1024 * 1024,
  ) {}

  setCipher(c: BlobCipher): void {
    this.cipher = c;
  }

  async put(bytes: Uint8Array, mime: string, name?: string): Promise<BlobRef> {
    const { hash, bytes: ct } = this.cipher.seal(bytes);
    const state: BlobState = ct.length > this.syncCap ? 'localOnly' : 'pending';
    await this.store.runExclusive(() =>
      this.store.driver.exec(
        'INSERT INTO blobs (hash, bytes, mime, size, state, created_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(hash) DO NOTHING',
        [hash, ct, mime, bytes.length, state, instantFromMs(this.store.env.now())],
      ),
    );
    return name === undefined
      ? { hash, size: bytes.length, mime }
      : { hash, size: bytes.length, mime, name };
  }

  async get(hash: string): Promise<Uint8Array | null> {
    const r = await this.store.driver.query<{ bytes: Uint8Array }>(
      'SELECT bytes FROM blobs WHERE hash = ?',
      [hash],
    );
    return r[0] ? this.cipher.open(hash, r[0].bytes) : null;
  }

  async has(hash: string): Promise<boolean> {
    const r = await this.store.driver.query('SELECT 1 FROM blobs WHERE hash = ?', [hash]);
    return r.length > 0;
  }

  async state(hash: string): Promise<BlobState | null> {
    const r = await this.store.driver.query<{ state: BlobState }>(
      'SELECT state FROM blobs WHERE hash = ?',
      [hash],
    );
    return r[0]?.state ?? null;
  }

  async pending(): Promise<{ hash: string; bytes: Uint8Array }[]> {
    return this.store.driver.query("SELECT hash, bytes FROM blobs WHERE state = 'pending'");
  }

  /** Raw ciphertext (for upload). */
  async raw(hash: string): Promise<Uint8Array | null> {
    const r = await this.store.driver.query<{ bytes: Uint8Array }>(
      'SELECT bytes FROM blobs WHERE hash = ?',
      [hash],
    );
    return r[0]?.bytes ?? null;
  }

  /** Store ciphertext downloaded from the forge, verifying it decrypts. */
  async putRaw(hash: string, ciphertext: Uint8Array, mime: string): Promise<void> {
    const pt = this.cipher.open(hash, ciphertext);
    await this.store.runExclusive(() =>
      this.store.driver.exec(
        "INSERT INTO blobs (hash, bytes, mime, size, state, created_at) VALUES (?, ?, ?, ?, 'synced', ?) ON CONFLICT(hash) DO UPDATE SET state = 'synced'",
        [hash, ciphertext, mime, pt.length, instantFromMs(this.store.env.now())],
      ),
    );
  }

  async markSynced(hashes: string[]): Promise<void> {
    if (!hashes.length) return;
    await this.store.runExclusive(() =>
      this.store.driver.batch(
        hashes.map((h) => ({
          sql: "UPDATE blobs SET state = 'synced' WHERE hash = ?",
          params: [h],
        })),
      ),
    );
  }

  /** Re-encrypt every blob under a new cipher (joining a repo with a different data key). */
  async reencrypt(next: BlobCipher): Promise<void> {
    const rows = await this.store.driver.query<{ hash: string; bytes: Uint8Array }>(
      'SELECT hash, bytes FROM blobs',
    );
    const stmts = rows.map((r) => {
      const pt = this.cipher.open(r.hash, r.bytes);
      const { bytes } = next.seal(pt);
      return {
        sql: "UPDATE blobs SET bytes = ?, state = CASE state WHEN 'localOnly' THEN 'localOnly' ELSE 'pending' END WHERE hash = ?",
        params: [bytes, r.hash],
      };
    });
    if (stmts.length) await this.store.runExclusive(() => this.store.driver.batch(stmts));
    this.cipher = next;
  }
}
