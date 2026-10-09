import type { Clock } from './env';

/**
 * Hybrid logical clock (SYNC.md §3).
 *
 * Serialized as `ISO-millis-counter(4 hex)-deviceId`, e.g.
 * `2026-10-09T10:15:00.000Z-0003-devA`. Every part before the device id is
 * fixed width, so comparing two serialized HLCs as plain strings gives the
 * same order as comparing `(wallMs, counter, deviceId)`. Merge code relies on
 * this and compares the strings directly.
 */
export interface Hlc {
  readonly wallMs: number;
  readonly counter: number;
  readonly deviceId: string;
}

export const HLC_MAX_COUNTER = 0xffff;
/** 9999-12-31T23:59:59.999Z, the last instant with a 4-digit ISO year. */
export const HLC_MAX_WALL_MS = 253_402_300_799_999;
const DEVICE_ID = /^[0-9A-Za-z]{1,32}$/;
const SERIALIZED =
  /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)-([0-9a-f]{4})-([0-9A-Za-z]{1,32})$/;

export class HlcError extends Error {
  override name = 'HlcError';
}

export function isValidDeviceId(deviceId: string): boolean {
  return DEVICE_ID.test(deviceId);
}

function check(h: Hlc): Hlc {
  if (!Number.isInteger(h.wallMs) || h.wallMs < 0 || h.wallMs > HLC_MAX_WALL_MS) {
    throw new HlcError(`HLC wall time out of range: ${h.wallMs}`);
  }
  if (!Number.isInteger(h.counter) || h.counter < 0 || h.counter > HLC_MAX_COUNTER) {
    throw new HlcError(`HLC counter out of range: ${h.counter}`);
  }
  if (!isValidDeviceId(h.deviceId)) {
    throw new HlcError('HLC device id must be 1–32 ASCII letters or digits');
  }
  return h;
}

export function formatHlc(h: Hlc): string {
  check(h);
  // Formatting an already-known instant; this is not calendar logic.
  const iso = new Date(h.wallMs).toISOString();
  return `${iso}-${h.counter.toString(16).padStart(4, '0')}-${h.deviceId}`;
}

export function parseHlc(value: string): Hlc {
  const m = SERIALIZED.exec(value);
  if (!m) throw new HlcError('Malformed HLC');
  // The regex has exactly three capture groups, so all three are strings.
  const [, iso, counter, deviceId] = m as unknown as [string, string, string, string];
  const wallMs = Date.parse(iso);
  // Rejects impossible dates (2026-02-30) that the regex lets through, so every
  // accepted string is canonical and round-trips byte for byte.
  if (Number.isNaN(wallMs) || new Date(wallMs).toISOString() !== iso) {
    throw new HlcError('Malformed HLC timestamp');
  }
  return { wallMs, counter: Number.parseInt(counter, 16), deviceId };
}

export function isValidHlc(value: string): boolean {
  try {
    parseHlc(value);
    return true;
  } catch {
    return false;
  }
}

/** Orders serialized HLCs. Plain code-unit comparison, never `localeCompare`. */
export function compareHlc(a: string, b: string): -1 | 0 | 1 {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function initialHlc(deviceId: string): Hlc {
  return check({ wallMs: 0, counter: 0, deviceId });
}

// When the counter would overflow, borrow the next millisecond instead. This
// keeps the 4-hex-digit width (and so string ordering) at the cost of running
// slightly ahead of physical time under >65k events per millisecond.
function normalize(wallMs: number, counter: number, deviceId: string): Hlc {
  return counter > HLC_MAX_COUNTER
    ? check({ wallMs: wallMs + 1, counter: 0, deviceId })
    : check({ wallMs, counter, deviceId });
}

/** Advances the clock for a local write. The result is always greater than `prev`. */
export function tickHlc(prev: Hlc, nowMs: number): Hlc {
  const wallMs = Math.max(prev.wallMs, Math.floor(nowMs));
  const counter = wallMs === prev.wallMs ? prev.counter + 1 : 0;
  return normalize(wallMs, counter, prev.deviceId);
}

/**
 * Advances the clock on receiving a remote HLC. The result is greater than
 * both `local` and `remote`.
 *
 * A remote clock far in the future is adopted, not rejected: rejecting it
 * would mean refusing a record, and sync must never drop data (AGENTS.md §4.3).
 */
export function receiveHlc(local: Hlc, remote: Hlc, nowMs: number): Hlc {
  const wallMs = Math.max(local.wallMs, remote.wallMs, Math.floor(nowMs));
  let counter = 0;
  if (wallMs === local.wallMs && wallMs === remote.wallMs) {
    counter = Math.max(local.counter, remote.counter) + 1;
  } else if (wallMs === local.wallMs) {
    counter = local.counter + 1;
  } else if (wallMs === remote.wallMs) {
    counter = remote.counter + 1;
  }
  return normalize(wallMs, counter, local.deviceId);
}

/**
 * One device's clock. The db layer persists {@link HlcClock.last} in
 * `sync_meta` and passes it back in on start.
 */
export class HlcClock {
  #state: Hlc;
  readonly #clock: Clock;

  constructor(deviceId: string, clock: Clock, last?: string) {
    this.#clock = clock;
    this.#state = last === undefined ? initialHlc(deviceId) : parseHlc(last);
    if (this.#state.deviceId !== deviceId) {
      throw new HlcError('Persisted HLC belongs to another device');
    }
  }

  /** A fresh HLC for a local write. */
  now(): string {
    this.#state = tickHlc(this.#state, this.#clock());
    return formatHlc(this.#state);
  }

  /** Merges a remote HLC into this clock and returns the new local HLC. */
  receive(remote: string): string {
    this.#state = receiveHlc(this.#state, parseHlc(remote), this.#clock());
    return formatHlc(this.#state);
  }

  get last(): string {
    return formatHlc(this.#state);
  }
}
