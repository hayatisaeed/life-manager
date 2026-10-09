import type { Clock } from '../env';

// Hybrid logical clock (Kulkarni et al., "Logical Physical Clocks", 2014).
// Wire format, from docs/SYNC.md §3: `ISO-millis-counter(4 hex)-deviceId`,
// e.g. `2026-10-09T10:15:00.000Z-0003-devA`. The ISO part and the counter are
// fixed width, so plain string comparison orders HLCs by (time, counter,
// deviceId). That gives the tie-break SYNC.md §6 asks for: equal times go to
// the lexicographically larger deviceId.

/** An HLC in its string form. Compare with `compareHlc` or `<`, never `localeCompare`. */
export type Hlc = string;

export interface HlcParts {
  /** Milliseconds since the Unix epoch. */
  readonly wallMs: number;
  /** Logical counter for events within the same millisecond, 0…0xffff. */
  readonly counter: number;
  readonly deviceId: string;
}

/** The part of the clock a device persists between sessions (`sync_meta`). */
export interface HlcState {
  readonly wallMs: number;
  readonly counter: number;
}

export const MAX_COUNTER = 0xffff;
// 9999-12-31T23:59:59.999Z: the last instant whose ISO form is still 24
// characters, which the fixed-width format depends on.
export const MAX_WALL_MS = 253_402_300_799_999;

const DEVICE_ID = /^[0-9A-Za-z_-]{1,64}$/;
const HLC = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)-([0-9a-f]{4})-([0-9A-Za-z_-]{1,64})$/;

export class HlcError extends Error {
  override name = 'HlcError';
}

function checkDeviceId(deviceId: string): void {
  if (!DEVICE_ID.test(deviceId)) {
    throw new HlcError('Device id must be 1–64 characters of [0-9A-Za-z_-]');
  }
}

function checkWallMs(wallMs: number): void {
  if (!Number.isSafeInteger(wallMs) || wallMs < 0 || wallMs > MAX_WALL_MS) {
    throw new HlcError(`HLC time out of range: ${String(wallMs)}`);
  }
}

function checkCounter(counter: number): void {
  if (!Number.isInteger(counter) || counter < 0 || counter > MAX_COUNTER) {
    throw new HlcError(`HLC counter out of range: ${String(counter)}`);
  }
}

export function formatHlc({ wallMs, counter, deviceId }: HlcParts): Hlc {
  checkWallMs(wallMs);
  checkCounter(counter);
  checkDeviceId(deviceId);
  const iso = new Date(wallMs).toISOString();
  return `${iso}-${counter.toString(16).padStart(4, '0')}-${deviceId}`;
}

export function parseHlc(hlc: string): HlcParts {
  const match = HLC.exec(hlc);
  const [, iso, counterHex, deviceId] = match ?? [];
  if (iso === undefined || counterHex === undefined || deviceId === undefined) {
    throw new HlcError('Malformed HLC');
  }
  const wallMs = Date.parse(iso);
  // Date.parse accepts impossible dates such as Feb 30 by rolling them over;
  // reject anything that doesn't round-trip so every HLC has one spelling.
  if (Number.isNaN(wallMs) || new Date(wallMs).toISOString() !== iso) {
    throw new HlcError('Malformed HLC');
  }
  return { wallMs, counter: Number.parseInt(counterHex, 16), deviceId };
}

export function isHlc(value: string): value is Hlc {
  try {
    parseHlc(value);
    return true;
  } catch {
    return false;
  }
}

export function compareHlc(a: Hlc, b: Hlc): -1 | 0 | 1 {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * One device's HLC. Call `now()` for every local write and `receive()` for
 * every HLC read from a remote record (SYNC.md §3). Persist `state()` so the
 * clock never goes backwards across restarts.
 */
export class HybridLogicalClock {
  private wallMs: number;
  private counter: number;

  constructor(
    readonly deviceId: string,
    private readonly clock: Clock,
    state: HlcState = { wallMs: 0, counter: 0 },
  ) {
    checkDeviceId(deviceId);
    checkWallMs(state.wallMs);
    checkCounter(state.counter);
    this.wallMs = state.wallMs;
    this.counter = state.counter;
  }

  state(): HlcState {
    return { wallMs: this.wallMs, counter: this.counter };
  }

  /** Returns a timestamp greater than every HLC this clock has issued or received. */
  now(): Hlc {
    const physical = this.physical();
    if (physical > this.wallMs) {
      this.wallMs = physical;
      this.counter = 0;
    } else {
      this.tick();
    }
    return this.format();
  }

  /**
   * Merges a remote HLC into this clock and returns a local timestamp greater
   * than both. Throws `HlcError` if `remote` is malformed.
   */
  receive(remote: Hlc): Hlc {
    const r = parseHlc(remote);
    const physical = this.physical();
    const wallMs = Math.max(this.wallMs, r.wallMs, physical);
    if (wallMs === this.wallMs && wallMs === r.wallMs) {
      this.counter = Math.max(this.counter, r.counter);
      this.tick();
    } else if (wallMs === this.wallMs) {
      this.tick();
    } else if (wallMs === r.wallMs) {
      this.wallMs = wallMs;
      this.counter = r.counter;
      this.tick();
    } else {
      this.wallMs = wallMs;
      this.counter = 0;
    }
    return this.format();
  }

  private physical(): number {
    const ms = this.clock();
    checkWallMs(ms);
    return ms;
  }

  private tick(): void {
    // The counter is 4 hex digits. On overflow, borrow the next millisecond
    // rather than fail a write: the clock runs at most 1 ms ahead, and the
    // physical clock catches up within a millisecond.
    if (this.counter >= MAX_COUNTER) {
      checkWallMs(this.wallMs + 1);
      this.wallMs += 1;
      this.counter = 0;
    } else {
      this.counter += 1;
    }
  }

  private format(): Hlc {
    return formatHlc({ wallMs: this.wallMs, counter: this.counter, deviceId: this.deviceId });
  }
}
