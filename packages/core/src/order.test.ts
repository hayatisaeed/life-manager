import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { OrderKeyError, compareOrdered, orderKeyBetween, orderKeysBetween } from './order';

describe('order keys', () => {
  it('keeps a list sorted under any sequence of inserts', () => {
    fc.assert(
      fc.property(fc.array(fc.nat(), { maxLength: 200 }), (positions) => {
        const keys: string[] = [];
        for (const p of positions) {
          const i = keys.length === 0 ? 0 : p % (keys.length + 1);
          const key = orderKeyBetween(keys[i - 1] ?? null, keys[i] ?? null);
          keys.splice(i, 0, key);
        }
        for (let i = 1; i < keys.length; i++)
          expect((keys[i - 1] ?? '') < (keys[i] ?? '')).toBe(true);
      }),
    );
  });

  it('generates n sorted keys between bounds', () => {
    const [a, b] = [orderKeyBetween(null, null), null];
    const keys = orderKeysBetween(a, b, 5);
    expect(keys).toHaveLength(5);
    expect([a, ...keys]).toEqual([a, ...keys].sort());
    expect(new Set(keys).size).toBe(5);
  });

  it('rejects equal or reversed bounds', () => {
    const k = orderKeyBetween(null, null);
    const later = orderKeyBetween(k, null);
    expect(() => orderKeyBetween(k, k)).toThrow(OrderKeyError);
    expect(orderKeyBetween(null, k) < k).toBe(true);
    expect(() => orderKeysBetween(later, k, 2)).toThrow(OrderKeyError);
  });

  it('breaks ties from concurrent inserts by id, deterministically', () => {
    const k = orderKeyBetween(null, null);
    const items = [
      { order: orderKeyBetween(k, null), id: '01B' },
      { order: k, id: '01C' },
      { order: k, id: '01A' },
      { order: k, id: '01A' },
    ];
    expect([...items].sort(compareOrdered).map((x) => x.id)).toEqual(['01A', '01A', '01C', '01B']);
    expect(compareOrdered({ order: k, id: '01C' }, { order: k, id: '01A' })).toBe(1);
    expect(compareOrdered({ order: k, id: '01A' }, { order: k, id: '01C' })).toBe(-1);
    expect(compareOrdered({ order: k, id: '01A' }, { order: k, id: '01A' })).toBe(0);
    const later = orderKeyBetween(k, null);
    expect(compareOrdered({ order: later, id: '01A' }, { order: k, id: '01Z' })).toBe(1);
    expect(compareOrdered({ order: k, id: '01Z' }, { order: later, id: '01A' })).toBe(-1);
  });
});
