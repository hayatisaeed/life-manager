import { createCrypto } from '@lm/crypto';
import { SyncError } from './transport';
import type { FileChange, SyncTransport, TreeEntry, RateLimitState } from './transport';
const encode = (text: string) => new Uint8Array([...text].map((char) => char.charCodeAt(0)));

/** Test-only snapshot forge. Opaque test SHAs are deterministic BLAKE2b prefixes, not Git hashes. */
export async function createFakeForge(initial: FileChange[] = []) {
  const crypto = await createCrypto();
  const hashes = new WeakMap<Uint8Array, string>();
  const digest = (bytes: Uint8Array) => {
    const existing = hashes.get(bytes);
    if (existing) return existing;
    const sha = crypto.contentHash(bytes).slice(0, 40);
    hashes.set(bytes, sha);
    return sha;
  };
  const trees = new Map<string, TreeEntry[]>();
  const blobs = new Map<string, Uint8Array>();
  const commits = new Map<string, { root: string; files: Map<string, Uint8Array> }>();
  let sequence = 0;
  const snapshots = (files: Map<string, Uint8Array>) => {
    const build = (directory: string, children: [string, Uint8Array][]): string => {
      const entries = new Map<string, TreeEntry>();
      const groups = new Map<string, [string, Uint8Array][]>();
      const prefix = directory ? `${directory}/` : '';
      for (const item of children) {
        const name = item[0].slice(prefix.length).split('/')[0];
        if (!name) throw new SyncError('invalid-remote');
        const child = `${prefix}${name}`;
        const siblings = groups.get(child) ?? [];
        siblings.push(item);
        groups.set(child, siblings);
      }
      for (const [child, items] of groups) {
        const first = items[0];
        if (!first) throw new SyncError('invalid-remote');
        if (first[0] !== child)
          entries.set(child, { path: child, kind: 'tree', sha: build(child, items) });
        else {
          if (items.length !== 1) throw new SyncError('invalid-remote');
          const sha = digest(first[1]);
          blobs.set(sha, first[1].slice());
          entries.set(child, { path: child, kind: 'blob', sha });
        }
      }
      const sorted = [...entries.values()].sort((a, b) => (a.path < b.path ? -1 : 1));
      const sha = digest(encode(JSON.stringify(sorted)));
      trees.set(sha, sorted);
      return sha;
    };
    const root = build('', [...files]);
    const commit = digest(encode(`${root}|${sequence++}`));
    commits.set(commit, {
      root,
      files: new Map(files),
    });
    return commit;
  };
  let head = snapshots(new Map(initial.map(({ path, content }) => [path, content.slice()])));
  let failure: SyncError | null = null;
  let dropResponse = false;
  let conflicts = 0;
  let rate: RateLimitState = { remaining: null, resetAt: null };
  const counters = { trees: 0, blobs: 0, commits: 0 };
  const transport: SyncTransport = {
    getHead: async () => {
      if (failure) throw failure;
      return head;
    },
    getRoot: async (commit) => {
      const snapshot = commits.get(commit);
      if (!snapshot) throw new SyncError('invalid-remote');
      return snapshot.root;
    },
    getTree: async (sha) => {
      counters.trees++;
      const entries = trees.get(sha);
      if (!entries) throw new SyncError('invalid-remote');
      return entries.map((entry) => ({ ...entry }));
    },
    readFile: async (path, commit) => commits.get(commit)?.files.get(path)?.slice() ?? null,
    readBlobs: async (entries) => {
      counters.blobs += entries.length;
      return new Map(
        entries.map(({ path, sha }) => {
          const blob = blobs.get(sha);
          if (!blob) throw new SyncError('invalid-remote');
          return [path, blob.slice()];
        }),
      );
    },
    commit: async (parent, changes) => {
      counters.commits++;
      if (failure) throw failure;
      if (conflicts > 0) {
        conflicts--;
        return 'conflict';
      }
      if (head !== parent) return 'conflict';
      if (changes.length === 0 || !changes.some((change) => change.path === 'lm.json'))
        throw new SyncError('invalid-remote');
      const files = new Map(commits.get(head)?.files);
      const paths = new Set<string>();
      for (const change of changes) {
        if (paths.has(change.path)) throw new SyncError('invalid-remote');
        paths.add(change.path);
        files.set(change.path, change.content.slice());
      }
      head = snapshots(files);
      if (dropResponse) {
        dropResponse = false;
        throw new SyncError('network');
      }
      return head;
    },
    rateLimit: () => ({ ...rate }),
  };
  return {
    transport,
    counters,
    fail: (error: SyncError | null) => {
      failure = error;
    },
    loseNextCommitResponse: () => {
      dropResponse = true;
    },
    rejectNextCommits: (count: number) => {
      conflicts = count;
    },
    setRateLimit: (state: RateLimitState) => {
      rate = state;
    },
    inspect: () =>
      new Map(
        [...(commits.get(head)?.files ?? [])].map(([path, content]) => [path, content.slice()]),
      ),
    // Models out-of-band corruption/removal without teaching the real transport to purge files.
    mutate: (run: (files: Map<string, Uint8Array>) => void) => {
      const files = new Map(
        [...(commits.get(head)?.files ?? [])].map(([path, content]) => [path, content.slice()]),
      );
      run(files);
      head = snapshots(new Map([...files].map(([path, content]) => [path, content.slice()])));
    },
  };
}
