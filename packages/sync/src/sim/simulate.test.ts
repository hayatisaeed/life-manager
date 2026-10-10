import { describe, expect, it } from 'vitest';
import { simulate } from './simulate';

// The CI run is short. The nightly workflow sets SIM_SEEDS / SIM_OPS for the
// long run (ROADMAP P0.6 AC: 1,000 seeds).
declare const process: { env: Record<string, string | undefined> };
const SEEDS = Number(process.env['SIM_SEEDS'] ?? 6);
const OPS = Number(process.env['SIM_OPS'] ?? 300);
const FIRST = Number(process.env['SIM_FIRST_SEED'] ?? 1);

describe(`convergence simulator: 5 devices × ${String(OPS)} ops`, () => {
  let races = 0;
  for (let seed = FIRST; seed < FIRST + SEEDS; seed++) {
    it(`seed ${String(seed)} converges and loses nothing`, async () => {
      const report = await simulate({ seed, devices: 5, ops: OPS });
      expect(report.problems).toEqual([]);
      expect(report.records).toBeGreaterThan(0);
      races += report.casRejections;
    });
  }
  it('actually exercised compare-and-swap races', () => {
    expect(races).toBeGreaterThan(0);
  });
});
