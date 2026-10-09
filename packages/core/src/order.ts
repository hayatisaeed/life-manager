import { generateKeyBetween, generateNKeysBetween } from 'fractional-indexing';

/**
 * Fractional-index order keys (DATA-MODEL.md §1 "Ordering").
 *
 * Two devices inserting at the same spot while offline can produce the same
 * key. That is harmless: lists sort by `(order, id)` with {@link compareOrdered},
 * so every device shows the same order.
 */
export type OrderKey = string;

export class OrderKeyError extends Error {
  override name = 'OrderKeyError';
}

/**
 * A key that sorts strictly between `before` and `after` (`null` = list
 * start or end). Throws if `before >= after`; with equal neighbours (a
 * concurrent-insert tie) the caller must re-key one of them first.
 */
export function orderKeyBetween(before: OrderKey | null, after: OrderKey | null): OrderKey {
  assertBounds(before, after);
  return generateKeyBetween(before, after);
}

/** `n` sorted keys strictly between `before` and `after`, e.g. for a bulk import. */
export function orderKeysBetween(
  before: OrderKey | null,
  after: OrderKey | null,
  n: number,
): OrderKey[] {
  assertBounds(before, after);
  return generateNKeysBetween(before, after, n);
}

function assertBounds(before: OrderKey | null, after: OrderKey | null): void {
  if (before !== null && after !== null && before >= after) {
    throw new OrderKeyError('Order key bounds must satisfy before < after');
  }
}

/** Sorts by order key, then id. Plain code-unit comparison, matching SQLite's BINARY collation. */
export function compareOrdered(
  a: { order: OrderKey; id: string },
  b: { order: OrderKey; id: string },
): number {
  if (a.order !== b.order) return a.order < b.order ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}
