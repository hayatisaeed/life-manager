import { afterAll, describe } from 'vitest';
import { FakeForge } from './fake-forge';
import { GitHubTransport } from './github';
import { GitLabTransport } from './gitlab';
import { GitHubEmulator } from './test-support/github-emulator';
import { GitLabEmulator } from './test-support/gitlab-emulator';
import { transportContract } from './test-support/transport-contract';

// Every transport runs the same contract (SYNC.md §7). The real-forge runs
// are opt-in (AGENTS.md §6): set LM_TEST_GITHUB_TOKEN + LM_TEST_GITHUB_REPO
// (owner/name, a private scratch repo with at least one commit; optional
// LM_TEST_GITHUB_API), or LM_TEST_GITLAB_TOKEN + LM_TEST_GITLAB_PROJECT
// (optional LM_TEST_GITLAB_URL). Each run works on a new scratch branch and
// deletes it afterwards. Never point these at a real data repo.
declare const process: { env: Record<string, string | undefined> };
const env = process.env;

describe('contract: fake forge (branch CAS)', () => {
  transportContract(() => {
    const forge = new FakeForge();
    return Promise.resolve({
      transport: () => forge.transport(),
      cas: 'branch',
      startsEmpty: true,
    });
  });
});

describe('contract: fake forge (per-file CAS)', () => {
  transportContract(() => {
    const forge = new FakeForge({ cas: 'perFile' });
    return Promise.resolve({
      transport: () => forge.transport(),
      cas: 'perFile',
      startsEmpty: true,
    });
  });
});

describe('contract: GitHub transport on the emulator', () => {
  transportContract(() => {
    const gh = new GitHubEmulator();
    return Promise.resolve({
      transport: () =>
        new GitHubTransport({
          owner: gh.owner,
          repo: gh.repo,
          branch: gh.branch,
          token: gh.token,
          fetch: gh.fetch,
        }),
      cas: 'branch',
      startsEmpty: true,
    });
  });
});

describe('contract: GitLab transport on the emulator', () => {
  transportContract(() => {
    const gl = new GitLabEmulator();
    return Promise.resolve({
      transport: () =>
        new GitLabTransport({
          project: gl.project,
          branch: gl.branch,
          token: gl.token,
          fetch: gl.fetch,
        }),
      cas: 'perFile',
      startsEmpty: true,
    });
  });
});

const scratch = `lm-contract-${Date.now().toString(36)}`;
const fetcher = (url: string, init: RequestInit) => fetch(url, init);

describe.skipIf(!env['LM_TEST_GITHUB_TOKEN'] || !env['LM_TEST_GITHUB_REPO'])(
  'contract: GitHub transport on a real repo (opt-in)',
  () => {
    const token = env['LM_TEST_GITHUB_TOKEN'] ?? '';
    const [owner = '', repo = ''] = (env['LM_TEST_GITHUB_REPO'] ?? '').split('/');
    const apiBase = env['LM_TEST_GITHUB_API'] ?? 'https://api.github.com';
    const base = `${apiBase}/repos/${owner}/${repo}`;
    const headers = { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json' };
    let made: Promise<void> | null = null;
    const branch = () =>
      (made ??= (async () => {
        const info = (await (await fetch(base, { headers })).json()) as { default_branch: string };
        const ref = (await (
          await fetch(`${base}/git/ref/heads/${info.default_branch}`, { headers })
        ).json()) as { object: { sha: string } };
        const res = await fetch(`${base}/git/refs`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ ref: `refs/heads/${scratch}`, sha: ref.object.sha }),
        });
        if (!res.ok) throw new Error(`could not create the scratch branch: ${String(res.status)}`);
      })());
    afterAll(async () => {
      if (made) await fetch(`${base}/git/refs/heads/${scratch}`, { method: 'DELETE', headers });
    });
    transportContract(async () => {
      await branch();
      return {
        transport: () =>
          new GitHubTransport({ apiBase, owner, repo, branch: scratch, token, fetch: fetcher }),
        cas: 'branch',
        startsEmpty: false,
      };
    });
  },
);

describe.skipIf(!env['LM_TEST_GITLAB_TOKEN'] || !env['LM_TEST_GITLAB_PROJECT'])(
  'contract: GitLab transport on a real project (opt-in)',
  () => {
    const token = env['LM_TEST_GITLAB_TOKEN'] ?? '';
    const project = env['LM_TEST_GITLAB_PROJECT'] ?? '';
    const baseUrl = env['LM_TEST_GITLAB_URL'] ?? 'https://gitlab.com';
    const base = `${baseUrl}/api/v4/projects/${encodeURIComponent(project)}`;
    const headers = { authorization: `Bearer ${token}` };
    let made: Promise<void> | null = null;
    const branch = () =>
      (made ??= (async () => {
        const info = (await (await fetch(base, { headers })).json()) as { default_branch: string };
        const q = new URLSearchParams({ branch: scratch, ref: info.default_branch });
        const res = await fetch(`${base}/repository/branches?${q.toString()}`, {
          method: 'POST',
          headers,
        });
        if (!res.ok) throw new Error(`could not create the scratch branch: ${String(res.status)}`);
      })());
    afterAll(async () => {
      if (made)
        await fetch(`${base}/repository/branches/${encodeURIComponent(scratch)}`, {
          method: 'DELETE',
          headers,
        });
    });
    transportContract(async () => {
      await branch();
      return {
        transport: () =>
          new GitLabTransport({ baseUrl, project, branch: scratch, token, fetch: fetcher }),
        cas: 'perFile',
        startsEmpty: false,
      };
    });
  },
);
