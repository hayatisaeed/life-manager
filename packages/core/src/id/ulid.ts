import { monotonicFactory } from 'ulid';
import type { Clock, Rng } from '../env';

/** A ULID string: 26 Crockford base32 characters, time-sortable. */
export type Ulid = string;

/**
 * Creates a ULID generator. It is monotonic: ids from one generator always
 * increase, even when several are made in the same millisecond or the clock
 * steps backwards, so sorting by id matches creation order on one device.
 */
export function createUlidGenerator(clock: Clock, rng: Rng): () => Ulid {
  const next = monotonicFactory(rng);
  return () => next(clock());
}

const CANONICAL = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/;

export function isUlid(value: string): value is Ulid {
  // Stricter than the library's `isValid`: uppercase only, so a record id has
  // one spelling, and a first character of 0–7, since anything larger
  // overflows the 48-bit timestamp.
  return CANONICAL.test(value);
}
