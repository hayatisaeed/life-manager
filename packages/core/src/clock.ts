/** Hybrid logical clocks; SYNC.md §3. Clock and device identity are injected. */
export interface ClockState {
  millis: number;
  counter: number;
  deviceId: string;
}
const MAX_TIME = 253402300799999;
const HLC = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)-([0-9a-f]{4})-([A-Za-z0-9_]+)$/;
export function validateState(state: ClockState): ClockState {
  if (
    !Number.isSafeInteger(state.millis) ||
    state.millis < 0 ||
    state.millis > MAX_TIME ||
    !Number.isInteger(state.counter) ||
    state.counter < 0 ||
    state.counter > 65535 ||
    !/^[A-Za-z0-9_]+$/.test(state.deviceId)
  )
    throw new Error('Invalid HLC state');
  return state;
}
export function formatHlc(state: ClockState): string {
  validateState(state);
  return `${new Date(state.millis).toISOString()}-${state.counter.toString(16).padStart(4, '0')}-${state.deviceId}`;
}
export function parseHlc(value: string): ClockState {
  const match = HLC.exec(value);
  if (!match) throw new Error('Invalid HLC');
  const iso = match[1] ?? '';
  const state = validateState({
    millis: Date.parse(iso),
    counter: parseInt(match[2] ?? '', 16),
    deviceId: match[3] ?? '',
  });
  if (new Date(state.millis).toISOString() !== iso) throw new Error('Invalid HLC timestamp');
  return state;
}
export function compareHlc(a: string, b: string): number {
  parseHlc(a);
  parseHlc(b);
  return a < b ? -1 : a > b ? 1 : 0;
}
export function tickHlc(local: ClockState, now: number, remote?: ClockState): ClockState {
  validateState(local);
  validateState({ millis: now, counter: 0, deviceId: local.deviceId });
  if (remote) validateState(remote);
  let millis = Math.max(now, local.millis, remote?.millis ?? 0);
  let counter =
    millis === local.millis && millis === remote?.millis
      ? Math.max(local.counter, remote.counter) + 1
      : millis === local.millis
        ? local.counter + 1
        : millis === remote?.millis
          ? remote.counter + 1
          : 0;
  // Carry instead of wrapping, which would move the logical clock backwards.
  if (counter > 65535) {
    millis += 1;
    counter = 0;
  }
  return validateState({ millis, counter, deviceId: local.deviceId });
}
