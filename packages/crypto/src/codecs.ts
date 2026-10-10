// File codecs and paths for the repo (SYNC.md §1, SECURITY.md §2). The AEAD
// associated data binds each file to its record id or content hash, so a file
// moved to another path fails to decrypt.
import { concat, fromB64url, toB64url, toHex, utf8 } from './encoding';
import { LmCryptoError } from './errors';
import { deriveSubKey, hash256, open, seal, type Key } from './primitives';
import type { DataKey } from './lm-json';

export interface SubKeys {
  /** `"lm-rec1"`: encrypts `.lmr` record files. */
  readonly record: Key;
  /** `"lm-blob"`: encrypts `.lmb` attachment blobs. */
  readonly blob: Key;
  /** `"lm-path"`: keys the hash that names files. */
  readonly path: Key;
  /** `"lm-locl"`: device-local secrets on the web (SECURITY.md §4). */
  readonly local: Key;
}

export function deriveSubKeys(dataKey: DataKey): SubKeys {
  return {
    record: deriveSubKey(dataKey, 'record'),
    blob: deriveSubKey(dataKey, 'blob'),
    path: deriveSubKey(dataKey, 'path'),
    local: deriveSubKey(dataKey, 'local'),
  };
}

const LMR_PREFIX = 'LMR1.';
// "LMB1" in ASCII. A literal, because libsodium isn't loaded at import time.
const LMB_MAGIC = Uint8Array.of(0x4c, 0x4d, 0x42, 0x31);

// Records are bound to their file name, the keyed hash of their id (ADR-019):
// a device that has never seen a record can read its name, but not its id.
const recordAd = (fileName: string) => `lmr1|${fileName}`;
const blobAd = (contentHash: string) => `lmb1|${contentHash}`;

/** `.lmr` text: `LMR1.` + base64url(nonce ‖ ciphertext), bound to the record's file name. */
export function encryptRecord(keys: SubKeys, recordId: string, plaintext: Uint8Array): string {
  return (
    LMR_PREFIX + toB64url(seal(keys.record, plaintext, recordAd(recordFileName(keys, recordId))))
  );
}

/**
 * Decrypts the `.lmr` file found at `path`. Throws `malformed` for a path or
 * file that isn't a record, and `auth-failed` for a wrong key, a file moved
 * from another path, or any tampering or truncation.
 *
 * The caller must then check that the decrypted record's id belongs at this
 * path (`recordPath(keys, id) === path`); only that closes the loop between
 * the name and the content. Files that fail either check are kept and
 * reported (SYNC.md §10), never deleted.
 */
export function decryptRecord(keys: SubKeys, path: string, text: string): Uint8Array {
  const name = recordNameFromPath(path);
  if (!text.startsWith(LMR_PREFIX)) throw new LmCryptoError('malformed', 'not an LMR1 record');
  return open(keys.record, fromB64url(text.slice(LMR_PREFIX.length)), recordAd(name));
}

const RECORD_PATH = /^r\/([0-9a-f]{2})\/([0-9a-f]{2})\/([0-9a-f]{64})\.lmr$/;

/** The file name (keyed hash) in a record path, after checking the shard directories match it. */
export function recordNameFromPath(path: string): string {
  const m = RECORD_PATH.exec(path);
  const name = m?.[3];
  if (!m || !name || m[1] !== name.slice(0, 2) || m[2] !== name.slice(2, 4)) {
    throw new LmCryptoError('malformed', 'not a record path');
  }
  return name;
}

/** Hex BLAKE2b-256 of an attachment's plaintext. Names and binds its blob. */
export function contentHash(plaintext: Uint8Array): string {
  return toHex(hash256(plaintext));
}

/** `.lmb` bytes: `LMB1` ‖ nonce ‖ ciphertext. */
export function encryptBlob(keys: SubKeys, hash: string, plaintext: Uint8Array): Uint8Array {
  return concat(LMB_MAGIC, seal(keys.blob, plaintext, blobAd(hash)));
}

export function decryptBlob(keys: SubKeys, hash: string, file: Uint8Array): Uint8Array {
  if (file.length < LMB_MAGIC.length || !LMB_MAGIC.every((b, i) => file[i] === b)) {
    throw new LmCryptoError('malformed', 'not an LMB1 blob');
  }
  return open(keys.blob, file.subarray(LMB_MAGIC.length), blobAd(hash));
}

function shardedPath(dir: 'r' | 'b', name: string, ext: string): string {
  return `${dir}/${name.slice(0, 2)}/${name.slice(2, 4)}/${name}.${ext}`;
}

/** hex BLAKE2b-256(pathKey, recordId): a record's file name without directories or extension. */
export function recordFileName(keys: SubKeys, recordId: string): string {
  return toHex(hash256(utf8(recordId), keys.path));
}

/** `r/<s1>/<s2>/<hex BLAKE2b-256(pathKey, recordId)>.lmr` */
export function recordPath(keys: SubKeys, recordId: string): string {
  return shardedPath('r', recordFileName(keys, recordId), 'lmr');
}

/** `b/<s1>/<s2>/<hex BLAKE2b-256(pathKey, contentHash)>.lmb`; the hash is hashed as its hex text. */
export function blobPath(keys: SubKeys, hash: string): string {
  return shardedPath('b', toHex(hash256(utf8(hash), keys.path)), 'lmb');
}
