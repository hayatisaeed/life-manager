import { beforeAll, describe, expect, it } from 'vitest';
import {
  CryptoError,
  Keys,
  assertRecordName,
  blake2b,
  blobPath,
  contentHash,
  createVault,
  decodeBlob,
  decodeRecord,
  decodeRecoveryKey,
  deriveKek,
  encodeBlob,
  encodeRecord,
  encodeRecoveryKey,
  fromHex,
  isBlobPath,
  nameFromRecordPath,
  open,
  openLocal,
  parseLmJson,
  recordName,
  recordPath,
  rewrapPassphrase,
  rotateRecoveryKey,
  sealLocal,
  sealWithNonce,
  serializeLmJson,
  sodiumReady,
  toHex,
  unlockWithPassphrase,
  unlockWithRecoveryKey,
  utf8,
  RECORD_PREFIX,
} from '../src';

// Fast KDF cost for tests only (the floor in deriveKek is 2 ops / 16 MiB).
const FAST = { opslimit: 2, memlimit: 16 * 1024 * 1024 };

beforeAll(async () => {
  await sodiumReady();
});

const code = (f: () => unknown): string => {
  try {
    f();
  } catch (e) {
    return e instanceof CryptoError ? e.code : `other:${String(e)}`;
  }
  return 'no-throw';
};

describe('known-answer vectors', () => {
  it('BLAKE2b-256 of the empty string', () => {
    expect(toHex(blake2b(new Uint8Array(0)))).toBe(
      '0e5751c026e543b2e8ab2eb06099daa1d1e5df47778f7787faab45cdf12fe3a8',
    );
  });
  it('XChaCha20-Poly1305 (draft-irtf-cfrg-xchacha §A.3.1)', () => {
    const key = fromHex('808182838485868788898a8b8c8d8e8f909192939495969798999a9b9c9d9e9f');
    const nonce = fromHex('404142434445464748494a4b4c4d4e4f5051525354555657');
    const pt = utf8(
      "Ladies and Gentlemen of the class of '99: If I could offer you only one tip for the future, sunscreen would be it.",
    );
    const ad = fromHex('50515253c0c1c2c3c4c5c6c7');
    const ct = sealWithNonce(key, nonce, pt, ad);
    expect(toHex(ct)).toBe(
      'bd6d179d3e83d43b9576579493c0e939572a1700252bfaccbed2902c21396cbb731c7f1b0b4aa6440bf3a82f4eda7e39ae64c6708c54c216cb96b72e1213b4522f8c9ba40db5d945b11b69b982c1bb9e3f3fac2bc369488f76b2383565d3fff921f9664c97637da9768812f615c68b13b52e' +
        'c0875924c1c7987947deafd8780acf49',
    );
    expect(open(key, nonce, ct, ad)).toEqual(pt);
    expect(code(() => open(key, nonce.subarray(1), ct, ad))).toBe('bad-format');
  });
  it('Argon2id + sub-keys are stable (regression vector)', () => {
    const kek = deriveKek('correct horse battery staple', {
      alg: 'argon2id',
      opslimit: 2,
      memlimit: 16 * 1024 * 1024,
      salt: 'AAAAAAAAAAAAAAAAAAAAAA==',
    });
    expect(toHex(kek)).toBe('8daa1fe857b354cb69583122b648d45a2a7105065dbb6a4dffac0632b9236caa');
    const keys = new Keys(new Uint8Array(32).fill(7));
    expect(recordName(keys, '01J9ZZZZZZZZZZZZZZZZZZZZZZ')).toBe(
      '04f9ffe8f4a6f8e4743f619e98dd49552c24762dbf39543c88d985e4ae315da3',
    );
  });
});

describe('vault (lm.json)', () => {
  it('creates, serialises, unlocks with passphrase and recovery key', () => {
    const v = createVault('hunter2 hunter2', FAST, '2026-10-10');
    const h = parseLmJson(serializeLmJson(v.header));
    expect(unlockWithPassphrase(h, 'hunter2 hunter2')).toEqual(v.dataKey);
    expect(unlockWithRecoveryKey(h, v.recoveryKey)).toEqual(v.dataKey);
    expect(unlockWithRecoveryKey(h, v.recoveryKey.toLowerCase().replace(/-/g, ' '))).toEqual(
      v.dataKey,
    );
    expect(code(() => unlockWithPassphrase(h, 'wrong'))).toBe('wrong-key');
    expect(serializeLmJson(h)).not.toContain(toHex(v.dataKey));
  });
  it('rewraps the passphrase and rotates the recovery key', () => {
    const v = createVault('old pass phrase', FAST, '2026-10-10');
    const h2 = rewrapPassphrase(v.header, v.dataKey, 'new pass phrase', FAST);
    expect(unlockWithPassphrase(h2, 'new pass phrase')).toEqual(v.dataKey);
    expect(code(() => unlockWithPassphrase(h2, 'old pass phrase'))).toBe('wrong-key');
    expect(unlockWithRecoveryKey(h2, v.recoveryKey)).toEqual(v.dataKey);
    const r = rotateRecoveryKey(h2, v.dataKey);
    expect(unlockWithRecoveryKey(r.header, r.recoveryKey)).toEqual(v.dataKey);
    expect(code(() => unlockWithRecoveryKey(r.header, v.recoveryKey))).toBe('wrong-key');
    expect(code(() => rewrapPassphrase(v.header, new Uint8Array(32), 'x', FAST))).toBe(
      'auth-failed',
    );
  });
  it('rejects malformed or downgraded headers', () => {
    const v = createVault('pp', FAST, '2026-10-10');
    expect(code(() => parseLmJson('nope'))).toBe('bad-format');
    expect(code(() => parseLmJson('{}'))).toBe('bad-format');
    expect(code(() => parseLmJson(JSON.stringify({ ...v.header, version: 2 })))).toBe('bad-format');
    const weak = { ...v.header, kdf: { ...v.header.kdf, memlimit: 1024 } };
    expect(code(() => unlockWithPassphrase(weak, 'pp'))).toBe('weak-kdf');
    const alg = { ...v.header, kdf: { ...v.header.kdf, alg: 'scrypt' as 'argon2id' } };
    expect(code(() => unlockWithPassphrase(alg, 'pp'))).toBe('unsupported-kdf');
    const noPass = {
      ...v.header,
      wrappedKeys: v.header.wrappedKeys.filter((k) => k.kind !== 'passphrase'),
    };
    expect(code(() => unlockWithPassphrase(noPass, 'pp'))).toBe('bad-format');
    // Swapping the two wrapped keys' kinds breaks their associated data.
    const swapped = {
      ...v.header,
      wrappedKeys: v.header.wrappedKeys.map(
        (k) => ({ ...k, kind: k.kind === 'passphrase' ? 'recovery' : 'passphrase' }) as const,
      ),
    };
    expect(code(() => unlockWithPassphrase(swapped, 'pp'))).toBe('wrong-key');
    // A key check from another vault is rejected.
    const other = createVault('pp', FAST, '2026-10-10');
    expect(
      code(() => unlockWithPassphrase({ ...v.header, keyCheck: other.header.keyCheck }, 'pp')),
    ).toBe('auth-failed');
  });
});

describe('recovery key encoding', () => {
  it('round-trips and detects typos', () => {
    const k = new Uint8Array(32).map((_, i) => i * 7);
    const t = encodeRecoveryKey(k);
    expect(t).toMatch(/^([A-Z2-7]{4}-){13}[A-Z2-7]$/);
    expect(decodeRecoveryKey(t)).toEqual(k);
    const typo = (t[0] === 'A' ? 'B' : 'A') + t.slice(1);
    expect(code(() => decodeRecoveryKey(typo))).toBe('bad-recovery-key');
    expect(code(() => decodeRecoveryKey('ABC'))).toBe('bad-recovery-key');
    expect(code(() => decodeRecoveryKey('!'.repeat(53)))).toBe('bad-recovery-key');
    expect(code(() => encodeRecoveryKey(new Uint8Array(3)))).toBe('bad-recovery-key');
  });
});

describe('record codec', () => {
  const keys = () => new Keys(new Uint8Array(32).fill(1));
  it('round-trips and uses opaque, sharded paths', () => {
    const k = keys();
    const id = '01J9ABCDEFGHJKMNPQRSTVWXYZ';
    const path = recordPath(k, id);
    expect(path).toMatch(/^r\/[0-9a-f]{2}\/[0-9a-f]{2}\/[0-9a-f]{64}\.lmr$/);
    expect(path).not.toContain(id);
    const text = encodeRecord(k, id, '{"id":"x","title":"Call mom"}');
    expect(text.startsWith(RECORD_PREFIX)).toBe(true);
    expect(text).not.toContain('Call mom');
    expect(decodeRecord(k, path, text)).toBe('{"id":"x","title":"Call mom"}');
    expect(() => assertRecordName(k, path, id)).not.toThrow();
    expect(nameFromRecordPath(path)).toHaveLength(64);
  });
  it('rejects tampered, relocated, truncated or foreign files', () => {
    const k = keys();
    const a = recordPath(k, 'A');
    const b = recordPath(k, 'B');
    const text = encodeRecord(k, 'A', 'a somewhat longer payload so truncation keeps a full nonce');
    const flipped = text.slice(0, -2) + (text.at(-2) === 'A' ? 'B' : 'A') + text.at(-1);
    expect(code(() => decodeRecord(k, a, flipped))).toBe('auth-failed');
    expect(code(() => decodeRecord(k, b, text))).toBe('auth-failed');
    expect(code(() => decodeRecord(k, a, text.slice(0, 20)))).toBe('bad-format');
    expect(code(() => decodeRecord(k, a, text.slice(0, -8)))).toBe('auth-failed');
    expect(code(() => decodeRecord(k, a, 'XXXX.' + text.slice(5)))).toBe('bad-format');
    expect(code(() => decodeRecord(k, a, `${RECORD_PREFIX}@@@`))).toBe('bad-format');
    expect(code(() => decodeRecord(k, 'r/zz/q.lmr', text))).toBe('bad-format');
    expect(code(() => decodeRecord(new Keys(new Uint8Array(32).fill(2)), a, text))).toBe(
      'auth-failed',
    );
    expect(code(() => assertRecordName(k, a, 'B'))).toBe('relocated');
    expect(code(() => assertRecordName(k, 'nope', 'A'))).toBe('relocated');
    // Non-UTF-8 plaintext is a format error.
    expect(nameFromRecordPath(`r/00/11/${'2'.repeat(64)}.lmr`)).toBeNull();
  });
});

describe('blob codec', () => {
  it('round-trips and rejects tampering', () => {
    const k = new Keys(new Uint8Array(32).fill(3));
    const pt = new Uint8Array(1000).map((_, i) => i % 251);
    const { hash, bytes } = encodeBlob(k, pt);
    expect(hash).toBe(contentHash(pt));
    expect(decodeBlob(k, hash, bytes)).toEqual(pt);
    expect(isBlobPath(blobPath(k, hash))).toBe(true);
    const bad = bytes.slice();
    bad[bad.length - 1] = (bad[bad.length - 1] ?? 0) ^ 1;
    expect(code(() => decodeBlob(k, hash, bad))).toBe('auth-failed');
    expect(code(() => decodeBlob(k, contentHash(new Uint8Array(1)), bytes))).toBe('auth-failed');
    expect(code(() => decodeBlob(k, hash, bytes.subarray(0, 10)))).toBe('bad-format');
    const magic = bytes.slice();
    magic[0] = 0;
    expect(code(() => decodeBlob(k, hash, magic))).toBe('bad-format');
    expect(code(() => encodeBlob(k, new Uint8Array(100), 50))).toBe('too-large');
  });
});

describe('local secrets', () => {
  it('seal/open bound to a name', () => {
    const k = new Keys(new Uint8Array(32).fill(4));
    const s = sealLocal(k, 'ghp_token', 'forge-token');
    expect(s).not.toContain('ghp_token');
    expect(openLocal(k, s, 'forge-token')).toBe('ghp_token');
    expect(code(() => openLocal(k, s, 'ai-key'))).toBe('auth-failed');
    expect(code(() => openLocal(k, 'x', 'ai-key'))).toBe('bad-format');
    k.wipe();
    expect(k.record.every((b) => b === 0)).toBe(true);
  });
});
