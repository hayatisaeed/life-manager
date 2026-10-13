import { monotonicFactory, encodeTime } from 'ulid';
import { generateKeyBetween } from 'fractional-indexing';
export { generateKeyBetween as orderBetween };
/** No ambient time or randomness enters the domain core. */
export function createIdGenerator(random: () => number): (millis: number) => string {
  const generate = monotonicFactory(() => {
    const value = random();
    if (!Number.isFinite(value) || value < 0 || value >= 1)
      throw new Error('Invalid random sample');
    return value;
  });
  let highWater = 0;
  return (millis) => {
    if (!Number.isSafeInteger(millis) || millis < 0 || millis > 281474976710655)
      throw new Error('Invalid ULID time');
    highWater = Math.max(highWater, millis);
    // ulid treats seed 0 as ambient time. Override its timestamp while keeping
    // its tested random incrementer, so Unix epoch is deterministic too.
    return encodeTime(highWater, 10) + generate(Math.max(1, highWater)).slice(10);
  };
}
