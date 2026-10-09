import { describe, expect, it } from 'vitest';
import { createUlidGenerator, isUlid, ulidTime } from './ulid';
import { seededRandom } from './test-utils';

describe('ulid', () => {
  it('is deterministic for an injected clock and random source', () => {
    const a = createUlidGenerator(() => 1_760_000_000_000, seededRandom(1));
    const b = createUlidGenerator(() => 1_760_000_000_000, seededRandom(1));
    expect([a(), a()]).toEqual([b(), b()]);
  });

  it('embeds the clock time', () => {
    const next = createUlidGenerator(() => 1_760_000_000_123, seededRandom(2));
    const id = next();
    expect(isUlid(id)).toBe(true);
    expect(id).toHaveLength(26);
    expect(ulidTime(id)).toBe(1_760_000_000_123);
  });

  it('stays strictly increasing within a millisecond and when the clock goes backwards', () => {
    const times = [5_000, 5_000, 5_000, 4_000, 6_000, 6_000];
    let i = 0;
    const next = createUlidGenerator(() => times[i++] ?? 0, seededRandom(3));
    const ids = times.map(() => next());
    expect([...ids].sort()).toEqual(ids);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('rejects malformed and lowercase ids', () => {
    const id = createUlidGenerator(() => 1, seededRandom(4))();
    expect(isUlid(id.toLowerCase())).toBe(false);
    expect(isUlid('')).toBe(false);
    expect(isUlid('not-a-ulid')).toBe(false);
  });
});
