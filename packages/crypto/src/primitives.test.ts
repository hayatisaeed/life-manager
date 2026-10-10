import { argon2id } from '@noble/hashes/argon2.js';
import { blake2b } from '@noble/hashes/blake2.js';
import { xchacha20poly1305 } from '@noble/ciphers/chacha.js';
import { describe, expect, it, vi } from 'vitest';
import securityMd from '../../../docs/SECURITY.md?raw';
import { fromB64, fromB64url, toHex, utf8 } from './encoding';
import { LmCryptoError } from './errors';
import {
  DEFAULT_KDF,
  SUBKEY_CONTEXTS,
  asKey,
  assertKdfParams,
  deriveKek,
  deriveSubKey,
  hash256,
  normalizePassphrase,
  open,
  randomKey,
  seal,
  sealWithNonce,
} from './primitives';
import { initCrypto } from './sodium';

const hex = (s: string) =>
  Uint8Array.from({ length: s.length / 2 }, (_, i) => parseInt(s.slice(2 * i, 2 * i + 2), 16));
const seq = (n: number, start = 0) => Uint8Array.from({ length: n }, (_, i) => (start + i) & 0xff);
const SMALL_KDF = { opslimit: 2, memlimit: 8 * 1024 * 1024 };

await initCrypto();

describe('known-answer vectors from published specs', () => {
  it('XChaCha20-Poly1305: draft-irtf-cfrg-xchacha-03 §A.3.1', () => {
    const pt = utf8(
      "Ladies and Gentlemen of the class of '99: If I could offer you only one tip for the future, sunscreen would be it.",
    );
    const ad = hex('50515253c0c1c2c3c4c5c6c7');
    const key = asKey(seq(32, 0x80));
    const nonce = hex('404142434445464748494a4b4c4d4e4f5051525354555657');
    const expected =
      'bd6d179d3e83d43b9576579493c0e939572a1700252bfaccbed2902c21396cbb731c7f1b0b4aa6440bf3a82f4eda7e39ae64c6708c54c216cb96b72e1213b4522f8c9ba40db5d945b11b69b982c1bb9e3f3fac2bc369488f76b2383565d3fff921f9664c97637da9768812f615c68b13b52e' +
      'c0875924c1c7987947deafd8780acf49';
    // The vector's AD is binary and `seal` takes a string, so the vector pins
    // noble here and the next block shows `seal` equals noble byte for byte.
    expect(toHex(xchacha20poly1305(key, nonce, ad).encrypt(pt))).toBe(expected);
  });

  it('BLAKE2b-512("abc"): RFC 7693 Appendix A', async () => {
    const { sodium } = await import('./sodium');
    expect(toHex(sodium().crypto_generichash(64, utf8('abc'), null))).toBe(
      'ba80a53f981c4d0d6a2797b69f12f6e94c212f14685ac4b74b12bb6fdbffa2d17d87c5392aab792dc252d5de4533cc9518d38aa8dbf1925ab92386edd4009923',
    );
  });
});

describe('cross-checked against an independent implementation (@noble)', () => {
  it('seal matches noble XChaCha20-Poly1305 and opens noble output', () => {
    const key = randomKey();
    const nonce = seq(24, 7);
    const pt = utf8('hello records');
    const ours = sealWithNonce(key, nonce, pt, 'lmr1|abc');
    const theirs = xchacha20poly1305(key, nonce, utf8('lmr1|abc')).encrypt(pt);
    expect(toHex(ours.subarray(24))).toBe(toHex(theirs));
    expect(open(key, ours, 'lmr1|abc')).toEqual(pt);
  });

  it('deriveKek matches noble Argon2id (p = 1, as libsodium uses)', () => {
    const salt = seq(16, 0xa0);
    const ours = deriveKek('correct horse battery staple', salt, SMALL_KDF);
    const theirs = argon2id(utf8('correct horse battery staple'), salt, {
      t: SMALL_KDF.opslimit,
      m: SMALL_KDF.memlimit / 1024,
      p: 1,
      dkLen: 32,
    });
    expect(toHex(ours)).toBe(toHex(theirs));
    // Pinned so a libsodium upgrade can't silently change every repo's KEK.
    expect(toHex(ours)).toBe('e39212e179d3fb8f71c5bf01561c08f146ccc2a33a43ac323e5b8f66d4765c98');
  });

  it('deriveSubKey matches BLAKE2b(key, salt = id, personal = ctx)', () => {
    const dataKey = asKey(seq(32));
    for (const [name, ctx] of Object.entries(SUBKEY_CONTEXTS)) {
      const salt = new Uint8Array(16);
      salt[0] = 1; // subkey id 1, little-endian
      const personal = new Uint8Array(16);
      personal.set(utf8(ctx)); // 7 chars + NUL padding
      const theirs = blake2b(new Uint8Array(0), {
        key: dataKey,
        salt,
        personalization: personal,
        dkLen: 32,
      });
      expect(toHex(deriveSubKey(dataKey, name as keyof typeof SUBKEY_CONTEXTS))).toBe(
        toHex(theirs),
      );
    }
  });

  it('pins the sub-keys of a fixed data key', () => {
    const dataKey = asKey(seq(32));
    expect(toHex(deriveSubKey(dataKey, 'record'))).toBe(
      '32eb69b32558c6b9a8db5fd15e3fd323dac6981b2774347da3cc5de9c7ae3651',
    );
    expect(toHex(deriveSubKey(dataKey, 'blob'))).toBe(
      'b930b0efc72166362b162b75341d7424d43106e54df24270a4371d29efd78c74',
    );
    expect(toHex(deriveSubKey(dataKey, 'path'))).toBe(
      '88eb2038a51ccf3c10427c5bbcafe6aeb028d203c4e6cf04b11739aefe7208e1',
    );
    expect(toHex(deriveSubKey(dataKey, 'local'))).toBe(
      '0372246361e360956ae1470d3e5df44fa540f9e78709b3b3310d2bf8edbf741b',
    );
    expect(toHex(deriveSubKey(dataKey, 'check'))).toBe(
      '2dd9d99a65de14e5f4b8ae9b03192edada116ac9ac204e49308df447e968ba06',
    );
  });

  it('keyed hash256 matches noble keyed BLAKE2b-256', () => {
    const key = randomKey();
    const msg = utf8('01J9ZZZZZZZZZZZZZZZZZZZZZZ');
    expect(toHex(hash256(msg, key))).toBe(toHex(blake2b(msg, { key, dkLen: 32 })));
    expect(toHex(hash256(msg))).toBe(toHex(blake2b(msg, { dkLen: 32 })));
  });
});

describe('AEAD rejects tampering', () => {
  const key = asKey(seq(32));
  const sealed = seal(key, utf8('payload'), 'ad');

  it('round-trips with fresh nonces', () => {
    expect(open(key, sealed, 'ad')).toEqual(utf8('payload'));
    expect(toHex(seal(key, utf8('payload'), 'ad'))).not.toBe(toHex(sealed));
  });

  it('rejects every flipped byte, a wrong AD, a wrong key and truncation', () => {
    for (let i = 0; i < sealed.length; i++) {
      const bad = sealed.slice();
      bad[i] = (bad[i] ?? 0) ^ 1;
      expect(() => open(key, bad, 'ad')).toThrow(LmCryptoError);
    }
    expect(() => open(key, sealed, 'ad2')).toThrow(/decryption failed/);
    expect(() => open(randomKey(), sealed, 'ad')).toThrow(/decryption failed/);
    expect(() => open(key, sealed.subarray(0, sealed.length - 1), 'ad')).toThrow(
      /decryption failed/,
    );
    expect(() => open(key, sealed.subarray(0, 39), 'ad')).toThrow(
      expect.objectContaining({ code: 'malformed' }),
    );
  });
});

describe('input validation', () => {
  it('bounds Argon2id parameters', () => {
    expect(() => assertKdfParams(DEFAULT_KDF)).not.toThrow();
    for (const bad of [
      { opslimit: 0, memlimit: 8 << 20 },
      { opslimit: 11, memlimit: 8 << 20 },
      { opslimit: 1.5, memlimit: 8 << 20 },
      { opslimit: 3, memlimit: (8 << 20) - 1024 },
      { opslimit: 3, memlimit: 2 ** 30 + 1024 },
      { opslimit: 3, memlimit: (8 << 20) + 1 },
    ]) {
      expect(() => assertKdfParams(bad)).toThrow(
        expect.objectContaining({ code: 'invalid-input' }),
      );
    }
  });

  it('checks salt and key sizes', () => {
    expect(() => deriveKek('x', seq(15), SMALL_KDF)).toThrow(/salt/);
    expect(() => asKey(seq(31))).toThrow(/32 bytes/);
  });

  it('normalizes passphrases with NFKC and rejects empty ones', () => {
    // U+FEFB is the Arabic lam-alef ligature presentation form.
    expect(normalizePassphrase('ﻻ')).toEqual(normalizePassphrase('لا'));
    expect(normalizePassphrase('é')).toEqual(normalizePassphrase('é'));
    expect(() => normalizePassphrase('')).toThrow(/empty/);
  });

  it('reports malformed base64', () => {
    expect(() => fromB64('***')).toThrow(expect.objectContaining({ code: 'malformed' }));
    expect(() => fromB64url('a+b/')).toThrow(expect.objectContaining({ code: 'malformed' }));
  });
});

describe('spec agreement', () => {
  it('SECURITY.md names every sub-key context and AD prefix the code uses', () => {
    for (const ctx of Object.values(SUBKEY_CONTEXTS)) expect(securityMd).toContain(`"${ctx}"`);
    for (const ad of ['"lmr1|"', '"lmb1|"', '"lmk1|"', '"lmc1|key-check"'])
      expect(securityMd).toContain(ad);
  });
});

describe('initialization', () => {
  it('throws not-ready before initCrypto', async () => {
    vi.resetModules();
    const fresh = await import('./sodium');
    expect(() => fresh.sodium()).toThrow(expect.objectContaining({ code: 'not-ready' }));
    await fresh.initCrypto();
    expect(fresh.sodium()).toBeDefined();
  });
});
