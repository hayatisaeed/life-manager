import { commitShaSchema, treeEntrySchema, SyncError } from './transport';
import type { SyncTransport, TreeEntry } from './transport';

/** SYNC.md §5: skip unchanged subtrees; store directory SHAs alongside blob SHAs. */
export async function remoteTree(
  transport: SyncTransport,
  commit: string,
  previous: Map<string, string>,
): Promise<Map<string, string>> {
  commitShaSchema.parse(commit);
  const root = commitShaSchema.parse(await transport.getRoot(commit));
  if (previous.get('') === root) return new Map(previous);
  const next = new Map<string, string>([['', root]]);
  const seen = new Set<string>();
  let count = 0;
  async function walk(tree: string, directory: string) {
    if (previous.get(directory) === tree && directory !== '') {
      const prefix = `${directory}/`;
      for (const [path, sha] of previous)
        if (path === directory || path.startsWith(prefix)) next.set(path, sha);
      return;
    }
    const entries = await transport.getTree(tree, directory);
    for (const raw of entries) {
      const entry: TreeEntry = treeEntrySchema.parse(raw);
      const prefix = directory ? `${directory}/` : '';
      if (
        !entry.path.startsWith(prefix) ||
        !entry.path.slice(prefix.length) ||
        entry.path.slice(prefix.length).includes('/') ||
        seen.has(entry.path)
      )
        throw new SyncError('invalid-remote');
      seen.add(entry.path);
      if (++count > 2000000) throw new SyncError('invalid-remote');
      next.set(entry.path, entry.sha);
      if (entry.kind === 'tree') {
        if (directory.split('/').filter(Boolean).length >= 8) throw new SyncError('invalid-remote');
        await walk(entry.sha, entry.path);
      }
    }
  }
  await walk(root, '');
  return next;
}
