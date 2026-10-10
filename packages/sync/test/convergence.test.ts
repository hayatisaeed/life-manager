import { describe, expect, it } from 'vitest';
import { simulate } from './simulator';

// CI runs a short simulation; the nightly workflow raises these (RELEASE.md §4).
const SEEDS = Number(process.env['SIM_SEEDS'] ?? 8);
const OPS = Number(process.env['SIM_OPS'] ?? 300);
const START = Number(process.env['SIM_SEED_START'] ?? 1);

describe('convergence simulator', () => {
  for (const mode of ['github', 'gitlab'] as const) {
    it(`${SEEDS} seeds × ${OPS} ops × 5 devices converge (${mode})`, async () => {
      for (let seed = START; seed < START + SEEDS; seed++) {
        const r = await simulate({ seed, ops: OPS, mode, truncate: seed % 3 === 0 });
        if (!r.converged) {
          throw new Error(
            `seed ${seed} (${mode}) diverged:\n${r.snapshots.join('\n---\n').slice(0, 4000)}`,
          );
        }
        expect(r.records).toBeGreaterThan(0);
      }
    }, 600_000);
  }
});
