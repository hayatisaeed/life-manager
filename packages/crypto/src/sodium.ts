// Thin wrappers over libsodium (SECURITY.md §2). We never implement primitives
// ourselves (AGENTS.md §4.6); this module only fixes parameters and formats.

import _sodium from 'libsodium-wrappers-sumo';

export type Sodium = typeof _sodium;

let readyPromise: Promise<Sodium> | null = null;

/** Resolves once libsodium's wasm is initialised. Safe to call repeatedly. */
export function sodiumReady(): Promise<Sodium> {
  readyPromise ??= _sodium.ready.then(() => _sodium);
  return readyPromise;
}

function s(): Sodium {
  // Every exported helper is only reachable after `sodiumReady()` resolved
  // (enforced by `Crypto` being constructed from it).
  return _sodium;
}

export const KEY_BYTES = 32;
export const NONCE_BYTES = 24;

// --- encoding ---------------------------------------------------------------

export const toB64 = (b: Uint8Array): string => s().to_base64(b, s().base64_variants.ORIGINAL);
export const fromB64 = (t: string): Uint8Array => s().from_base64(t, s().base64_variants.ORIGINAL);
export const toB64Url = (b: Uint8Array): string =>
  s().to_base64(b, s().base64_variants.URLSAFE_NO_PADDING);
export const fromB64Url = (t: string): Uint8Array =>
  s().from_base64(t, s().base64_variants.URLSAFE_NO_PADDING);
export const toHex = (b: Uint8Array): string => s().to_hex(b);
export const fromHex = (h: string): Uint8Array => s().from_hex(h);
export const utf8 = (t: string): Uint8Array => new TextEncoder().encode(t);
export const fromUtf8 = (b: Uint8Array): string =>
  new TextDecoder('utf-8', { fatal: true }).decode(b);

export function randomBytes(n: number): Uint8Array {
  return s().randombytes_buf(n);
}

export function memzero(b: Uint8Array): void {
  s().memzero(b);
}

export function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && s().memcmp(a, b);
}

// --- KDF ----------------------------------------------------------------------

export interface KdfParams {
  alg: 'argon2id';
  opslimit: number;
  memlimit: number;
  /** base64, 16 bytes */
  salt: string;
}

/** SECURITY.md §2: ops 3; 256 MiB on desktop, 64 MiB on mobile/web. */
export const KDF_DESKTOP = { opslimit: 3, memlimit: 256 * 1024 * 1024 } as const;
export const KDF_MOBILE = { opslimit: 3, memlimit: 64 * 1024 * 1024 } as const;

export function newKdfParams(cost: { opslimit: number; memlimit: number }): KdfParams {
  return { alg: 'argon2id', ...cost, salt: toB64(randomBytes(s().crypto_pwhash_SALTBYTES)) };
}

/** Passphrase → key-encryption key (Argon2id). */
export function deriveKek(passphrase: string, p: KdfParams): Uint8Array {
  if (p.alg !== 'argon2id') throw new CryptoError('unsupported-kdf');
  // Floor the cost so a tampered lm.json can't downgrade the KDF to nothing.
  if (p.opslimit < 2 || p.memlimit < 16 * 1024 * 1024) throw new CryptoError('weak-kdf');
  return s().crypto_pwhash(
    KEY_BYTES,
    utf8(passphrase.normalize('NFKC')),
    fromB64(p.salt),
    p.opslimit,
    p.memlimit,
    s().crypto_pwhash_ALG_ARGON2ID13,
  );
}

// --- AEAD ---------------------------------------------------------------------

const adBytes = (ad: string | Uint8Array): Uint8Array => (typeof ad === 'string' ? utf8(ad) : ad);

/** XChaCha20-Poly1305 IETF with a random 24-byte nonce. */
export function seal(
  key: Uint8Array,
  plaintext: Uint8Array,
  ad: string,
): { nonce: Uint8Array; ct: Uint8Array } {
  const nonce = randomBytes(NONCE_BYTES);
  const ct = s().crypto_aead_xchacha20poly1305_ietf_encrypt(plaintext, utf8(ad), null, nonce, key);
  return { nonce, ct };
}

export function sealWithNonce(
  key: Uint8Array,
  nonce: Uint8Array,
  plaintext: Uint8Array,
  ad: string | Uint8Array,
): Uint8Array {
  return s().crypto_aead_xchacha20poly1305_ietf_encrypt(plaintext, adBytes(ad), null, nonce, key);
}

export function open(
  key: Uint8Array,
  nonce: Uint8Array,
  ct: Uint8Array,
  ad: string | Uint8Array,
): Uint8Array {
  if (nonce.length !== NONCE_BYTES) throw new CryptoError('bad-format');
  try {
    return s().crypto_aead_xchacha20poly1305_ietf_decrypt(null, ct, adBytes(ad), nonce, key);
  } catch {
    throw new CryptoError('auth-failed');
  }
}

// --- hashing --------------------------------------------------------------------

/** BLAKE2b-256, keyed when `key` is given. */
export function blake2b(msg: Uint8Array, key?: Uint8Array): Uint8Array {
  return s().crypto_generichash(32, msg, key ?? null);
}

/** Sub-key derivation, SECURITY.md §2. Context strings are exactly 8 bytes (ADR-012). */
export const SUBKEY_CONTEXTS = {
  record: 'lm-rec1_',
  blob: 'lm-blob_',
  path: 'lm-path_',
  local: 'lm-locl_',
} as const;

export function deriveSubKey(dataKey: Uint8Array, kind: keyof typeof SUBKEY_CONTEXTS): Uint8Array {
  return s().crypto_kdf_derive_from_key(KEY_BYTES, 1, SUBKEY_CONTEXTS[kind], dataKey);
}

export class CryptoError extends Error {
  constructor(
    public readonly code:
      | 'auth-failed'
      | 'bad-format'
      | 'relocated'
      | 'unsupported-kdf'
      | 'weak-kdf'
      | 'wrong-key'
      | 'bad-recovery-key'
      | 'too-large',
  ) {
    super(`crypto: ${code}`);
    this.name = 'CryptoError';
  }
}
