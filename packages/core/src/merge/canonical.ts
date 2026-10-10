// A stable string form of JSON-like values: object keys sorted, `undefined`
// (an absent field) distinct from everything else. Used to compare values
// and to break ties the same way on every device.

const ABSENT = '\u0000absent';

export function canonical(value: unknown): string {
  if (value === undefined) return ABSENT;
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value !== null && typeof value === 'object') {
    // Object keys are unique, so the order is total without a tie case.
    const entries = Object.entries(value).sort(([a], [b]) => (a < b ? -1 : 1));
    // fromEntries keeps a `__proto__` key as data (see entities/envelope.ts).
    return Object.fromEntries(entries.map(([k, v]) => [k, sortKeys(v)]));
  }
  return value;
}

export const same = (a: unknown, b: unknown) => canonical(a) === canonical(b);

/** Plain code-unit order, never locale order, so every device agrees. */
export const compareStrings = (a: string, b: string): -1 | 0 | 1 => (a < b ? -1 : a > b ? 1 : 0);
