import { beforeAll, describe, expect, it } from 'vitest';
import { createCrypto, encodeRecovery, decodeRecovery } from './index';
import type { VaultHeader } from './index';
let crypto: Awaited<ReturnType<typeof createCrypto>>;
const bytes = (text: string) => new Uint8Array([...text].map((char) => char.charCodeAt(0)));
beforeAll(async () => {
  crypto = await createCrypto();
});
describe('libsodium primitives and codecs', () => {
  it('matches an independently generated BLAKE2b keyed-hash vector', () => {
    // Python hashlib.blake2b(b'abc', key=bytes(range(32)), digest_size=32).
    expect(
      crypto.keyedHash(bytes('abc'), new Uint8Array(Array.from({ length: 32 }, (_, i) => i))),
    ).toBe('d63a32d3e44738d7907f964316c241adaba0abfeabc32349677578a15a203f7f');
  });
  it('derives independent stable subkeys and opaque paths', () => {
    const key = crypto.randomKey(),
      first = crypto.deriveKeys(key),
      second = crypto.deriveKeys(key);
    expect(first).toEqual(second);
    expect(new Set(Object.values(first).map((value) => [...value].join(','))).size).toBe(4);
    const path = crypto.recordPath('private-record-id', first.path);
    expect(path).toMatch(/^r\/[a-f0-9]{2}\/[a-f0-9]{2}\/[a-f0-9]{64}\.lmr$/);
    expect(path).not.toContain('private');
    expect(crypto.recordPath('private-record-id', crypto.randomKey())).not.toBe(path);
  });
  it('roundtrips records and rejects relocation, tampering, truncation and wrong keys', () => {
    const keys = crypto.deriveKeys(crypto.randomKey());
    const path = crypto.recordPath('one', keys.path),
      other = crypto.recordPath('two', keys.path);
    const plain = bytes('{"id":"one","title":"private"}');
    const encrypted = crypto.encodeRecord(plain, path, keys.record);
    expect(encrypted.startsWith('LMR1.')).toBe(true);
    expect(encrypted).not.toContain('private');
    expect(crypto.decodeRecord(encrypted, path, keys.record)).toEqual(plain);
    expect(crypto.encodeRecord(plain, path, keys.record)).not.toBe(encrypted);
    expect(() => crypto.decodeRecord(encrypted, other, keys.record)).toThrow();
    expect(() => crypto.decodeRecord(encrypted, path, crypto.randomKey())).toThrow();
    expect(() => crypto.decodeRecord(encrypted.slice(0, -20), path, keys.record)).toThrow();
    expect(() =>
      crypto.decodeRecord(
        encrypted.slice(0, 12) + (encrypted[12] === 'A' ? 'B' : 'A') + encrypted.slice(13),
        path,
        keys.record,
      ),
    ).toThrow();
    expect(() => crypto.decodeRecord('bad', path, keys.record)).toThrow();
    expect(() =>
      crypto.encodeRecord(plain, 'r/00/00/' + 'a'.repeat(64) + '.lmr', keys.record),
    ).toThrow();
  });
  it('roundtrips blobs and rejects modified ciphertext and content-hash relocation', () => {
    const key = crypto.randomKey(),
      plain = bytes('attachment'),
      hash = crypto.contentHash(plain);
    const encrypted = crypto.encodeBlob(plain, hash, key);
    expect(crypto.decodeBlob(encrypted, hash, key)).toEqual(plain);
    expect(() => crypto.decodeBlob(encrypted, crypto.contentHash(bytes('other')), key)).toThrow();
    const changed = encrypted.slice();
    changed[changed.length - 1] = (changed[changed.length - 1] ?? 0) ^ 1;
    expect(() => crypto.decodeBlob(changed, hash, key)).toThrow();
    expect(() => crypto.decodeBlob(encrypted.slice(0, 10), hash, key)).toThrow();
    expect(() => crypto.encodeBlob(plain, hash, key, 44)).toThrow();
    expect(() => crypto.encodeBlob(plain, hash, key, 51 * 1024 * 1024)).toThrow();
    expect(() => crypto.encodeBlob(plain, '0'.repeat(64), key)).toThrow();
  });
  it('encodes all 256 recovery bits and rejects malformed padding', () => {
    const key = new Uint8Array(Array.from({ length: 32 }, (_, i) => i));
    const text = encodeRecovery(key);
    expect(decodeRecovery(text.toLowerCase())).toEqual(key);
    expect(() => decodeRecovery(text.slice(0, -1) + 'B')).toThrow();
    expect(() => decodeRecovery('bad')).toThrow();
    expect(() => encodeRecovery(new Uint8Array(31))).toThrow();
  });
  it('zeroes keys on disposal', () => {
    const key = crypto.randomKey();
    crypto.dispose(key);
    expect([...key].every((byte) => byte === 0)).toBe(true);
  });
});
describe('vault create, unlock and rewrap', () => {
  it('unlocks with either credential, changes passphrases without replacing data keys, retains recovery', () => {
    const vault = crypto.createVault('old passphrase', '2026-10-13');
    expect(crypto.unlock(vault.header, 'old passphrase')).toEqual(vault.dataKey);
    expect(crypto.unlock(vault.header, vault.recoveryKey, 'recovery')).toEqual(vault.dataKey);
    const next = crypto.rewrap(vault.header, vault.dataKey, 'new passphrase');
    expect(next.kdf.salt).not.toBe(vault.header.kdf.salt);
    expect(crypto.unlock(next, 'new passphrase')).toEqual(vault.dataKey);
    expect(crypto.unlock(next, vault.recoveryKey, 'recovery')).toEqual(vault.dataKey);
    expect(() => crypto.unlock(next, 'old passphrase')).toThrow();
    expect(() => crypto.rewrap(next, crypto.randomKey(), 'another')).toThrow();
    crypto.dispose(vault.dataKey);
  });
  it('rejects altered headers and bounds untrusted KDF costs before allocating', () => {
    const vault = crypto.createVault('passphrase', '2026-10-13');
    expect(() =>
      crypto.unlock(
        { ...vault.header, kdf: { ...vault.header.kdf, memlimit: 2 ** 40 } },
        'passphrase',
      ),
    ).toThrow();
    expect(() =>
      crypto.unlock(
        {
          ...vault.header,
          wrappedKeys: [vault.header.wrappedKeys[0], vault.header.wrappedKeys[0]],
        },
        'passphrase',
      ),
    ).toThrow();
    const invalid: VaultHeader = { ...vault.header, keyCheck: 'AA' };
    expect(() => crypto.unlock(invalid, vault.recoveryKey, 'recovery')).toThrow();
    expect(() => crypto.unlock({ ...vault.header, version: 2 }, 'passphrase')).toThrow();
    crypto.dispose(vault.dataKey);
  });
});
