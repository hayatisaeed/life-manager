// Thin wrappers over libsodium. The only primitives the app uses; see
// SECURITY.md §2 for the table and ADR-016/017 for the parameter choices.
import { concat, utf8 } from './encoding';
import { LmCryptoError } from './errors';
import { sodium } from './sodium';

export const KEY_BYTES = 32;
export const NONCE_BYTES = 24;
export const TAG_BYTES = 16;
export const SALT_BYTES = 16;

/** A 32-byte symmetric key. Branded so a raw buffer isn't passed by mistake. */
export type Key = Uint8Array & { readonly __lmKey: true };

export interface KdfParams {
  readonly opslimit: number;
  readonly memlimit: number;
}

/**
 * ADR-016: one Argon2id setting per repo, chosen by the device that creates
 * it and stored in lm.json. ops 3 / 256 MiB took ~0.8 s in Chromium wasm on a
 * desktop-class CPU (spikes/README.md).
 */
export const DEFAULT_KDF: KdfParams = { opslimit: 3, memlimit: 256 * 1024 * 1024 };

/**
 * Accepted range for parameters read from lm.json. The upper bounds stop a
 * tampered lm.json from making unlock allocate or spin without limit.
 */
export const KDF_LIMITS = {
  opslimit: { min: 1, max: 10 },
  memlimit: { min: 8 * 1024 * 1024, max: 1024 * 1024 * 1024 },
} as const;

export function assertKdfParams(p: KdfParams): void {
  const ok =
    Number.isInteger(p.opslimit) &&
    Number.isInteger(p.memlimit) &&
    p.opslimit >= KDF_LIMITS.opslimit.min &&
    p.opslimit <= KDF_LIMITS.opslimit.max &&
    p.memlimit >= KDF_LIMITS.memlimit.min &&
    p.memlimit <= KDF_LIMITS.memlimit.max &&
    p.memlimit % 1024 === 0;
  if (!ok) throw new LmCryptoError('invalid-input', 'Argon2id parameters out of range');
}

export function randomBytes(n: number): Uint8Array {
  return sodium().randombytes_buf(n);
}

export function randomKey(): Key {
  return randomBytes(KEY_BYTES) as Key;
}

export function asKey(bytes: Uint8Array): Key {
  if (bytes.length !== KEY_BYTES) throw new LmCryptoError('invalid-input', 'key must be 32 bytes');
  return bytes as Key;
}

/**
 * Passphrases are NFKC-normalized before hashing so the same visible text
 * typed on different keyboards (e.g. Arabic presentation forms) derives the
 * same key. ADR-017.
 */
export function normalizePassphrase(passphrase: string): Uint8Array {
  const normalized = passphrase.normalize('NFKC');
  if (normalized.length === 0) throw new LmCryptoError('invalid-input', 'empty passphrase');
  return utf8(normalized);
}

/** Argon2id (crypto_pwhash, ALG_ARGON2ID13) → 32-byte key-encryption key. */
export function deriveKek(passphrase: string, salt: Uint8Array, params: KdfParams): Key {
  assertKdfParams(params);
  if (salt.length !== SALT_BYTES) throw new LmCryptoError('invalid-input', 'salt must be 16 bytes');
  const s = sodium();
  return s.crypto_pwhash(
    KEY_BYTES,
    normalizePassphrase(passphrase),
    salt,
    params.opslimit,
    params.memlimit,
    s.crypto_pwhash_ALG_ARGON2ID13,
  ) as Key;
}

/**
 * Sub-key contexts (SECURITY.md §2). libsodium needs exactly 8 context bytes;
 * the 7-character names are NUL-padded, which is what a C or Rust caller
 * passing the same string literal gets. ADR-017.
 */
export const SUBKEY_CONTEXTS = {
  record: 'lm-rec1',
  blob: 'lm-blob',
  path: 'lm-path',
  local: 'lm-locl',
  check: 'lm-chk1',
} as const;
export type SubKeyName = keyof typeof SUBKEY_CONTEXTS;

/** crypto_kdf_derive_from_key(32, id = 1, ctx, dataKey). */
export function deriveSubKey(dataKey: Key, name: SubKeyName): Key {
  return sodium().crypto_kdf_derive_from_key(
    KEY_BYTES,
    1,
    `${SUBKEY_CONTEXTS[name]}\0`,
    dataKey,
  ) as Key;
}

/** XChaCha20-Poly1305 IETF with a fresh random nonce. Returns nonce ‖ ciphertext ‖ tag. */
export function seal(key: Key, plaintext: Uint8Array, ad: string): Uint8Array {
  return sealWithNonce(key, randomBytes(NONCE_BYTES), plaintext, ad);
}

/** Only for known-answer tests; production code must use `seal`. */
export function sealWithNonce(
  key: Key,
  nonce: Uint8Array,
  plaintext: Uint8Array,
  ad: string,
): Uint8Array {
  const ct = sodium().crypto_aead_xchacha20poly1305_ietf_encrypt(
    plaintext,
    utf8(ad),
    null,
    nonce,
    key,
  );
  return concat(nonce, ct);
}

/** Inverse of `seal`. Throws `auth-failed` for a wrong key, AD, or any tampering or truncation. */
export function open(key: Key, sealed: Uint8Array, ad: string): Uint8Array {
  if (sealed.length < NONCE_BYTES + TAG_BYTES) {
    throw new LmCryptoError('malformed', 'ciphertext too short');
  }
  try {
    return sodium().crypto_aead_xchacha20poly1305_ietf_decrypt(
      null,
      sealed.subarray(NONCE_BYTES),
      utf8(ad),
      sealed.subarray(0, NONCE_BYTES),
      key,
    );
  } catch {
    throw new LmCryptoError('auth-failed', 'decryption failed');
  }
}

/** BLAKE2b-256, keyed when `key` is given. */
export function hash256(msg: Uint8Array, key?: Key): Uint8Array {
  return sodium().crypto_generichash(32, msg, key ?? null);
}
