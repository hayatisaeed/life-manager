import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  HlcClock,
  ULID_RE,
  compareHlc,
  encodeTime,
  formatHlc,
  initialHlc,
  isHlc,
  maxHlc,
  orderBetween,
  orderKeys,
  compareOrder,
  parseHlc,
  receive,
  testEnv,
  tick,
  ulid,
  ulidTime,
  MAX_DRIFT_MS,
} from '../src';

describe('ulid', () => {
  it('encodes time and sorts by time', () => {
    const env = testEnv(1_700_000_000_000);
    const a = ulid(env);
    env.advance(1);
    const b = ulid(env);
    expect(a).toMatch(ULID_RE);
    expect(a < b).toBe(true);
    expect(ulidTime(a)).toBe(1_700_000_000_000);
  });
  it('rejects invalid times', () => {
    expect(() => encodeTime(-1)).toThrow();
    expect(() => encodeTime(2 ** 48)).toThrow();
  });
});

describe('hlc', () => {
  const T = Date.UTC(2026, 9, 9);
  it('formats and parses', () => {
    const s = { ms: T, counter: 3, deviceId: 'devA' };
    const h = formatHlc(s);
    expect(h).toBe('2026-10-09T00:00:00.000Z-0003-devA');
    expect(parseHlc(h)).toEqual(s);
    expect(isHlc(h)).toBe(true);
    expect(isHlc('x')).toBe(false);
    expect(() => parseHlc('nope')).toThrow();
    expect(() => initialHlc('bad id')).toThrow();
  });
  it('tick is strictly monotonic even when the wall clock goes backwards', () => {
    fc.assert(
      fc.property(fc.array(fc.integer({ min: 0, max: 10_000 }), { maxLength: 200 }), (walls) => {
        let s = initialHlc('d1');
        let prev = formatHlc(s);
        for (const w of walls) {
          s = tick(s, T + w);
          const h = formatHlc(s);
          expect(compareHlc(h, prev)).toBe(1);
          prev = h;
        }
      }),
    );
  });
  it('counter overflow bumps ms', () => {
    let s = { ms: T, counter: 0xffff, deviceId: 'd' };
    s = tick(s, T);
    expect(s).toEqual({ ms: T + 1, counter: 0, deviceId: 'd' });
    const r = receive(
      { ms: T, counter: 1, deviceId: 'd' },
      formatHlc({ ms: T, counter: 0xffff, deviceId: 'e' }),
      T,
    );
    expect(r).toEqual({ ms: T + 1, counter: 0, deviceId: 'd' });
  });
  it('receive orders after the remote clock', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 1e6 }),
        fc.integer({ min: 0, max: 1e6 }),
        fc.integer({ min: 0, max: 0xfff0 }),
        fc.integer({ min: 0, max: 1e6 }),
        (local, remote, rc, wall) => {
          const s = { ms: T + local, counter: 5, deviceId: 'a' };
          const rh = formatHlc({ ms: T + remote, counter: rc, deviceId: 'b' });
          const n = receive(s, rh, T + wall);
          const nh = formatHlc(n);
          expect(nh > formatHlc(s)).toBe(true);
          expect(parseHlc(nh).ms > T + remote || parseHlc(nh).counter > rc).toBe(true);
          expect(n.ms).toBeGreaterThanOrEqual(T + wall);
        },
      ),
    );
  });
  it('receive covers each branch', () => {
    const s = { ms: T, counter: 2, deviceId: 'a' };
    expect(receive(s, formatHlc({ ms: T, counter: 7, deviceId: 'b' }), T - 5)).toMatchObject({
      ms: T,
      counter: 8,
    });
    expect(receive(s, formatHlc({ ms: T - 9, counter: 7, deviceId: 'b' }), T - 5)).toMatchObject({
      ms: T,
      counter: 3,
    });
    expect(receive(s, formatHlc({ ms: T + 9, counter: 7, deviceId: 'b' }), T)).toMatchObject({
      ms: T + 9,
      counter: 8,
    });
    expect(receive(s, formatHlc({ ms: T + 9, counter: 7, deviceId: 'b' }), T + 20)).toMatchObject({
      ms: T + 20,
      counter: 0,
    });
  });
  it('ignores remote clocks far in the future', () => {
    const s = { ms: T, counter: 0, deviceId: 'a' };
    const far = formatHlc({ ms: T + MAX_DRIFT_MS + 10_000, counter: 0, deviceId: 'b' });
    expect(receive(s, far, T + 1).ms).toBe(T + 1);
  });
  it('clock wrapper and helpers', () => {
    const env = testEnv(T);
    const c = new HlcClock(initialHlc('dev'), env.now);
    const a = c.now();
    const b = c.now();
    expect(a < b).toBe(true);
    c.observe(formatHlc({ ms: T + 1000, counter: 0, deviceId: 'z' }));
    expect(c.now() > formatHlc({ ms: T + 1000, counter: 0, deviceId: 'z' })).toBe(true);
    expect(c.snapshot().deviceId).toBe('dev');
    expect(maxHlc(a, b)).toBe(b);
    expect(maxHlc(undefined, b)).toBe(b);
    expect(maxHlc(a, undefined)).toBe(a);
    expect(compareHlc(a, a)).toBe(0);
    expect(compareHlc(b, a)).toBe(1);
    expect(compareHlc(a, b)).toBe(-1);
  });
});

describe('order keys', () => {
  it('generates keys between', () => {
    const [a, b] = orderKeys(2);
    const m = orderBetween(a, b);
    expect(a! < m && m < b!).toBe(true);
    expect(orderBetween(null, a) < a!).toBe(true);
    expect(orderBetween(b, b) > b!).toBe(true);
    expect(compareOrder({ order: 'a0', id: '2' }, { order: 'a0', id: '1' })).toBe(1);
    expect(compareOrder({ order: 'a0', id: '1' }, { order: 'a1', id: '1' })).toBe(-1);
    expect(compareOrder({ order: 'a0', id: '1' }, { order: 'a0', id: '1' })).toBe(0);
  });
});
