import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  compareHlc,
  formatHlc,
  HlcError,
  HybridLogicalClock,
  isHlc,
  MAX_COUNTER,
  MAX_WALL_MS,
  parseHlc,
} from './hlc';

const T0 = Date.UTC(2026, 9, 9, 10, 15); // 2026-10-09T10:15:00.000Z

/** A clock the test moves by hand. */
function manualClock(start = T0) {
  let now = start;
  const clock = () => now;
  return Object.assign(clock, {
    set: (ms: number) => {
      now = ms;
    },
  });
}

const deviceIdArb = fc.stringMatching(/^[0-9A-Za-z_-]{1,64}$/);
const wallArb = fc.integer({ min: 0, max: MAX_WALL_MS });
const partsArb = fc.record({
  wallMs: wallArb,
  counter: fc.integer({ min: 0, max: MAX_COUNTER }),
  deviceId: deviceIdArb,
});

describe('format and parse', () => {
  it('matches the SYNC.md example', () => {
    expect(formatHlc({ wallMs: T0, counter: 3, deviceId: 'devA' })).toBe(
      '2026-10-09T10:15:00.000Z-0003-devA',
    );
    expect(parseHlc('2026-10-09T10:15:00.000Z-0003-devA')).toEqual({
      wallMs: T0,
      counter: 3,
      deviceId: 'devA',
    });
  });

  it('round-trips', () => {
    fc.assert(
      fc.property(partsArb, (p) => {
        expect(parseHlc(formatHlc(p))).toEqual(p);
      }),
    );
  });

  it('string order equals (time, counter, deviceId) order', () => {
    const tuple = (a: { wallMs: number; counter: number; deviceId: string }) =>
      [a.wallMs, a.counter, a.deviceId] as const;
    fc.assert(
      fc.property(partsArb, partsArb, (a, b) => {
        const [aw, ac, ad] = tuple(a);
        const [bw, bc, bd] = tuple(b);
        const expected =
          aw !== bw
            ? Math.sign(aw - bw)
            : ac !== bc
              ? Math.sign(ac - bc)
              : ad < bd
                ? -1
                : ad > bd
                  ? 1
                  : 0;
        expect(compareHlc(formatHlc(a), formatHlc(b))).toBe(expected);
      }),
    );
  });

  it.each([
    '',
    'nope',
    '2026-10-09T10:15:00.000Z-0003-',
    '2026-10-09T10:15:00.000Z-03-devA',
    '2026-10-09T10:15:00.000Z-000G-devA',
    '2026-10-09T10:15:00.000Z-0003-dev A',
    '2026-10-09T10:15:00Z-0003-devA',
    '2026-02-30T10:15:00.000Z-0003-devA',
    '2026-13-01T10:15:00.000Z-0003-devA',
    `2026-10-09T10:15:00.000Z-0003-${'x'.repeat(65)}`,
  ])('rejects %j', (bad) => {
    expect(() => parseHlc(bad)).toThrow(HlcError);
    expect(isHlc(bad)).toBe(false);
  });

  it('compares equal HLCs as 0', () => {
    expect(
      compareHlc('2026-10-09T10:15:00.000Z-0003-devA', '2026-10-09T10:15:00.000Z-0003-devA'),
    ).toBe(0);
  });

  it('accepts valid strings in isHlc', () => {
    expect(isHlc('2026-10-09T10:15:00.000Z-ffff-a_b-C')).toBe(true);
  });

  it.each([
    { wallMs: -1, counter: 0, deviceId: 'd' },
    { wallMs: MAX_WALL_MS + 1, counter: 0, deviceId: 'd' },
    { wallMs: 1.5, counter: 0, deviceId: 'd' },
    { wallMs: 0, counter: -1, deviceId: 'd' },
    { wallMs: 0, counter: MAX_COUNTER + 1, deviceId: 'd' },
    { wallMs: 0, counter: 0.5, deviceId: 'd' },
    { wallMs: 0, counter: 0, deviceId: '' },
    { wallMs: 0, counter: 0, deviceId: 'a.b' },
  ])('formatHlc rejects %j', (parts) => {
    expect(() => formatHlc(parts)).toThrow(HlcError);
  });
});

describe('HybridLogicalClock', () => {
  it('uses physical time when it moves forward', () => {
    const clock = manualClock();
    const hlc = new HybridLogicalClock('devA', clock);
    expect(hlc.now()).toBe('2026-10-09T10:15:00.000Z-0000-devA');
    expect(hlc.now()).toBe('2026-10-09T10:15:00.000Z-0001-devA');
    clock.set(T0 + 5);
    expect(hlc.now()).toBe('2026-10-09T10:15:00.005Z-0000-devA');
  });

  it('keeps increasing when the physical clock goes backwards', () => {
    const clock = manualClock();
    const hlc = new HybridLogicalClock('devA', clock);
    const a = hlc.now();
    clock.set(T0 - 60_000);
    const b = hlc.now();
    expect(b > a).toBe(true);
    expect(parseHlc(b).wallMs).toBe(T0);
  });

  it('borrows the next millisecond when the counter overflows', () => {
    const clock = manualClock();
    const hlc = new HybridLogicalClock('devA', clock, { wallMs: T0, counter: MAX_COUNTER });
    expect(hlc.now()).toBe('2026-10-09T10:15:00.001Z-0000-devA');
  });

  it('fails instead of wrapping past year 9999', () => {
    const clock = manualClock(MAX_WALL_MS);
    const hlc = new HybridLogicalClock('devA', clock, {
      wallMs: MAX_WALL_MS,
      counter: MAX_COUNTER,
    });
    expect(() => hlc.now()).toThrow(HlcError);
  });

  it('rejects a broken physical clock', () => {
    const hlc = new HybridLogicalClock('devA', () => Number.NaN);
    expect(() => hlc.now()).toThrow(HlcError);
  });

  it('validates its constructor arguments', () => {
    expect(() => new HybridLogicalClock('', manualClock())).toThrow(HlcError);
    expect(() => new HybridLogicalClock('d', manualClock(), { wallMs: -1, counter: 0 })).toThrow(
      HlcError,
    );
    expect(() => new HybridLogicalClock('d', manualClock(), { wallMs: 0, counter: -1 })).toThrow(
      HlcError,
    );
  });

  it('resumes from persisted state without going backwards', () => {
    const clock = manualClock();
    const first = new HybridLogicalClock('devA', clock);
    first.now();
    const last = first.now();
    const resumed = new HybridLogicalClock('devA', clock, first.state());
    expect(resumed.now() > last).toBe(true);
  });

  describe('receive', () => {
    it('jumps to a remote time that is ahead', () => {
      const hlc = new HybridLogicalClock('devA', manualClock());
      expect(hlc.receive('2026-10-09T10:20:00.000Z-0007-devB')).toBe(
        '2026-10-09T10:20:00.000Z-0008-devA',
      );
    });

    it('keeps local time when it is ahead of the remote and physical time', () => {
      const clock = manualClock();
      const hlc = new HybridLogicalClock('devA', clock, { wallMs: T0 + 1000, counter: 4 });
      expect(hlc.receive('2026-10-09T10:15:00.000Z-0009-devB')).toBe(
        '2026-10-09T10:15:01.000Z-0005-devA',
      );
    });

    it('takes the larger counter when local and remote times are equal', () => {
      const clock = manualClock(T0 - 1);
      const hlc = new HybridLogicalClock('devA', clock, { wallMs: T0, counter: 2 });
      expect(hlc.receive('2026-10-09T10:15:00.000Z-0009-devB')).toBe(
        '2026-10-09T10:15:00.000Z-000a-devA',
      );
    });

    it('uses physical time when it is ahead of both', () => {
      const clock = manualClock(T0 + 1);
      const hlc = new HybridLogicalClock('devA', clock, { wallMs: T0, counter: 2 });
      expect(hlc.receive('2026-10-09T10:15:00.000Z-0009-devB')).toBe(
        '2026-10-09T10:15:00.001Z-0000-devA',
      );
    });

    it('rejects a malformed remote HLC without changing state', () => {
      const hlc = new HybridLogicalClock('devA', manualClock());
      const before = hlc.state();
      expect(() => hlc.receive('garbage')).toThrow(HlcError);
      expect(hlc.state()).toEqual(before);
    });
  });

  // SYNC.md §3: the clock advances on every local write and every remote
  // receive, so each timestamp it returns must exceed everything it has seen.
  it('is strictly monotonic and dominates received HLCs under any clock behaviour', () => {
    const op = fc.oneof(
      fc.record({
        kind: fc.constant('now' as const),
        jump: fc.integer({ min: -10_000, max: 10_000 }),
      }),
      fc.record({
        kind: fc.constant('receive' as const),
        jump: fc.integer({ min: -10_000, max: 10_000 }),
        remote: fc.record({
          offset: fc.integer({ min: -100_000, max: 100_000 }),
          counter: fc.integer({ min: 0, max: MAX_COUNTER }),
          deviceId: deviceIdArb,
        }),
      }),
    );
    fc.assert(
      fc.property(fc.array(op, { maxLength: 200 }), (ops) => {
        const clock = manualClock();
        const hlc = new HybridLogicalClock('local', clock);
        let physical = T0;
        let last = '';
        for (const o of ops) {
          physical = Math.max(0, physical + o.jump);
          clock.set(physical);
          let next: string;
          if (o.kind === 'now') {
            next = hlc.now();
          } else {
            const remote = formatHlc({
              wallMs: Math.max(0, physical + o.remote.offset),
              counter: o.remote.counter,
              deviceId: o.remote.deviceId,
            });
            next = hlc.receive(remote);
            expect(next > remote).toBe(true);
          }
          expect(next > last).toBe(true);
          // Never behind the physical clock.
          expect(parseHlc(next).wallMs).toBeGreaterThanOrEqual(physical);
          last = next;
        }
      }),
    );
  });
});
