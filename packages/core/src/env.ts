/**
 * Milliseconds since the Unix epoch. Injected so `core` stays deterministic
 * (AGENTS.md §4.9); platform code passes `Date.now`.
 */
export type Clock = () => number;

/**
 * A uniform number in [0, 1). Injected for the same reason as {@link Clock};
 * platform code passes a CSPRNG-backed source, tests pass a seeded one.
 */
export type RandomSource = () => number;
