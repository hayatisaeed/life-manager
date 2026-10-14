import { expect, it } from 'vitest';
import { createWebHttp } from '@lm/platform';
import type { Http, SecretStore } from '@lm/platform';
import { createCrypto } from '@lm/crypto';
import { createIdGenerator, formatHlc } from '@lm/core';
import { createGitHubTransport, createGitLabTransport, unlockSyncVault } from './index';
import type { SyncTransport } from './index';

// Opt-in only, per AGENTS.md §7: these mutate supplied dedicated test repos, never product config.
for (const provider of ['github', 'gitlab'] as const) {
  const env = provider === 'github' ? 'LM_TEST_GITHUB_' : 'LM_TEST_GITLAB_';
  const token = process.env[`${env}TOKEN`],
    repository = process.env[`${env}REPO`],
    passphrase = process.env[`${env}PASSPHRASE`];
  it.skipIf(!token || !repository || !passphrase)(
    `${provider} real-forge atomic header gate rejects a concurrent create-only batch`,
    async () => {
      if (!token || !repository || !passphrase)
        throw new Error('Dedicated contract environment incomplete');
      const apiBase =
        process.env[`${env}API_BASE`] ??
        (provider === 'github' ? 'https://api.github.com' : 'https://gitlab.com/api/v4');
      const branch = process.env[`${env}BRANCH`] ?? 'main';
      const web = createWebHttp([new URL(apiBase).origin]);
      let release: (() => void) | undefined;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      let waiting = 0;
      const http: Http = {
        request: async (url, input) => {
          const path = new URL(url).pathname;
          const isPublish =
            provider === 'github'
              ? input.method === 'PATCH' && path.includes('/git/refs/heads/')
              : input.method === 'POST' && path.endsWith('/repository/commits');
          if (isPublish && waiting < 2) {
            if (++waiting === 2) release?.();
            await gate;
          }
          return web.request(url, input);
        },
      };
      const secrets: SecretStore = {
        get: async () => token,
        set: async () => {
          throw new Error('Test secrets are env-only');
        },
        remove: async () => undefined,
      };
      const factory = async (): Promise<SyncTransport> => {
        if (provider === 'gitlab')
          return createGitLabTransport({
            http,
            secrets,
            tokenName: 'contract',
            apiBase,
            branch,
            project: repository,
            verifiedWriteGate: true,
          });
        const [owner, name, ...extra] = repository.split('/');
        if (!owner || !name || extra.length)
          throw new Error('Invalid dedicated GitHub test repository');
        return createGitHubTransport({
          http,
          secrets,
          tokenName: 'contract',
          apiBase,
          branch,
          owner,
          repository: name,
        });
      };
      const a = await factory(),
        b = await factory();
      const head = await a.getHead();
      const crypto = await createCrypto();
      const headerBytes = await a.readFile('lm.json', head);
      if (!headerBytes)
        throw new Error('Dedicated contract repository must contain a synthetic v2 test vault');
      const unlocked = await unlockSyncVault(
        JSON.parse(crypto.decodeUtf8(headerBytes)),
        passphrase,
      );
      const keys = crypto.deriveKeys(unlocked.dataKey);
      const generate = createIdGenerator(() => (crypto.randomKey()[0] ?? 0) / 256);
      const makeBatch = (device: string) => {
        const id = generate(Date.now()),
          clock = formatHlc({ millis: Date.now(), counter: 0, deviceId: device });
        const path = crypto.recordPath(id, keys.path);
        const envelope = {
          id,
          type: 'note',
          schema: 1,
          hlc: clock,
          fieldHlc: {},
          createdAt: clock.slice(0, 24),
          deletedAt: null,
          data: { title: 'Synthetic contract record', content: '', tags: [], pinned: false },
        };
        const { control: _control, ...binding } = unlocked.header;
        const header = {
          ...binding,
          control: crypto.encodeControl(
            binding,
            { ...unlocked.control, writeNonce: crypto.randomControlId() },
            keys.record,
          ),
        };
        return [
          {
            path,
            content: crypto.encodeUtf8(
              crypto.encodeRecord(crypto.encodeUtf8(JSON.stringify(envelope)), path, keys.record),
            ),
          },
          { path: 'lm.json', content: crypto.encodeUtf8(JSON.stringify(header)) },
        ];
      };
      const timer = setTimeout(() => release?.(), 20000);
      try {
        const batches = [makeBatch('contractA'), makeBatch('contractB')];
        const first = batches[0],
          second = batches[1];
        if (!first || !second) throw new Error('Missing contract batch');
        const results = await Promise.all([a.commit(head, first), b.commit(head, second)]);
        expect(waiting).toBe(2);
        expect(results.filter((result) => result === 'conflict')).toHaveLength(1);
        const current = await a.getHead();
        const winner = results[0] === 'conflict' ? second : first;
        const loser = results[0] === 'conflict' ? first : second;
        const winnerPath = winner[0]?.path,
          loserPath = loser[0]?.path;
        if (!winnerPath || !loserPath) throw new Error('Missing contract path');
        expect(await a.readFile(winnerPath, current)).not.toBeNull();
        expect(await a.readFile(loserPath, current)).toBeNull();
        // Synthetic encrypted test records remain for inspection; this test never purges repository data.
      } finally {
        clearTimeout(timer);
        release?.();
        crypto.dispose(unlocked.dataKey);
        for (const key of Object.values(keys)) crypto.dispose(key);
      }
    },
    60000,
  );
}
