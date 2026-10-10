// An in-memory stand-in for the parts of GitLab's REST API that
// GitLabTransport uses, behind a `fetch` function. The commits API follows
// GitLab's documented per-file checks: `create` fails on an existing file,
// `update`/`delete` on a missing one or a stale `last_commit_id`, and a
// commit otherwise lands on the current branch head.
import { gitBlobSha } from '../git-sha';
import type { Fetch } from '../http';
import type { EmulatorRequest } from './github-emulator';

interface Commit {
  parents: string[];
  files: Map<string, string>; // path → blob sha
  touched: Map<string, string>; // path → last commit that changed it
}

interface Action {
  action: 'create' | 'update' | 'delete';
  file_path: string;
  content?: string;
  encoding?: 'text' | 'base64';
  last_commit_id?: string;
}

export class GitLabEmulator {
  readonly blobs = new Map<string, Uint8Array>();
  readonly commits = new Map<string, Commit>();
  head: string | null = null;
  requests: EmulatorRequest[] = [];
  intercept?:
    ((req: EmulatorRequest) => Response | undefined | Promise<Response | undefined>) | undefined;
  rateRemaining = 1999;
  private counter = 0;

  constructor(
    readonly project = 'someone/data',
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
      return this.json(401, { message: '401 Unauthorized' });
    return this.route(req);
  };

  files(commit: string | null = this.head): Map<string, string> {
    return new Map(commit === null ? [] : this.commits.get(commit)?.files);
  }

  private route(req: EmulatorRequest): Response {
    const { method, url } = req;
    // URL.pathname keeps %2F, so split before decoding.
    const prefix = `/api/v4/projects/${encodeURIComponent(this.project)}/repository`;
    if (!url.pathname.startsWith(prefix))
      return this.json(404, { message: '404 Project Not Found' });
    const rest = url.pathname.slice(prefix.length);
    const q = url.searchParams;
    let m: RegExpMatchArray | null;

    if (method === 'GET' && (m = /^\/branches\/([^/]+)$/.exec(rest))) {
      if (this.head === null || decodeURIComponent(m[1] ?? '') !== this.branch)
        return this.json(404, { message: '404 Branch Not Found' });
      return this.json(200, { name: this.branch, commit: { id: this.head } });
    }
    if (method === 'GET' && rest === '/tree') {
      const dir = q.get('path') ?? '';
      const files = this.files(q.get('ref'));
      const prefixDir = dir === '' ? '' : `${dir}/`;
      const children = new Map<string, { type: 'blob' | 'tree'; id: string; listing: string[] }>();
      for (const [path, sha] of [...files].sort()) {
        if (!path.startsWith(prefixDir)) continue;
        const [name = '', ...below] = path.slice(prefixDir.length).split('/');
        if (below.length === 0) children.set(name, { type: 'blob', id: sha, listing: [] });
        else {
          const c = children.get(name) ?? { type: 'tree' as const, id: '', listing: [] };
          c.listing.push(`${below.join('/')}:${sha}`);
          children.set(name, c);
        }
      }
      if (children.size === 0) return this.json(404, { message: '404 Tree Not Found' });
      const all = [...children].map(([name, c]) => ({
        name,
        type: c.type,
        path: `${prefixDir}${name}`,
        mode: c.type === 'tree' ? '040000' : '100644',
        id: c.type === 'blob' ? c.id : gitBlobSha(new TextEncoder().encode(c.listing.join('\n'))),
      }));
      const perPage = Number(q.get('per_page') ?? 20);
      const page = Number(q.get('page') ?? 1);
      return this.json(200, all.slice((page - 1) * perPage, page * perPage));
    }
    if (method === 'GET' && (m = /^\/blobs\/([0-9a-f]{40})\/raw$/.exec(rest))) {
      const blob = this.blobs.get(m[1] ?? '');
      return blob ? this.bytes(blob) : this.json(404, { message: '404 Blob Not Found' });
    }
    if (method === 'GET' && (m = /^\/files\/([^/]+)(\/raw)?$/.exec(rest))) {
      const path = decodeURIComponent(m[1] ?? '');
      const ref = q.get('ref');
      const sha = this.files(ref).get(path);
      if (sha === undefined) return this.json(404, { message: '404 File Not Found' });
      if (m[2]) return this.bytes(this.blobs.get(sha) ?? new Uint8Array());
      const last = ref === null ? undefined : this.commits.get(ref)?.touched.get(path);
      return this.json(200, { file_path: path, blob_id: sha, last_commit_id: last });
    }
    if (method === 'POST' && rest === '/commits') {
      const b = req.body as { branch: string; actions: Action[] };
      if (b.branch !== this.branch)
        return this.json(400, {
          message: 'You can only create or edit files when you are on a branch',
        });
      const current = this.head === null ? undefined : this.commits.get(this.head);
      const files = new Map(current?.files);
      const touched = new Map(current?.touched);
      const sha = (++this.counter).toString(16).padStart(40, 'd');
      for (const a of b.actions) {
        const exists = files.has(a.file_path);
        if (a.action === 'create' && exists)
          return this.json(400, { message: 'A file with this name already exists' });
        if (a.action !== 'create' && !exists)
          return this.json(400, { message: "A file with this name doesn't exist" });
        if (
          a.action !== 'create' &&
          a.last_commit_id !== undefined &&
          a.last_commit_id !== touched.get(a.file_path)
        )
          return this.json(400, {
            message:
              'You are attempting to update a file that has changed since you started editing it.',
          });
        if (a.action === 'delete') files.delete(a.file_path);
        else {
          const data =
            a.encoding === 'base64'
              ? Uint8Array.from(atob(a.content ?? ''), (c) => c.charCodeAt(0))
              : new TextEncoder().encode(a.content ?? '');
          const blob = gitBlobSha(data);
          this.blobs.set(blob, data);
          files.set(a.file_path, blob);
        }
        touched.set(a.file_path, sha);
      }
      const parents = this.head === null ? [] : [this.head];
      this.commits.set(sha, { parents, files, touched });
      this.head = sha;
      return this.json(201, { id: sha, parent_ids: parents });
    }
    return this.json(404, { message: '404 Not Found' });
  }

  private headers(): Record<string, string> {
    return { 'ratelimit-remaining': String(this.rateRemaining), 'ratelimit-reset': '1900000000' };
  }

  private json(status: number, body: unknown): Response {
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json', ...this.headers() },
    });
  }

  private bytes(data: Uint8Array): Response {
    return new Response(data.slice(), { status: 200, headers: this.headers() });
  }
}
