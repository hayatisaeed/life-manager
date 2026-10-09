import { generateKeyBetween, generateNKeysBetween } from 'fractional-indexing';

// Order keys for user-sorted lists (DATA-MODEL.md §1, "Ordering"). Keys are
// base-62 strings from the `fractional-indexing` package, compared by plain
// code-unit order (also SQLite's BINARY collation), never `localeCompare`.
//
// Two devices inserting at the same spot while offline can produce the same
// key. That's harmless: lists sort by (order, id), which every device computes
// identically. To insert between two items with equal keys, re-space them with
// `ordersBetween` using their distinct neighbours.

export type OrderKey = string;

export class OrderKeyError extends Error {
  override name = 'OrderKeyError';
}

function checkBounds(before: OrderKey | null, after: OrderKey | null): void {
  if (before !== null && after !== null && before >= after) {
    throw new OrderKeyError('`before` must sort strictly before `after`');
  }
}

function wrap<T>(fn: () => T): T {
  try {
    return fn();
  } catch (cause) {
    // The library throws plain Errors for malformed keys; give callers one type.
    throw new OrderKeyError('Invalid order key', { cause });
  }
}

/** A key that sorts after `before` and before `after`; null means the list's start or end. */
export function orderBetween(before: OrderKey | null, after: OrderKey | null): OrderKey {
  checkBounds(before, after);
  return wrap(() => generateKeyBetween(before, after));
}

/** `count` evenly spaced, increasing keys between `before` and `after`. */
export function ordersBetween(
  before: OrderKey | null,
  after: OrderKey | null,
  count: number,
): OrderKey[] {
  checkBounds(before, after);
  return wrap(() => generateNKeysBetween(before, after, count));
}

export function compareOrder(a: OrderKey, b: OrderKey): -1 | 0 | 1 {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Sort comparator for ordered items: by order key, then by id to break ties. */
export function compareByOrder(
  a: { readonly order: OrderKey; readonly id: string },
  b: { readonly order: OrderKey; readonly id: string },
): -1 | 0 | 1 {
  return compareOrder(a.order, b.order) || compareOrder(a.id, b.id);
}
