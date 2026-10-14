import { z } from 'zod';
import { forgeClient, validateChanges, boundedMap } from './http';
import type { TransportOptions } from './http';
import { SyncError, commitShaSchema as sha } from './transport';
import type { SyncTransport, TreeEntry } from './transport';
const treeSchema = z.array(
  z.object({
    path: z.string(),
    id: sha,
    type: z.enum(['tree', 'blob', 'commit']),
    mode: z.string(),
  }),
);
/** SYNC.md §7: experimental until dedicated real-forge tests prove the shared lm.json gate. */
export async function createGitLabTransport(
  options: TransportOptions & { project: string; verifiedWriteGate: boolean },
): Promise<SyncTransport> {
  const client = await forgeClient(options, 'gitlab');
  const prefix = `/projects/${encodeURIComponent(options.project)}`;
  const refs = new Map<string, string>();
  const metadata = (path: string, commit: string) =>
    client.request(
      `${prefix}/repository/files/${encodeURIComponent(path)}?ref=${sha.parse(commit)}`,
      'HEAD',
    );
  const head = async () => {
    const project = client.json(
      await client.request(prefix),
      z.object({ visibility: z.string(), default_branch: z.string().nullable() }),
    );
    if (project.visibility !== 'private') throw new SyncError('authentication');
    if (project.default_branch !== options.branch) throw new SyncError('recovery-required');
    return client.json(
      await client.request(`${prefix}/repository/branches/${encodeURIComponent(options.branch)}`),
      z.object({ commit: z.object({ id: sha }) }),
    ).commit.id;
  };
  return {
    getHead: head,
    // GitLab tree listings expose subtree SHAs, not a root-tree endpoint. Commit ID is the root marker.
    getRoot: async (commit) => {
      sha.parse(commit);
      refs.set(`|${commit}`, commit);
      return commit;
    },
    getTree: async (tree, path) => {
      const commit = refs.get(`${path}|${sha.parse(tree)}`);
      if (!commit) throw new SyncError('invalid-remote');
      const entries: TreeEntry[] = [];
      const tokens = new Set<string>();
      let token: string | null = null;
      for (let page = 0; page < 20000; page++) {
        const url = `${prefix}/repository/tree?path=${encodeURIComponent(path)}&ref=${commit}&per_page=100&pagination=keyset${token === null ? '' : `&page_token=${encodeURIComponent(token)}`}`;
        const response = await client.request(url);
        const batch = client.json(response, treeSchema);
        for (const entry of batch) {
          if (entry.type === 'commit' || !['100644', '040000'].includes(entry.mode))
            throw new SyncError('invalid-remote');
          entries.push({ path: entry.path, sha: entry.id, kind: entry.type as 'blob' | 'tree' });
          if (entry.type === 'tree') refs.set(`${entry.path}|${entry.id}`, commit);
        }
        const link = response.headers['link'];
        const next = link?.split(',').find((part) => /;\s*rel="?next"?/.test(part));
        if (!next) {
          // A full page without exposed pagination headers cannot prove enumeration completeness.
          if (batch.length === 100 && link === undefined) throw new SyncError('invalid-remote');
          return entries;
        }
        const match = /<([^>]+)>/.exec(next);
        if (!match?.[1]) throw new SyncError('invalid-remote');
        const parsed = new URL(match[1]);
        const configured = new URL(options.apiBase);
        if (
          parsed.origin !== configured.origin ||
          parsed.pathname !==
            `${configured.pathname.replace(/\/$/, '')}${prefix}/repository/tree` ||
          parsed.searchParams.get('ref') !== commit ||
          (parsed.searchParams.get('path') ?? '') !== path
        )
          throw new SyncError('invalid-remote');
        token = parsed.searchParams.get('page_token');
        if (!token || tokens.has(token)) throw new SyncError('invalid-remote');
        tokens.add(token);
      }
      throw new SyncError('invalid-remote');
    },
    readBlobs: async (entries) =>
      new Map(
        await boundedMap(entries, 6, async (entry) => {
          const response = await client.request(
            `${prefix}/repository/blobs/${sha.parse(entry.sha)}/raw`,
          );
          if (response.status !== 200) throw new SyncError('invalid-remote');
          return [entry.path, response.body] as const;
        }),
      ),
    readFile: async (path, commit) => {
      const response = await client.request(
        `${prefix}/repository/files/${encodeURIComponent(path)}/raw?ref=${sha.parse(commit)}`,
      );
      if (response.status === 404) return null;
      if (response.status !== 200) throw new SyncError('invalid-remote');
      return response.body;
    },
    commit: async (parent, changes) => {
      if (!options.verifiedWriteGate) throw new SyncError('update-required');
      sha.parse(parent);
      validateChanges(changes);
      if ((await head()) !== parent) return 'conflict';
      const actions = await boundedMap(changes, 6, async (change) => {
        const response = await metadata(change.path, parent);
        if (response.status !== 200 && response.status !== 404)
          throw new SyncError('invalid-remote');
        const exists = response.status === 200;
        if (change.path === 'lm.json' && !exists) throw new SyncError('invalid-remote');
        const last = exists ? sha.parse(response.headers['x-gitlab-last-commit-id']) : undefined;
        return {
          action: exists ? 'update' : 'create',
          file_path: change.path,
          content: client.crypto.encodeBase64(change.content),
          encoding: 'base64',
          ...(last === undefined ? {} : { last_commit_id: last }),
        };
      });
      const response = await client.request(`${prefix}/repository/commits`, 'POST', {
        branch: options.branch,
        start_sha: parent,
        force: false,
        commit_message: 'sync',
        author_name: 'Life Manager',
        author_email: 'noreply@invalid',
        actions,
      });
      if ([400, 409, 422].includes(response.status) && (await head()) !== parent) return 'conflict';
      return client.json(response, z.object({ id: sha })).id;
    },
    rateLimit: client.rateLimit,
  };
}
