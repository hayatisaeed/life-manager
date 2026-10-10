// Fractional indexing for user-ordered lists (DATA-MODEL.md §1 "Ordering").

import { generateKeyBetween, generateNKeysBetween } from 'fractional-indexing';

/** A key sorting strictly between `a` and `b` (either may be null for the ends). */
export function orderBetween(a: string | null | undefined, b: string | null | undefined): string {
  // Concurrent inserts can produce equal keys; ties are broken by id when sorting.
  if (a && b && a >= b) return generateKeyBetween(a, null);
  return generateKeyBetween(a ?? null, b ?? null);
}

export function orderKeys(n: number, after: string | null = null): string[] {
  return generateNKeysBetween(after, null, n);
}

export function compareOrder(
  a: { order: string; id: string },
  b: { order: string; id: string },
): number {
  if (a.order !== b.order) return a.order < b.order ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}
