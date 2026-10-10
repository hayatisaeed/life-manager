import { blobPath, contentHash, decryptBlob, encryptBlob, type SubKeys } from '@lm/crypto';
import type { FileStore } from '@lm/platform';

/** DATA-MODEL.md §1. */
export interface BlobRef {
  hash: string;
  size: number;
  mime: string;
  name?: string;
}

export class AttachmentCorruptError extends Error {
  override name = 'AttachmentCorruptError';
}

const HASH = /^[0-9a-f]{64}$/;

/**
 * Encrypted, content-addressed attachments on the device (ARCHITECTURE.md §4,
 * ADR-018).
 *
 * Each file holds exactly the `.lmb` bytes the repo stores (SECURITY.md §2)
 * and is named like the repo path's last segment, so:
 * - the local file name doesn't reveal the content hash;
 * - sync (P0.6) can upload or accept files without re-encrypting.
 */
export class AttachmentStore {
  constructor(
    private readonly files: FileStore,
    private readonly keys: SubKeys,
  ) {}

  /** The local file name for a content hash: the basename of its repo path. */
  fileName(hash: string): string {
    checkHash(hash);
    return blobPath(this.keys, hash).split('/').pop() as string;
  }

  /** Stores bytes and returns their reference. Storing the same content twice is a no-op. */
  async put(bytes: Uint8Array, mime: string, name?: string): Promise<BlobRef> {
    const hash = contentHash(bytes);
    const file = this.fileName(hash);
    if ((await this.files.read(file)) === null) {
      await this.files.write(file, encryptBlob(this.keys, hash, bytes));
    }
    return { hash, size: bytes.length, mime, ...(name === undefined ? {} : { name }) };
  }

  /**
   * The plaintext, or null if this device doesn't have the file (yet). A file
   * that fails to decrypt or doesn't match its hash throws; it is left on disk.
   */
  async get(hash: string): Promise<Uint8Array | null> {
    const file = await this.files.read(this.fileName(hash));
    if (file === null) return null;
    let plain: Uint8Array;
    try {
      plain = decryptBlob(this.keys, hash, file);
    } catch {
      throw new AttachmentCorruptError(`attachment ${hash.slice(0, 8)}… failed to decrypt`);
    }
    // The AEAD already binds the hash; this catches a bug that encrypted the
    // wrong bytes under a hash.
    if (contentHash(plain) !== hash) {
      throw new AttachmentCorruptError(`attachment ${hash.slice(0, 8)}… does not match its hash`);
    }
    return plain;
  }

  async has(hash: string): Promise<boolean> {
    return (await this.files.read(this.fileName(hash))) !== null;
  }

  /** Deletes the local copy. Only for unreferenced blobs; the caller decides. */
  delete(hash: string): Promise<void> {
    return this.files.delete(this.fileName(hash));
  }
}

function checkHash(hash: string): void {
  if (!HASH.test(hash)) throw new Error('content hash must be 64 lowercase hex characters');
}
