import { describe, it } from 'vitest';
import { openMemoryDriver } from '../driver/wasm';
import { REPOSITORY_SUITE } from '../test-support/repository-suite';

// The same cases run in Chromium through the worker on OPFS (e2e/).
describe('repository suite (wasm, in memory)', () => {
  for (const c of REPOSITORY_SUITE) it(c.name, () => c.run(openMemoryDriver));
});
