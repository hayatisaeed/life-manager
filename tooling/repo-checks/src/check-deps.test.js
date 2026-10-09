import { describe, expect, it } from 'vitest';
import { checkDeps } from './check-deps.js';

describe('checkDeps', () => {
  it('accepts allowed edges', () => {
    expect(
      checkDeps([
        {
          name: '@lm/sync',
          dependencies: { '@lm/core': 'workspace:*', '@lm/crypto': 'workspace:*' },
        },
        { name: '@lm/core', dependencies: { zod: '^4.0.0' } },
      ]),
    ).toEqual([]);
  });

  it('rejects upward edges', () => {
    expect(checkDeps([{ name: '@lm/core', dependencies: { '@lm/ui': 'workspace:*' } }])).toEqual([
      '@lm/core must not depend on @lm/ui (see docs/ARCHITECTURE.md §3)',
    ]);
  });

  it('checks dev and peer dependencies too', () => {
    expect(
      checkDeps([{ name: '@lm/crypto', devDependencies: { '@lm/platform': 'workspace:*' } }]),
    ).toHaveLength(1);
  });

  it('allows tooling packages everywhere', () => {
    expect(
      checkDeps([{ name: '@lm/core', devDependencies: { '@lm/eslint-plugin': 'workspace:*' } }]),
    ).toEqual([]);
  });

  it('flags unknown packages', () => {
    expect(checkDeps([{ name: '@lm/mystery' }])[0]).toMatch(/not listed in ALLOWED/);
  });
});
