import { describe, expect, it } from 'vitest';
import {
  blobPath,
  contentHash,
  decryptBlob,
  decryptRecord,
  deriveSubKeys,
  encryptBlob,
  encryptRecord,
  recordFileName,
  recordNameFromPath,
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
  const PATH = recordPath(keys, ID);

  it('decrypts a pinned record file (known answer, ADR-019 format)', () => {
    const file =
      'LMR1.QEFCQ0RFRkdISUpLTE1OT1BRUlNUVVZXudyyblqxK1_MEMmFfJKoXybpWE9k1ycsOvZxL9lUT_9Z02_OHyGy-1d95NhKflM2W7AN';
    expect(fromUtf8(decryptRecord(keys, PATH, file))).toBe(`{"id":"${ID}"}`);
  });

  it('round-trips as ASCII text, decrypted by path alone', () => {
    const file = encryptRecord(keys, ID, utf8('{"title":"Call mom"}'));
    expect(file).toMatch(/^LMR1\.[A-Za-z0-9_-]+$/);
    expect(fromUtf8(decryptRecord(keys, PATH, file))).toBe('{"title":"Call mom"}');
    expect(recordNameFromPath(PATH)).toBe(recordFileName(keys, ID));
  });

  it('rejects a relocated, tampered, truncated or foreign file', () => {
    const file = encryptRecord(keys, ID, utf8('secret'));
    const authFailed = expect.objectContaining({ code: 'auth-failed' });
    expect(() => decryptRecord(keys, recordPath(keys, '01J9ZZZZZZZZZZZZZZZZZZZZZY'), file)).toThrow(
      authFailed,
    );
    const i = 20;
    const flipped = file.slice(0, i) + (file[i] === 'A' ? 'B' : 'A') + file.slice(i + 1);
    expect(() => decryptRecord(keys, PATH, flipped)).toThrow(authFailed);
    // Truncation breaks either the base64 or the tag; both are rejections.
    expect(() => decryptRecord(keys, PATH, file.slice(0, -4))).toThrow(LmCryptoError);
    expect(() => decryptRecord(keys, PATH, file.slice(0, -3))).toThrow(LmCryptoError);
    expect(() => decryptRecord(keys, PATH, 'LMR1.AAAA')).toThrow(
      expect.objectContaining({ code: 'malformed' }),
    );
    expect(() => decryptRecord(keys, PATH, file.replace('LMR1.', 'LMR2.'))).toThrow(/not an LMR1/);
    const otherRepo = deriveSubKeys(randomKey() as DataKey);
    expect(() => decryptRecord(otherRepo, PATH, file)).toThrow(authFailed);
  });

  it('rejects paths that are not record paths', () => {
    const name = recordFileName(keys, ID);
    for (const bad of [
      `r/00/00/${name}.lmr`, // shards don't match the name
      `b/${name.slice(0, 2)}/${name.slice(2, 4)}/${name}.lmr`,
      `r/${name.slice(0, 2)}/${name.slice(2, 4)}/${name}.lmb`,
      `r/${name.slice(0, 2)}/${name.slice(2, 4)}/${name.toUpperCase()}.lmr`,
      'lm.json',
    ]) {
      expect(() => recordNameFromPath(bad)).toThrow(/not a record path/);
    }
  });
});

describe('.lmb blobs', () => {
  it('round-trips binary content bound to its content hash', () => {
    const data = randomBytes(100_000);
    const hash = contentHash(data);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    const file = encryptBlob(keys, hash, data);
    expect(fromUtf8(file.subarray(0, 4))).toBe('LMB1');
    // Compared as hex: Vitest's deep equality on a 100 KB array takes seconds.
    expect(toHex(decryptBlob(keys, hash, file))).toBe(toHex(data));
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
