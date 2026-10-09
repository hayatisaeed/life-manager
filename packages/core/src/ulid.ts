import { decodeTime, isValid, monotonicFactory } from 'ulid';
import type { Clock, RandomSource } from './env';

/** A 26-character Crockford base32 ULID (DATA-MODEL.md §1). */
export type Ulid = string;

/**
 * Returns a ULID generator. IDs from one generator are strictly increasing,
 * even within one millisecond or when the clock steps backwards, so local
 * insertion order matches id order.
 */
export function createUlidGenerator(clock: Clock, random: RandomSource): () => Ulid {
  const next = monotonicFactory(random);
  return () => next(clock());
}

export function isUlid(value: string): value is Ulid {
  // The library also accepts lowercase; we only ever emit (and accept) uppercase.
  return isValid(value) && value === value.toUpperCase();
}

/** The creation time embedded in a ULID, in epoch milliseconds. */
export function ulidTime(id: Ulid): number {
  return decodeTime(id);
}
