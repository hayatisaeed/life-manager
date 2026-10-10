// Record and blob codecs (SYNC.md §1, §3; SECURITY.md §2; ADR-012).
//
// - Record files: `LMR1.` + base64url(nonce ‖ ct), AD = "lmr1|" + name, where
//   name = hex(BLAKE2b-256(pathKey, recordId)). After decrypting, callers check
//   that the record's id hashes back to the name (`assertRecordName`), so a
//   file copied to another path is rejected either way.
// - Blob files: "LMB1" ‖ nonce ‖ ct, AD = "lmb1|" + contentHash; the plaintext
//   must hash back to contentHash.

import {
  CryptoError,
  NONCE_BYTES,
  blake2b,
  constantTimeEqual,
  deriveSubKey,
  fromB64Url,
  fromHex,
  fromUtf8,
  memzero,
  open,
  seal,
  toB64,
  toB64Url,
  fromB64,
  toHex,
  utf8,
} from './sodium';

export const RECORD_PREFIX = 'LMR1.';
const BLOB_MAGIC = utf8('LMB1');

/** SYNC.md §1: default 25 MB after encryption, hard maximum 50 MB. */
export const DEFAULT_BLOB_CAP = 25 * 1024 * 1024;
export const MAX_BLOB_CAP = 50 * 1024 * 1024;

export class Keys {
  readonly record: Uint8Array;
  readonly blob: Uint8Array;
  readonly path: Uint8Array;
  readonly local: Uint8Array;
  constructor(dataKey: Uint8Array) {
    this.record = deriveSubKey(dataKey, 'record');
    this.blob = deriveSubKey(dataKey, 'blob');
    this.path = deriveSubKey(dataKey, 'path');
    this.local = deriveSubKey(dataKey, 'local');
  }
  wipe(): void {
    for (const k of [this.record, this.blob, this.path, this.local]) memzero(k);
  }
}

const shard = (name: string) => `${name.slice(0, 2)}/${name.slice(2, 4)}`;

export function recordName(keys: Keys, id: string): string {
  return toHex(blake2b(utf8(id), keys.path));
}

export function recordPath(keys: Keys, id: string): string {
  const name = recordName(keys, id);
  return `r/${shard(name)}/${name}.lmr`;
}

const RECORD_PATH_RE = /^r\/([0-9a-f]{2})\/([0-9a-f]{2})\/([0-9a-f]{64})\.lmr$/;
const BLOB_PATH_RE = /^b\/([0-9a-f]{2})\/([0-9a-f]{2})\/([0-9a-f]{64})\.lmb$/;

/** The name part of a record path, or null if the path isn't a well-formed record path. */
export function nameFromRecordPath(path: string): string | null {
  const m = RECORD_PATH_RE.exec(path);
  if (!m || m[3]?.slice(0, 2) !== m[1] || m[3]?.slice(2, 4) !== m[2]) return null;
  return m[3] ?? null;
}

export function isBlobPath(path: string): boolean {
  return BLOB_PATH_RE.test(path);
}

export function encodeRecord(keys: Keys, id: string, plaintext: string): string {
  const name = recordName(keys, id);
  const { nonce, ct } = seal(keys.record, utf8(plaintext), `lmr1|${name}`);
  const all = new Uint8Array(nonce.length + ct.length);
  all.set(nonce);
  all.set(ct, nonce.length);
  return RECORD_PREFIX + toB64Url(all);
}

/** Decrypt a record file found at `path`. Throws CryptoError on any tampering. */
export function decodeRecord(keys: Keys, path: string, text: string): string {
  const name = nameFromRecordPath(path);
  if (!name) throw new CryptoError('bad-format');
  const t = text.trim();
  if (!t.startsWith(RECORD_PREFIX)) throw new CryptoError('bad-format');
  let all: Uint8Array;
  try {
    all = fromB64Url(t.slice(RECORD_PREFIX.length));
  } catch {
    throw new CryptoError('bad-format');
  }
  if (all.length < NONCE_BYTES + 16) throw new CryptoError('bad-format');
  const pt = open(
    keys.record,
    all.subarray(0, NONCE_BYTES),
    all.subarray(NONCE_BYTES),
    `lmr1|${name}`,
  );
  try {
    return fromUtf8(pt);
  } catch {
    throw new CryptoError('bad-format');
  }
}

/** Second half of relocation protection: the decrypted id must hash to the file's name. */
export function assertRecordName(keys: Keys, path: string, id: string): void {
  const name = nameFromRecordPath(path);
  if (!name || !constantTimeEqual(fromHex(name), fromHex(recordName(keys, id)))) {
    throw new CryptoError('relocated');
  }
}

// --- blobs ------------------------------------------------------------------------

export function contentHash(plaintext: Uint8Array): string {
  return toHex(blake2b(plaintext));
}

export function blobPath(keys: Keys, hash: string): string {
  const name = toHex(blake2b(utf8(hash), keys.path));
  return `b/${shard(name)}/${name}.lmb`;
}

export function encodeBlob(
  keys: Keys,
  plaintext: Uint8Array,
  cap = DEFAULT_BLOB_CAP,
): { hash: string; bytes: Uint8Array } {
  const hash = contentHash(plaintext);
  const { nonce, ct } = seal(keys.blob, plaintext, `lmb1|${hash}`);
  const out = new Uint8Array(BLOB_MAGIC.length + nonce.length + ct.length);
  out.set(BLOB_MAGIC);
  out.set(nonce, BLOB_MAGIC.length);
  out.set(ct, BLOB_MAGIC.length + nonce.length);
  if (out.length > Math.min(cap, MAX_BLOB_CAP)) throw new CryptoError('too-large');
  return { hash, bytes: out };
}

export function decodeBlob(keys: Keys, hash: string, bytes: Uint8Array): Uint8Array {
  if (bytes.length < BLOB_MAGIC.length + NONCE_BYTES + 16) throw new CryptoError('bad-format');
  for (let i = 0; i < BLOB_MAGIC.length; i++) {
    if (bytes[i] !== BLOB_MAGIC[i]) throw new CryptoError('bad-format');
  }
  const nonce = bytes.subarray(BLOB_MAGIC.length, BLOB_MAGIC.length + NONCE_BYTES);
  const pt = open(
    keys.blob,
    nonce,
    bytes.subarray(BLOB_MAGIC.length + NONCE_BYTES),
    `lmb1|${hash}`,
  );
  if (contentHash(pt) !== hash) throw new CryptoError('relocated');
  return pt;
}

// --- device-local secrets (web build, SECURITY.md §4) ---------------------------

export function sealLocal(keys: Keys, plaintext: string, ad: string): string {
  const { nonce, ct } = seal(keys.local, utf8(plaintext), `lml1|${ad}`);
  return `${toB64(nonce)}.${toB64(ct)}`;
}

export function openLocal(keys: Keys, sealed: string, ad: string): string {
  const [n, c] = sealed.split('.');
  if (!n || !c) throw new CryptoError('bad-format');
  return fromUtf8(open(keys.local, fromB64(n), fromB64(c), `lml1|${ad}`));
}
