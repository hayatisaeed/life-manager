// Hybrid Logical Clock, SYNC.md §3. Format: `ISO-millis-counter(4 hex)-deviceId`.
// Strings sort lexicographically in causal/time order as long as the ISO part
// has a fixed width (years 0000–9999), which `toISOString` guarantees for our range.

export type Hlc = string;

export interface HlcState {
  ms: number;
  counter: number;
  deviceId: string;
}

const MAX_COUNTER = 0xffff;
/** Reject remote clocks this far ahead of our wall clock (protects against a broken device clock). */
export const MAX_DRIFT_MS = 24 * 60 * 60 * 1000;

const HLC_RE = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)-([0-9a-f]{4})-(.+)$/;

export function formatHlc(s: HlcState): Hlc {
  return `${new Date(s.ms).toISOString()}-${s.counter.toString(16).padStart(4, '0')}-${s.deviceId}`;
}

export function parseHlc(h: Hlc): HlcState {
  const m = HLC_RE.exec(h);
  if (!m) throw new RangeError(`Invalid HLC: ${h}`);
  return {
    ms: Date.parse(m[1] as string),
    counter: parseInt(m[2] as string, 16),
    deviceId: m[3] as string,
  };
}

export function isHlc(h: unknown): h is Hlc {
  return typeof h === 'string' && HLC_RE.test(h);
}

export function initialHlc(deviceId: string): HlcState {
  if (!/^[A-Za-z0-9_]+$/.test(deviceId)) throw new RangeError('deviceId must be [A-Za-z0-9_]+');
  return { ms: 0, counter: 0, deviceId };
}

/** Advance for a local event. */
export function tick(state: HlcState, wallMs: number): HlcState {
  if (wallMs > state.ms) return { ...state, ms: wallMs, counter: 0 };
  if (state.counter >= MAX_COUNTER) return { ...state, ms: state.ms + 1, counter: 0 };
  return { ...state, counter: state.counter + 1 };
}

/** Merge a remote clock so our next local event sorts after it. */
export function receive(state: HlcState, remote: Hlc, wallMs: number): HlcState {
  const r = parseHlc(remote);
  if (r.ms - wallMs > MAX_DRIFT_MS) {
    // Ignore absurd clocks instead of poisoning ours; their records still merge by HLC.
    return tick(state, wallMs);
  }
  const ms = Math.max(state.ms, r.ms, wallMs);
  let counter: number;
  if (ms === state.ms && ms === r.ms) counter = Math.max(state.counter, r.counter) + 1;
  else if (ms === state.ms) counter = state.counter + 1;
  else if (ms === r.ms) counter = r.counter + 1;
  else counter = 0;
  if (counter > MAX_COUNTER) return { ...state, ms: ms + 1, counter: 0 };
  return { ...state, ms, counter };
}

export function compareHlc(a: Hlc, b: Hlc): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function maxHlc(a: Hlc | undefined, b: Hlc | undefined): Hlc | undefined {
  if (a === undefined) return b;
  if (b === undefined) return a;
  return a >= b ? a : b;
}

/** A small stateful clock wrapper used by repositories. */
export class HlcClock {
  constructor(
    private state: HlcState,
    private readonly wall: () => number,
  ) {}
  now(): Hlc {
    this.state = tick(this.state, this.wall());
    return formatHlc(this.state);
  }
  observe(remote: Hlc): void {
    this.state = receive(this.state, remote, this.wall());
  }
  snapshot(): HlcState {
    return { ...this.state };
  }
}
