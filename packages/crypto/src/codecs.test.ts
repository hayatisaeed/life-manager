import { describe, expect, it } from 'vitest';
import {
  blobPath,
  contentHash,
  decryptBlob,
  decryptRecord,
  deriveSubKeys,
  encryptBlob,
  encryptRecord,
  recordPath,
  type SubKeys,
} from './codecs';
import { fromUtf8, toHex, utf8 } from './encoding';
import { LmCryptoError } from './errors';
import type { DataKey } from './lm-json';
import { asKey, randomBytes, randomKey } from './primitives';
import { initCrypto } from './sodium';

await initCrypto();
const keys: SubKeys = deriveSubKeys(asKey(Uint8Array.from({ length: 32 }, (_, i) => i)) as DataKey);
const ID = '01J9ZZZZZZZZZZZZZZZZZZZZZZ';

describe('.lmr records', () => {
  it('decrypts a pinned record file (known answer)', () => {
    const file =
      'LMR1.QEFCQ0RFRkdISUpLTE1OT1BRUlNUVVZXudyyblqxK1_MEMmFfJKoXybpWE9k1ycsOvZxL9lUT_9Z028-wJ8ASY-gvUu05ewVp7AT';
    expect(fromUtf8(decryptRecord(keys, ID, file))).toBe(`{"id":"${ID}"}`);
  });

  it('round-trips as ASCII text', () => {
    const file = encryptRecord(keys, ID, utf8('{"title":"Call mom"}'));
    expect(file).toMatch(/^LMR1\.[A-Za-z0-9_-]+$/);
    expect(fromUtf8(decryptRecord(keys, ID, file))).toBe('{"title":"Call mom"}');
  });

  it('rejects a relocated, tampered, truncated or foreign file', () => {
    const file = encryptRecord(keys, ID, utf8('secret'));
    const authFailed = expect.objectContaining({ code: 'auth-failed' });
    expect(() => decryptRecord(keys, '01J9ZZZZZZZZZZZZZZZZZZZZZY', file)).toThrow(authFailed);
    const i = 20;
    const flipped = file.slice(0, i) + (file[i] === 'A' ? 'B' : 'A') + file.slice(i + 1);
    expect(() => decryptRecord(keys, ID, flipped)).toThrow(authFailed);
    // Truncation breaks either the base64 or the tag; both are rejections.
    expect(() => decryptRecord(keys, ID, file.slice(0, -4))).toThrow(LmCryptoError);
    expect(() => decryptRecord(keys, ID, file.slice(0, -3))).toThrow(LmCryptoError);
    expect(() => decryptRecord(keys, ID, 'LMR1.AAAA')).toThrow(
      expect.objectContaining({ code: 'malformed' }),
    );
    expect(() => decryptRecord(keys, ID, file.replace('LMR1.', 'LMR2.'))).toThrow(/not an LMR1/);
    const otherRepo = deriveSubKeys(randomKey() as DataKey);
    expect(() => decryptRecord(otherRepo, ID, file)).toThrow(authFailed);
  });
});

describe('.lmb blobs', () => {
  it('round-trips binary content bound to its content hash', () => {
    const data = randomBytes(100_000);
    const hash = contentHash(data);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    const file = encryptBlob(keys, hash, data);
    expect(fromUtf8(file.subarray(0, 4))).toBe('LMB1');
    expect(decryptBlob(keys, hash, file)).toEqual(data);
  });

  it('rejects a relocated, tampered, truncated or non-LMB1 file', () => {
    const data = utf8('passport scan');
    const hash = contentHash(data);
    const file = encryptBlob(keys, hash, data);
    const authFailed = expect.objectContaining({ code: 'auth-failed' });
    expect(() => decryptBlob(keys, contentHash(utf8('other')), file)).toThrow(authFailed);
    const bad = file.slice();
    bad[30] = (bad[30] ?? 0) ^ 0x80;
    expect(() => decryptBlob(keys, hash, bad)).toThrow(authFailed);
    expect(() => decryptBlob(keys, hash, file.subarray(0, file.length - 1))).toThrow(authFailed);
    expect(() => decryptBlob(keys, hash, utf8('LMB'))).toThrow(/not an LMB1/);
    expect(() => decryptBlob(keys, hash, utf8('LMBX'.padEnd(60, 'x')))).toThrow(/not an LMB1/);
  });
});

describe('paths', () => {
  it('pins the sharded record and blob paths (known answer)', () => {
    expect(recordPath(keys, ID)).toBe(
      'r/2f/20/2f2056753f5dad5608ac65a7bc05edd0e9f3ce846b70b3a81e4b17ed22d61652.lmr',
    );
    expect(blobPath(keys, 'ab'.repeat(32))).toBe(
      'b/82/39/82393903b97bef7542e578e6f4086d10216292ca577e0c1c17d979c8d6ee48a9.lmb',
    );
  });

  it('reveals nothing without the path key', () => {
    const other = deriveSubKeys(randomKey() as DataKey);
    expect(recordPath(other, ID)).not.toBe(recordPath(keys, ID));
    expect(recordPath(keys, ID)).not.toContain(ID.toLowerCase());
  });

  it('derives four distinct sub-keys', () => {
    expect(new Set(Object.values(keys).map((k) => toHex(k))).size).toBe(4);
  });
});
