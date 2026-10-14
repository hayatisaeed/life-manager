import { z } from 'zod';
import { forgeClient, validateChanges, boundedMap } from './http';
import type { TransportOptions } from './http';
import { SyncError, commitShaSchema as sha } from './transport';
import type { SyncTransport, TreeEntry } from './transport';
const refSchema = z.object({ object: z.object({ sha }) });
const treeSchema = z.object({
  sha,
  truncated: z.boolean(),
  tree: z.array(
    z.object({
      path: z.string(),
      sha,
      type: z.enum(['blob', 'tree', 'commit']),
      mode: z.string(),
    }),
  ),
});
/** SYNC.md §7 and official GitHub git-data APIs; all record writes remain ciphertext. */
export async function createGitHubTransport(
  options: TransportOptions & { owner: string; repository: string },
): Promise<SyncTransport> {
  const client = await forgeClient(options, 'github');
  const graphqlBase = options.apiBase.replace(/\/api\/v3\/?$/, '/api');
  const graph = await forgeClient({ ...options, apiBase: graphqlBase }, 'github');
  let graphRate: { remaining: number | null; resetAt: number | null } = {
    remaining: null,
    resetAt: null,
  };
  const prefix = `/repos/${encodeURIComponent(options.owner)}/${encodeURIComponent(options.repository)}`;
  const branch = encodeURIComponent(options.branch);
  const root = async (commit: string) =>
    client.json(
      await client.request(`${prefix}/git/commits/${sha.parse(commit)}`),
      z.object({ tree: z.object({ sha }) }),
    ).tree.sha;
  const head = async () => {
    const repo = client.json(
      await client.request(prefix),
      z.object({
        private: z.boolean(),
        default_branch: z.string(),
        permissions: z.object({ push: z.boolean() }).optional(),
      }),
    );
    if (!repo.private || repo.permissions?.push === false) throw new SyncError('authentication');
    if (repo.default_branch !== options.branch) throw new SyncError('recovery-required');
    return client.json(await client.request(`${prefix}/git/ref/heads/${branch}`), refSchema).object
      .sha;
  };
  const entries = (input: z.infer<typeof treeSchema>, path = ''): TreeEntry[] => {
    if (input.truncated) throw new SyncError('invalid-remote');
    return input.tree.map((entry) => {
      if (entry.type === 'commit' || !['100644', '040000'].includes(entry.mode))
        throw new SyncError('invalid-remote');
      return {
        path: path ? `${path}/${entry.path}` : entry.path,
        sha: entry.sha,
        kind: entry.type as 'blob' | 'tree',
      };
    });
  };
  const readBlob = async (entry: { path: string; sha: string }) => {
    const blob = client.json(
      await client.request(`${prefix}/git/blobs/${sha.parse(entry.sha)}`),
      z.object({ encoding: z.literal('base64'), content: z.string() }),
    );
    try {
      return [entry.path, client.crypto.decodeBase64(blob.content.replaceAll('\n', ''))] as const;
    } catch {
      throw new SyncError('invalid-remote');
    }
  };
  return {
    getHead: head,
    getRoot: root,
    getTree: async (tree, path) =>
      entries(
        client.json(await client.request(`${prefix}/git/trees/${sha.parse(tree)}`), treeSchema),
        path,
      ),
    getTreeRecursive: async (commit) => {
      const input = client.json(
        await client.request(`${prefix}/git/trees/${await root(commit)}?recursive=1`),
        treeSchema,
      );
      return input.truncated ? 'truncated' : entries(input);
    },
    readBlobs: async (batch) => {
      const result = new Map<string, Uint8Array>();
      const binary = batch.filter((entry) => !entry.path.endsWith('.lmr'));
      for (const [path, content] of await boundedMap(binary, 6, readBlob))
        result.set(path, content);
      const records = batch.filter((entry) => entry.path.endsWith('.lmr'));
      for (let offset = 0; offset < records.length; offset += 100) {
        const entries = records.slice(offset, offset + 100);
        const aliases = entries
          .map(
            (entry, i) =>
              `b${i}:object(oid:${JSON.stringify(sha.parse(entry.sha))}){...on Blob{text}}`,
          )
          .join(' ');
        const response = graph.json(
          await graph.request('/graphql', 'POST', {
            query: `query{repository(owner:${JSON.stringify(options.owner)},name:${JSON.stringify(options.repository)}){${aliases}}rateLimit{remaining resetAt}}`,
          }),
          z.object({
            data: z
              .object({
                repository: z
                  .record(z.string(), z.object({ text: z.string().nullable() }).nullable())
                  .nullable(),
                rateLimit: z
                  .object({ remaining: z.number().int().nonnegative(), resetAt: z.iso.datetime() })
                  .optional(),
              })
              .optional(),
            errors: z.array(z.object({ type: z.string().optional() })).optional(),
          }),
        );
        if (response.data?.rateLimit)
          graphRate = {
            remaining: response.data.rateLimit.remaining,
            resetAt: Date.parse(response.data.rateLimit.resetAt),
          };
        if (response.errors?.some((error) => error.type === 'RATE_LIMITED'))
          throw new SyncError('rate-limit', graphRate.resetAt ?? undefined);
        if (response.errors?.length || !response.data?.repository)
          throw new SyncError('invalid-remote');
        for (const [i, entry] of entries.entries()) {
          const blob = response.data.repository[`b${i}`];
          if (blob?.text !== null && blob?.text !== undefined)
            result.set(entry.path, client.crypto.encodeUtf8(blob.text));
          else {
            const [path, content] = await readBlob(entry);
            result.set(path, content);
          }
        }
      }
      return result;
    },
    readFile: async (path, commit) => {
      const response = await client.request(
        `${prefix}/contents/${path.split('/').map(encodeURIComponent).join('/')}?ref=${sha.parse(commit)}`,
      );
      if (response.status === 404) return null;
      const file = client.json(
        response,
        z.object({ type: z.literal('file'), encoding: z.literal('base64'), content: z.string() }),
      );
      try {
        return client.crypto.decodeBase64(file.content.replaceAll('\n', ''));
      } catch {
        throw new SyncError('invalid-remote');
      }
    },
    commit: async (parent, changes) => {
      sha.parse(parent);
      validateChanges(changes);
      if ((await head()) !== parent) return 'conflict';
      const tree = await boundedMap(changes, 6, async (change) => {
        const blob = client.json(
          await client.request(`${prefix}/git/blobs`, 'POST', {
            content: client.crypto.encodeBase64(change.content),
            encoding: 'base64',
          }),
          z.object({ sha }),
        );
        return { path: change.path, type: 'blob', mode: '100644', sha: blob.sha };
      });
      const createdTree = client.json(
        await client.request(`${prefix}/git/trees`, 'POST', {
          base_tree: await root(parent),
          tree,
        }),
        z.object({ sha }),
      );
      const commit = client.json(
        await client.request(`${prefix}/git/commits`, 'POST', {
          message: 'sync',
          tree: createdTree.sha,
          parents: [parent],
          author: { name: 'Life Manager', email: 'noreply@invalid' },
          committer: { name: 'Life Manager', email: 'noreply@invalid' },
        }),
        z.object({ sha }),
      );
      const updated = await client.request(`${prefix}/git/refs/heads/${branch}`, 'PATCH', {
        sha: commit.sha,
        force: false,
      });
      if ((updated.status === 409 || updated.status === 422) && (await head()) !== parent)
        return 'conflict';
      client.json(updated, refSchema);
      return commit.sha;
    },
    rateLimit: () => {
      const rest = client.rateLimit(),
        gql = graphRate.remaining === null ? graph.rateLimit() : graphRate;
      return {
        remaining:
          rest.remaining === null
            ? gql.remaining
            : gql.remaining === null
              ? rest.remaining
              : Math.min(rest.remaining, gql.remaining),
        resetAt:
          rest.resetAt === null
            ? gql.resetAt
            : gql.resetAt === null
              ? rest.resetAt
              : Math.max(rest.resetAt, gql.resetAt),
      };
    },
  };
}
