import fc from 'fast-check';
import { decodeTime } from 'ulid';
import { describe, expect, it } from 'vitest';
import { createUlidGenerator, isUlid } from './ulid';

const T0 = Date.UTC(2026, 9, 9, 10, 15);

/** Deterministic PRNG (mulberry32) so ids are reproducible. */
function seeded(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('createUlidGenerator', () => {
  it('encodes the injected time and is deterministic for a seed', () => {
    const a = createUlidGenerator(() => T0, seeded(1))();
    const b = createUlidGenerator(() => T0, seeded(1))();
    expect(a).toBe(b);
    expect(isUlid(a)).toBe(true);
    expect(decodeTime(a)).toBe(T0);
  });

  it('is strictly increasing even when the clock stalls or goes backwards', () => {
    fc.assert(
      fc.property(
        fc.integer(),
        fc.array(fc.integer({ min: -5, max: 5 }), { maxLength: 300 }),
        (seed, jumps) => {
          let now = T0;
          const next = createUlidGenerator(() => now, seeded(seed));
          let last = next();
          for (const j of jumps) {
            now += j;
            const id = next();
            expect(id > last).toBe(true);
            last = id;
          }
        },
      ),
    );
  });
});

describe('isUlid', () => {
  it.each([
    '',
    '01J9',
    '01J9ZZZZZZZZZZZZZZZZZZZZZU',
    '01j9zzzzzzzzzzzzzzzzzzzzzz',
    '81J9ZZZZZZZZZZZZZZZZZZZZZZ',
  ])('rejects %j', (bad) => {
    expect(isUlid(bad)).toBe(false);
  });
});
