// Time and randomness are injected so `core` stays pure and its tests are
// deterministic (AGENTS.md §4.9). Platforms supply real implementations.

/** Returns the current time as milliseconds since the Unix epoch (UTC). */
export type Clock = () => number;

/**
 * Returns a uniformly distributed number in [0, 1). Platforms back this with
 * `crypto.getRandomValues`, never `Math.random`.
 */
export type Rng = () => number;
