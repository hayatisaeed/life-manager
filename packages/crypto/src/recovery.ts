// Recovery key (SECURITY.md §2): 256 random bits, shown either as 24 BIP-39
// English words or as a grouped base32 string. Both forms carry a checksum so
// a typo is caught before an unlock attempt. ADR-017 defines the base32 form.
import { entropyToMnemonic, mnemonicToEntropy } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english.js';
import { concat } from './encoding';
import { LmCryptoError } from './errors';
import { asKey, hash256, randomKey, type Key } from './primitives';

export type RecoveryKey = Key;

export function generateRecoveryKey(): RecoveryKey {
  return randomKey();
}

/** 24 lowercase BIP-39 English words separated by single spaces. */
export function recoveryKeyToWords(key: RecoveryKey): string {
  return entropyToMnemonic(asKey(key), wordlist);
}

// Crockford base32: no I, L, O or U, so it's hard to misread.
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const CHECKSUM_BYTES = 3;
const BASE32_CHARS = 56; // (32 + 3) bytes × 8 / 5

/** 56 Crockford base32 characters in groups of 4, e.g. `7W3K-…`. */
export function recoveryKeyToBase32(key: RecoveryKey): string {
  const payload = concat(asKey(key), checksum(key));
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of payload) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  const groups: string[] = [];
  for (let i = 0; i < out.length; i += 4) groups.push(out.slice(i, i + 4));
  return groups.join('-');
}

/**
 * Accepts either form, ignoring case and surrounding whitespace. Base32 input
 * may use any separators and the usual Crockford confusables (O→0, I/L→1).
 */
export function parseRecoveryKey(input: string): RecoveryKey {
  const words = input.trim().toLowerCase().split(/\s+/);
  if (words.length === 24) {
    try {
      return asKey(mnemonicToEntropy(words.join(' '), wordlist));
    } catch {
      throw new LmCryptoError('invalid-input', 'recovery words are not valid');
    }
  }
  return parseBase32(input);
}

function parseBase32(input: string): RecoveryKey {
  const chars = input.toUpperCase().replace(/[\s-]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
  if (chars.length !== BASE32_CHARS) {
    throw new LmCryptoError('invalid-input', 'recovery key has the wrong length');
  }
  const bytes = new Uint8Array(32 + CHECKSUM_BYTES);
  let bits = 0;
  let value = 0;
  let at = 0;
  for (const c of chars) {
    const v = ALPHABET.indexOf(c);
    if (v < 0) throw new LmCryptoError('invalid-input', 'recovery key has an invalid character');
    value = ((value << 5) | v) & 0xffff;
    bits += 5;
    if (bits >= 8) {
      bytes[at++] = (value >>> (bits - 8)) & 0xff;
      bits -= 8;
    }
  }
  const key = asKey(bytes.slice(0, 32));
  const sum = bytes.subarray(32);
  if (!checksum(key).every((b, i) => b === sum[i])) {
    throw new LmCryptoError('invalid-input', 'recovery key checksum does not match');
  }
  return key;
}

/** First 3 bytes of BLAKE2b-256(key). Detects typos; not a secret. */
function checksum(key: RecoveryKey): Uint8Array {
  return hash256(key).subarray(0, CHECKSUM_BYTES);
}
