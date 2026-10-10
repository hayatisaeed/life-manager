// Opt-in contract tests against real forges (AGENTS.md §6). They need a
// throwaway private repo and a token:
//   LM_TEST_GITHUB_TOKEN, LM_TEST_GITHUB_REPO=owner/name
//   LM_TEST_GITLAB_TOKEN, LM_TEST_GITLAB_PROJECT=group/name [LM_TEST_GITLAB_URL]
// Never point these at a real data repo: the tests write files.

import { describe, expect, it } from 'vitest';
import { fetchHttpClient } from '@lm/platform';
import type { SyncTransport } from '../src';
import { GitHubTransport, GitLabTransport } from '../src';

const env = process.env;

function contract(name: string, make: () => SyncTransport) {
  describe(`${name} contract`, () => {
    it('round-trips a commit and enforces CAS', async () => {
      const t = make();
      const access = await t.checkAccess();
      expect(access.private).toBe(true);
      expect(access.canWrite).toBe(true);
      let head = await t.getHead();
      if (head === null) {
        const first = await t.commit(null, [
          { action: 'upsert', path: 'lm.json', content: '{"test":true}\n', exists: false },
        ]);
        expect(first).not.toBe('conflict');
        head = await t.getHead();
      }
      const path = `r/00/00/${'0'.repeat(60)}${Date.now().toString(16).slice(-4)}.lmr`;
      const res = await t.commit(head, [
        { action: 'upsert', path, content: 'LMR1.contract', exists: false },
      ]);
      if (res === 'conflict') throw new Error('unexpected conflict');
      const tree = await t.listTreeRecursive(res.sha);
      expect(tree === 'truncated' || tree.some((e) => e.path === path)).toBe(true);
      const files = await t.readFiles(res.sha, [
        { path, sha: tree === 'truncated' ? '' : tree.find((e) => e.path === path)!.sha },
      ]);
      expect(new TextDecoder().decode(files.get(path)!.bytes)).toBe('LMR1.contract');
      // A stale parent must be rejected (GitHub: ref CAS; GitLab: create on an existing path).
      const stale = await t.commit(head, [
        { action: 'upsert', path, content: 'LMR1.stale', exists: false },
      ]);
      expect(stale).toBe('conflict');
      const cleanup = await t.commit(res.sha, [
        { action: 'delete', path, meta: res.meta?.[path] ?? null },
      ]);
      expect(cleanup).not.toBe('conflict');
    }, 60_000);
  });
}

const gh = env['LM_TEST_GITHUB_REPO']?.split('/');
if (env['LM_TEST_GITHUB_TOKEN'] && gh?.length === 2) {
  contract(
    'GitHub',
    () =>
      new GitHubTransport(fetchHttpClient(), {
        owner: gh[0]!,
        repo: gh[1]!,
        token: env['LM_TEST_GITHUB_TOKEN']!,
      }),
  );
}
if (env['LM_TEST_GITLAB_TOKEN'] && env['LM_TEST_GITLAB_PROJECT']) {
  contract(
    'GitLab',
    () =>
      new GitLabTransport(fetchHttpClient(), {
        project: env['LM_TEST_GITLAB_PROJECT']!,
        token: env['LM_TEST_GITLAB_TOKEN']!,
        ...(env['LM_TEST_GITLAB_URL'] ? { baseUrl: env['LM_TEST_GITLAB_URL'] } : {}),
      }),
  );
}
describe('contract tests', () => {
  it('are skipped unless LM_TEST_* env vars are set', () => {
    expect(true).toBe(true);
  });
});
