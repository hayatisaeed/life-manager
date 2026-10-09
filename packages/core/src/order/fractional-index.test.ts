import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  compareByOrder,
  compareOrder,
  orderBetween,
  OrderKeyError,
  ordersBetween,
} from './fractional-index';

describe('orderBetween', () => {
  it('creates keys at the start, end and middle', () => {
    const first = orderBetween(null, null);
    const after = orderBetween(first, null);
    const before = orderBetween(null, first);
    const mid = orderBetween(first, after);
    expect([after, first, mid, before].sort()).toEqual([before, first, mid, after]);
  });

  it('rejects bounds that are equal or reversed', () => {
    expect(() => orderBetween('a1', 'a1')).toThrow(OrderKeyError);
    expect(() => orderBetween('a2', 'a1')).toThrow(OrderKeyError);
    expect(() => ordersBetween('a2', 'a1', 2)).toThrow(OrderKeyError);
  });

  it('wraps invalid keys from the library in OrderKeyError', () => {
    expect(() => orderBetween('not a key', null)).toThrow(OrderKeyError);
    expect(() => ordersBetween('!!', null, 2)).toThrow(OrderKeyError);
  });

  // Random inserts anywhere in a list must keep the keys strictly sorted in
  // insertion position, with no duplicates.
  it('keeps any sequence of inserts in order', () => {
    fc.assert(
      fc.property(fc.array(fc.nat(), { minLength: 1, maxLength: 300 }), (positions) => {
        const keys: string[] = [];
        for (const p of positions) {
          const i = p % (keys.length + 1);
          keys.splice(i, 0, orderBetween(keys[i - 1] ?? null, keys[i] ?? null));
        }
        for (let i = 1; i < keys.length; i++) {
          expect(compareOrder(keys[i - 1] ?? '', keys[i] ?? '')).toBe(-1);
        }
      }),
    );
  });
});

describe('ordersBetween', () => {
  it('returns count increasing keys strictly between the bounds', () => {
    const keys = ordersBetween('a0', 'a1', 5);
    expect(keys).toHaveLength(5);
    const all = ['a0', ...keys, 'a1'];
    expect([...all].sort()).toEqual(all);
    expect(new Set(all).size).toBe(all.length);
  });
});

describe('compareByOrder', () => {
  it('breaks ties on equal keys by id, the same way on every device', () => {
    const items = [
      { order: 'a1', id: '01B' },
      { order: 'a0', id: '01Z' },
      { order: 'a1', id: '01A' },
    ];
    expect(items.sort(compareByOrder).map((i) => i.id)).toEqual(['01Z', '01A', '01B']);
    expect(compareByOrder({ order: 'a0', id: 'x' }, { order: 'a0', id: 'x' })).toBe(0);
  });

  it('uses code-unit order, so uppercase sorts before lowercase', () => {
    expect(compareOrder('Zz', 'a0')).toBe(-1);
    expect(compareOrder('a0', 'Zz')).toBe(1);
  });
});
