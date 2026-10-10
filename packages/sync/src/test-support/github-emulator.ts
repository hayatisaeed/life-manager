// An in-memory stand-in for the parts of GitHub's REST and GraphQL APIs that
// GitHubTransport uses, behind a `fetch` function. It follows GitHub's
// documented behavior: 409 on an empty repo, fast-forward-only ref updates
// (422 otherwise), contents API for the first commit. Tests can inject
// responses and run code before a request (races).
import { gitBlobSha } from '../git-sha';
import type { Fetch } from '../http';

interface Commit {
  tree: string;
  parents: string[];
}
type TreeItem = { name: string; type: 'blob' | 'tree'; sha: string };

export interface EmulatorRequest {
  method: string;
  url: URL;
  body: unknown;
  headers: Record<string, string>;
}

export class GitHubEmulator {
  readonly blobs = new Map<string, Uint8Array>();
  readonly trees = new Map<string, TreeItem[]>();
  readonly commits = new Map<string, Commit>();
  head: string | null = null;
  requests: EmulatorRequest[] = [];
  /** Runs before each request is handled; return a Response to answer it instead. */
  intercept?:
    ((req: EmulatorRequest) => Response | undefined | Promise<Response | undefined>) | undefined;
  rateRemaining = 4999;
  private counter = 0;

  constructor(
    readonly owner = 'someone',
    readonly repo = 'data',
    readonly branch = 'main',
    readonly token = 'test-token',
  ) {}

  readonly fetch: Fetch = async (input, init) => {
    const url = new URL(input);
    const headers = Object.fromEntries(
      Object.entries((init.headers ?? {}) as Record<string, string>).map(([k, v]) => [
        k.toLowerCase(),
        v,
      ]),
    );
    const body: unknown = typeof init.body === 'string' ? JSON.parse(init.body) : undefined;
    const req: EmulatorRequest = { method: init.method ?? 'GET', url, body, headers };
    this.requests.push(req);
    const injected = await this.intercept?.(req);
    if (injected) return injected;
    if (headers['authorization'] !== `Bearer ${this.token}`)
      return this.json(401, { message: 'Bad credentials' });
    return this.route(req);
  };

  /** Files at a commit, flattened (tests). */
  files(commit: string | null = this.head): Map<string, string> {
    const out = new Map<string, string>();
    if (commit === null) return out;
    const c = this.commits.get(commit);
    if (c) this.flatten(c.tree, '', out);
    return out;
  }

  private route(req: EmulatorRequest): Response {
    const { method, url } = req;
    if (url.pathname === '/graphql') return this.graphql(req.body);
    const prefix = `/repos/${this.owner}/${this.repo}`;
    if (!url.pathname.startsWith(prefix)) return this.json(404, { message: 'Not Found' });
    const path = decodeURIComponent(url.pathname.slice(prefix.length));
    const raw = req.headers['accept'] === 'application/vnd.github.raw+json';
    let m: RegExpMatchArray | null;

    if (method === 'GET' && (m = /^\/git\/ref\/heads\/(.+)$/.exec(path))) {
      if (this.head === null) return this.json(409, { message: 'Git Repository is empty.' });
      if (m[1] !== this.branch) return this.json(404, { message: 'Not Found' });
      return this.json(200, { object: { sha: this.head, type: 'commit' } });
    }
    if (method === 'GET' && (m = /^\/git\/trees\/([0-9a-f]{40})$/.exec(path))) {
      const sha = m[1] ?? '';
      const tree = this.commits.get(sha)?.tree ?? sha;
      const items = this.trees.get(tree);
      if (!items) return this.json(404, { message: 'Not Found' });
      return this.json(200, {
        sha: tree,
        truncated: false,
        tree: items.map((i) => ({ path: i.name, type: i.type, sha: i.sha, mode: '100644' })),
      });
    }
    if (method === 'GET' && (m = /^\/git\/commits\/([0-9a-f]{40})$/.exec(path))) {
      const c = this.commits.get(m[1] ?? '');
      if (!c) return this.json(404, { message: 'Not Found' });
      return this.json(200, {
        sha: m[1],
        tree: { sha: c.tree },
        parents: c.parents.map((sha) => ({ sha })),
      });
    }
    if (method === 'GET' && (m = /^\/git\/blobs\/([0-9a-f]{40})$/.exec(path))) {
      const blob = this.blobs.get(m[1] ?? '');
      if (!blob) return this.json(404, { message: 'Not Found' });
      if (raw) return this.bytes(blob);
      return this.json(200, { content: btoa(String.fromCharCode(...blob)), encoding: 'base64' });
    }
    if (method === 'GET' && (m = /^\/contents\/(.+)$/.exec(path))) {
      const ref = url.searchParams.get('ref') ?? this.head;
      const sha = this.files(ref).get(m[1] ?? '');
      const blob = sha === undefined ? undefined : this.blobs.get(sha);
      if (!blob) return this.json(404, { message: 'Not Found' });
      return this.bytes(blob);
    }
    if (method === 'PUT' && (m = /^\/contents\/(.+)$/.exec(path))) {
      const b = req.body as { content: string; branch: string };
      const file = m[1] ?? '';
      if (this.files().has(file)) return this.json(422, { message: '"sha" wasn\'t supplied.' });
      const tree = this.writeTree(
        new Map([...this.files(), [file, this.addBlob(fromB64(b.content))]]),
      );
      const sha = this.addCommit(tree, this.head === null ? [] : [this.head]);
      this.head = sha;
      return this.json(201, { content: { path: file }, commit: { sha } });
    }
    if (this.head === null) return this.json(409, { message: 'Git Repository is empty.' });
    if (method === 'POST' && path === '/git/blobs') {
      const b = req.body as { content: string; encoding: string };
      const data =
        b.encoding === 'base64' ? fromB64(b.content) : new TextEncoder().encode(b.content);
      return this.json(201, { sha: this.addBlob(data) });
    }
    if (method === 'POST' && path === '/git/trees') {
      const b = req.body as {
        base_tree?: string;
        tree: { path: string; sha?: string | null; content?: string }[];
      };
      const files = new Map<string, string>();
      if (b.base_tree) this.flatten(b.base_tree, '', files);
      for (const e of b.tree) {
        if (e.content !== undefined)
          files.set(e.path, this.addBlob(new TextEncoder().encode(e.content)));
        else if (e.sha === null || e.sha === undefined) {
          if (!files.delete(e.path)) return this.json(422, { message: 'GitRPC::BadObjectState' });
        } else if (!this.blobs.has(e.sha)) return this.json(422, { message: 'Invalid sha' });
        else files.set(e.path, e.sha);
      }
      return this.json(201, { sha: this.writeTree(files) });
    }
    if (method === 'POST' && path === '/git/commits') {
      const b = req.body as { tree: string; parents: string[] };
      if (!this.trees.has(b.tree) || b.parents.some((p) => !this.commits.has(p)))
        return this.json(422, { message: 'Invalid' });
      return this.json(201, { sha: this.addCommit(b.tree, b.parents) });
    }
    if (method === 'PATCH' && (m = /^\/git\/refs\/heads\/(.+)$/.exec(path))) {
      const b = req.body as { sha: string; force: boolean };
      if (m[1] !== this.branch) return this.json(404, { message: 'Not Found' });
      if (!b.force && !this.descends(b.sha, this.head))
        return this.json(422, { message: 'Update is not a fast forward' });
      this.head = b.sha;
      return this.json(200, { object: { sha: b.sha } });
    }
    return this.json(404, { message: 'Not Found' });
  }

  private graphql(body: unknown): Response {
    const { query, variables } = body as { query: string; variables: Record<string, string> };
    if (variables['owner'] !== this.owner || variables['name'] !== this.repo)
      return this.json(200, { data: { repository: null }, errors: [{ type: 'NOT_FOUND' }] });
    const repository: Record<string, unknown> = {};
    for (const m of query.matchAll(/(b\d+): object\(oid: \$(o\d+)\)/g)) {
      const blob = this.blobs.get(variables[m[2] ?? ''] ?? '');
      let text: string | null = null;
      let isBinary = false;
      if (blob) {
        try {
          text = new TextDecoder('utf-8', { fatal: true }).decode(blob);
          isBinary = text.includes('\0');
        } catch {
          isBinary = true;
        }
        if (isBinary) text = null;
      }
      repository[m[1] ?? ''] = blob ? { text, isBinary, isTruncated: false } : null;
    }
    return this.json(200, { data: { repository } }, 'graphql');
  }

  private descends(commit: string, ancestor: string | null): boolean {
    if (ancestor === null) return true;
    const queue = [commit];
    while (queue.length > 0) {
      const c = queue.pop() as string;
      if (c === ancestor) return true;
      queue.push(...(this.commits.get(c)?.parents ?? []));
    }
    return false;
  }

  private addBlob(data: Uint8Array): string {
    const sha = gitBlobSha(data);
    this.blobs.set(sha, data.slice());
    return sha;
  }

  private addCommit(tree: string, parents: string[]): string {
    const sha = (++this.counter).toString(16).padStart(40, 'c');
    this.commits.set(sha, { tree, parents });
    return sha;
  }

  /** Stores the tree objects for a flat file map; returns the root tree SHA. */
  private writeTree(files: ReadonlyMap<string, string>, prefix = ''): string {
    const items = new Map<string, TreeItem>();
    const subdirs = new Map<string, Map<string, string>>();
    for (const [path, sha] of files) {
      const slash = path.indexOf('/');
      if (slash < 0) items.set(path, { name: path, type: 'blob', sha });
      else {
        const dir = path.slice(0, slash);
        let sub = subdirs.get(dir);
        if (!sub) subdirs.set(dir, (sub = new Map()));
        sub.set(path.slice(slash + 1), sha);
      }
    }
    for (const [dir, sub] of subdirs) {
      items.set(dir, { name: dir, type: 'tree', sha: this.writeTree(sub, `${prefix}${dir}/`) });
    }
    const list = [...items.values()].sort((a, b) => (a.name < b.name ? -1 : 1));
    const sha = gitBlobSha(new TextEncoder().encode(`tree ${JSON.stringify(list)}`));
    this.trees.set(sha, list);
    return sha;
  }

  private flatten(tree: string, prefix: string, out: Map<string, string>): void {
    for (const i of this.trees.get(tree) ?? []) {
      if (i.type === 'blob') out.set(`${prefix}${i.name}`, i.sha);
      else this.flatten(i.sha, `${prefix}${i.name}/`, out);
    }
  }

  private headers(resource = 'core'): Record<string, string> {
    return {
      'x-ratelimit-remaining': String(this.rateRemaining),
      'x-ratelimit-reset': '1900000000',
      'x-ratelimit-resource': resource,
    };
  }

  private json(status: number, body: unknown, resource?: string): Response {
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json', ...this.headers(resource) },
    });
  }

  private bytes(data: Uint8Array): Response {
    return new Response(data.slice(), { status: 200, headers: this.headers() });
  }
}

function fromB64(s: string): Uint8Array {
  return Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
}
