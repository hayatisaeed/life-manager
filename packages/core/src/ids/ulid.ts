// ULID (https://github.com/ulid/spec) with injected time and randomness so
// `core` stays deterministic in tests (AGENTS.md §4.9).

import type { Env } from '../env';

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const TIME_LEN = 10;
const RANDOM_LEN = 16;

export function encodeTime(ms: number): string {
  if (!Number.isInteger(ms) || ms < 0 || ms > 2 ** 48 - 1) {
    throw new RangeError(`ULID time out of range: ${ms}`);
  }
  let out = '';
  let t = ms;
  for (let i = 0; i < TIME_LEN; i++) {
    out = (ALPHABET[t % 32] as string) + out;
    t = Math.floor(t / 32);
  }
  return out;
}

export function encodeRandom(bytes: Uint8Array): string {
  // 80 random bits → 16 base32 chars; we take 5 bits from each byte for simplicity
  // and use 16 bytes, which keeps the full alphabet uniform.
  let out = '';
  for (let i = 0; i < RANDOM_LEN; i++) out += ALPHABET[(bytes[i] ?? 0) & 31];
  return out;
}

export function ulid(env: Pick<Env, 'now' | 'random'>): string {
  return encodeTime(env.now()) + encodeRandom(env.random(RANDOM_LEN));
}

export function ulidTime(id: string): number {
  let t = 0;
  for (let i = 0; i < TIME_LEN; i++) t = t * 32 + ALPHABET.indexOf(id[i] ?? '0');
  return t;
}

export const ULID_RE = /^[0-9A-HJKMNP-TV-Z]{26}$/;
