import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  HLC_MAX_COUNTER,
  HLC_MAX_WALL_MS,
  HlcClock,
  HlcError,
  compareHlc,
  formatHlc,
  initialHlc,
  isValidDeviceId,
  isValidHlc,
  parseHlc,
  receiveHlc,
  tickHlc,
  type Hlc,
} from './hlc';

const deviceId = fc.stringMatching(/^[0-9A-Za-z]{1,32}$/);
const hlc: fc.Arbitrary<Hlc> = fc.record({
  wallMs: fc.integer({ min: 0, max: HLC_MAX_WALL_MS - 10 }),
  counter: fc.integer({ min: 0, max: HLC_MAX_COUNTER }),
  deviceId,
});
// Clocks that jump around, including backwards and near-equal readings.
const now = fc.oneof(
  fc.integer({ min: 0, max: HLC_MAX_WALL_MS - 10 }),
  fc.integer({ min: 0, max: 50 }),
);

const tuple = (h: Hlc): [number, number, string] => [h.wallMs, h.counter, h.deviceId];
function compareTuple(a: Hlc, b: Hlc): number {
  if (a.wallMs !== b.wallMs) return Math.sign(a.wallMs - b.wallMs);
  if (a.counter !== b.counter) return Math.sign(a.counter - b.counter);
  return a.deviceId < b.deviceId ? -1 : a.deviceId > b.deviceId ? 1 : 0;
}

describe('HLC serialization', () => {
  it('matches the SYNC.md §3 example', () => {
    const h = parseHlc('2026-10-09T10:15:00.000Z-0003-devA');
    expect(h).toEqual({ wallMs: Date.UTC(2026, 9, 9, 10, 15), counter: 3, deviceId: 'devA' });
    expect(formatHlc(h)).toBe('2026-10-09T10:15:00.000Z-0003-devA');
  });

  it('compares equal HLCs as equal', () => {
    expect(
      compareHlc('2026-10-09T10:15:00.000Z-0003-devA', '2026-10-09T10:15:00.000Z-0003-devA'),
    ).toBe(0);
  });

  it('round-trips', () => {
    fc.assert(
      fc.property(hlc, (h) => {
        expect(tuple(parseHlc(formatHlc(h)))).toEqual(tuple(h));
      }),
    );
  });

  it('sorts as strings exactly like (wallMs, counter, deviceId)', () => {
    fc.assert(
      fc.property(hlc, hlc, (a, b) => {
        expect(compareHlc(formatHlc(a), formatHlc(b))).toBe(compareTuple(a, b));
      }),
    );
  });

  it.each([
    '',
    '2026-10-09T10:15:00.000Z-0003',
    '2026-10-09T10:15:00.000Z-0003-',
    '2026-10-09T10:15:00.000Z-00003-devA',
    '2026-10-09T10:15:00.000Z-000A-devA', // uppercase hex is not canonical
    '2026-10-09T10:15:00Z-0003-devA',
    '2026-02-30T10:15:00.000Z-0003-devA',
    '2026-10-09T10:15:00.000Z-0003-dev-A',
    `2026-10-09T10:15:00.000Z-0003-${'a'.repeat(33)}`,
  ])('rejects %j', (s) => {
    expect(isValidHlc(s)).toBe(false);
    expect(() => parseHlc(s)).toThrow(HlcError);
  });

  it('refuses to format out-of-range values', () => {
    expect(() => formatHlc({ wallMs: -1, counter: 0, deviceId: 'a' })).toThrow(HlcError);
    expect(() => formatHlc({ wallMs: HLC_MAX_WALL_MS + 1, counter: 0, deviceId: 'a' })).toThrow(
      HlcError,
    );
    expect(() => formatHlc({ wallMs: 1.5, counter: 0, deviceId: 'a' })).toThrow(HlcError);
    expect(() => formatHlc({ wallMs: 0, counter: HLC_MAX_COUNTER + 1, deviceId: 'a' })).toThrow(
      HlcError,
    );
    expect(() => formatHlc({ wallMs: 0, counter: -1, deviceId: 'a' })).toThrow(HlcError);
    expect(() => initialHlc('dev-A')).toThrow(HlcError);
    expect(isValidDeviceId('01J9ZZZZZZZZZZZZZZZZZZZZZZ')).toBe(true);
  });
});

describe('tickHlc', () => {
  it('is strictly monotonic whatever the physical clock does', () => {
    fc.assert(
      fc.property(hlc, fc.array(now, { maxLength: 50 }), (start, nows) => {
        let prev = start;
        for (const n of nows) {
          const next = tickHlc(prev, n);
          expect(compareTuple(next, prev)).toBe(1);
          expect(next.wallMs).toBeGreaterThanOrEqual(n);
          prev = next;
        }
      }),
    );
  });

  it('resets the counter when physical time moves ahead', () => {
    expect(tickHlc({ wallMs: 10, counter: 7, deviceId: 'a' }, 20)).toEqual({
      wallMs: 20,
      counter: 0,
      deviceId: 'a',
    });
    expect(tickHlc({ wallMs: 10, counter: 7, deviceId: 'a' }, 5)).toEqual({
      wallMs: 10,
      counter: 8,
      deviceId: 'a',
    });
  });

  it('borrows the next millisecond when the counter overflows', () => {
    expect(tickHlc({ wallMs: 10, counter: HLC_MAX_COUNTER, deviceId: 'a' }, 10)).toEqual({
      wallMs: 11,
      counter: 0,
      deviceId: 'a',
    });
  });
});

describe('receiveHlc', () => {
  it('produces a clock above both the local and the remote one', () => {
    fc.assert(
      fc.property(hlc, hlc, now, (local, remote, n) => {
        const next = receiveHlc(local, remote, n);
        expect(next.deviceId).toBe(local.deviceId);
        expect(compareTuple(next, local)).toBe(1);
        // Device ids differ, so compare only the time part against the remote.
        expect(compareTuple({ ...next, deviceId: '' }, { ...remote, deviceId: '' })).toBe(1);
        expect(next.wallMs).toBeGreaterThanOrEqual(n);
      }),
    );
  });

  it('covers each counter branch', () => {
    const l = { wallMs: 10, counter: 2, deviceId: 'l' };
    expect(receiveHlc(l, { wallMs: 10, counter: 5, deviceId: 'r' }, 0)).toMatchObject({
      wallMs: 10,
      counter: 6,
    });
    expect(receiveHlc(l, { wallMs: 9, counter: 5, deviceId: 'r' }, 0)).toMatchObject({
      wallMs: 10,
      counter: 3,
    });
    expect(receiveHlc(l, { wallMs: 12, counter: 5, deviceId: 'r' }, 0)).toMatchObject({
      wallMs: 12,
      counter: 6,
    });
    expect(receiveHlc(l, { wallMs: 12, counter: 5, deviceId: 'r' }, 20)).toMatchObject({
      wallMs: 20,
      counter: 0,
    });
  });

  it('adopts a remote clock from the far future instead of rejecting it', () => {
    const future = { wallMs: HLC_MAX_WALL_MS - 1, counter: 0, deviceId: 'r' };
    expect(receiveHlc(initialHlc('l'), future, 1_000).wallMs).toBe(HLC_MAX_WALL_MS - 1);
  });
});

describe('HlcClock', () => {
  it('issues increasing HLCs and resumes from a persisted value', () => {
    let t = 1_000;
    const clock = new HlcClock('devA', () => t);
    const a = clock.now();
    const b = clock.now();
    t = 900; // clock stepped back
    const c = clock.now();
    expect([a, b, c]).toEqual([...[a, b, c]].sort());
    expect(new Set([a, b, c]).size).toBe(3);

    const resumed = new HlcClock('devA', () => 0, clock.last);
    expect(compareHlc(resumed.now(), c)).toBe(1);
  });

  it('moves past a received remote HLC', () => {
    const clock = new HlcClock('devA', () => 1_000);
    const remote = '2030-01-01T00:00:00.000Z-0009-devB';
    const merged = clock.receive(remote);
    expect(compareHlc(merged, remote)).toBe(1);
    expect(compareHlc(clock.now(), merged)).toBe(1);
  });

  it('refuses a persisted HLC from another device', () => {
    expect(() => new HlcClock('devA', () => 0, '2026-10-09T10:15:00.000Z-0003-devB')).toThrow(
      HlcError,
    );
  });
});
