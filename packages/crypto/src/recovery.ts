// Recovery key encoding (SECURITY.md §2): 256 random bits shown as a grouped
// base32 string (RFC 4648 alphabet) with a one-byte BLAKE2b checksum so typos
// are caught before an expensive unlock attempt.

import { CryptoError, blake2b, randomBytes } from './sodium';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

function unbase32(text: string): Uint8Array {
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const c of text) {
    const i = ALPHABET.indexOf(c);
    if (i < 0) throw new CryptoError('bad-recovery-key');
    value = (value << 5) | i;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return new Uint8Array(out);
}

export function newRecoveryKeyBytes(): Uint8Array {
  return randomBytes(32);
}

export function encodeRecoveryKey(key: Uint8Array): string {
  if (key.length !== 32) throw new CryptoError('bad-recovery-key');
  const check = blake2b(key).subarray(0, 1);
  const all = new Uint8Array(33);
  all.set(key);
  all.set(check, 32);
  return (base32(all).match(/.{1,4}/g) ?? []).join('-');
}

export function decodeRecoveryKey(text: string): Uint8Array {
  const clean = text
    .toUpperCase()
    .replace(/[\s-]/g, '')
    // Common transcription mix-ups; 0/1/8 are not in the alphabet.
    .replace(/0/g, 'O')
    .replace(/1/g, 'I')
    .replace(/8/g, 'B');
  if (clean.length !== 53) throw new CryptoError('bad-recovery-key');
  const all = unbase32(clean);
  const key = all.subarray(0, 32);
  if (blake2b(key)[0] !== all[32]) throw new CryptoError('bad-recovery-key');
  return new Uint8Array(key);
}
