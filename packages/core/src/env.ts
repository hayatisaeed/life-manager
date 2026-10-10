// Injected capabilities for deterministic domain code (AGENTS.md §4.9).

export interface Env {
  /** Epoch milliseconds. */
  now(): number;
  /** `n` cryptographically random bytes (tests may inject a seeded PRNG). */
  random(n: number): Uint8Array;
}

/** A deterministic Env for tests: a settable clock and a seeded xorshift PRNG. */
export function testEnv(
  startMs = Date.UTC(2026, 9, 9, 10, 0, 0),
  seed = 1,
): Env & {
  advance(ms: number): void;
  set(ms: number): void;
} {
  let t = startMs;
  let s = seed >>> 0 || 1;
  const next = (): number => {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s;
  };
  return {
    now: () => t,
    random: (n) => {
      const out = new Uint8Array(n);
      for (let i = 0; i < n; i++) out[i] = next() & 255;
      return out;
    },
    advance(ms) {
      t += ms;
    },
    set(ms) {
      t = ms;
    },
  };
}
