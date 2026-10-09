// P0.2 GitLab spike: CORS, tree pagination returning SHAs, the commits API
// with last_commit_id rejecting stale updates, and archive download CORS.
// Works on a scratch branch `lm-spike-<random>` and deletes it at the end.
// Env: LM_TEST_GITLAB_TOKEN, LM_TEST_GITLAB_PROJECT (numeric id or group/name),
// optional LM_TEST_GITLAB_URL (default https://gitlab.com).
import { ORIGIN, env, preflight, corsOk, record, summary, rand } from './common.mjs';

const token = env('LM_TEST_GITLAB_TOKEN');
const project = encodeURIComponent(env('LM_TEST_GITLAB_PROJECT'));
const host = process.env.LM_TEST_GITLAB_URL ?? 'https://gitlab.com';
const base = `${host}/api/v4/projects/${project}`;

async function gl(method, path, body) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      origin: ORIGIN,
      authorization: `Bearer ${token}`,
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const ct = res.headers.get('content-type') ?? '';
  const data = ct.includes('json') ? await res.json() : new Uint8Array(await res.arrayBuffer());
  return { res, data };
}

const pf = await preflight(`${base}/repository/commits`, 'POST', ['authorization', 'content-type']);
record('commits preflight allows POST + authorization', pf.status < 300 && !!pf.allowOrigin, pf);

const { res: pres, data: proj } = await gl('GET', '');
record(
  'REST response carries CORS header',
  corsOk(pres),
  pres.headers.get('access-control-allow-origin'),
);
const branch = `lm-spike-${rand()}`;
await gl('POST', `/repository/branches?branch=${branch}&ref=${proj.default_branch}`);

try {
  // 1. 250 files in one commit, so tree pagination needs 3 pages.
  const actions = Array.from({ length: 250 }, (_, i) => ({
    action: 'create',
    file_path: `spike/${String(i).padStart(3, '0')}.lmr`,
    content: Buffer.from(`record ${i} ${rand()}`).toString('base64'),
    encoding: 'base64',
  }));
  let t = performance.now();
  const c1 = await gl('POST', '/repository/commits', { branch, commit_message: 'sync', actions });
  record('commit with 250 files', c1.res.status === 201, { ms: Math.round(performance.now() - t) });

  // 2. Keyset pagination
  let url = `/repository/tree?path=spike&ref=${branch}&per_page=100&pagination=keyset`;
  const entries = [];
  let pages = 0;
  while (url) {
    const { res, data } = await gl('GET', url);
    pages++;
    entries.push(...data);
    const link = res.headers.get('link') ?? '';
    const next = /<([^>]+)>;\s*rel="next"/.exec(link)?.[1];
    url = next ? next.slice(base.length) : null;
    if (pages === 1)
      record(
        'Link header readable cross-origin',
        /link/i.test(res.headers.get('access-control-expose-headers') ?? ''),
        res.headers.get('access-control-expose-headers'),
      );
  }
  record(
    'tree keyset pagination returns all entries with SHAs',
    entries.length === 250 && entries.every((e) => /^[0-9a-f]{40}$/.test(e.id)),
    { pages, count: entries.length },
  );

  // 3. last_commit_id CAS
  const path = 'spike/000.lmr';
  const meta = await gl('GET', `/repository/files/${encodeURIComponent(path)}?ref=${branch}`);
  const lastCommit = meta.data.last_commit_id;
  record('files API exposes last_commit_id', !!lastCommit, lastCommit);
  const up = (id, content) =>
    gl('POST', '/repository/commits', {
      branch,
      commit_message: 'sync',
      actions: [{ action: 'update', file_path: path, content, last_commit_id: id }],
    });
  const u1 = await up(lastCommit, 'a');
  record('update with current last_commit_id succeeds', u1.res.status === 201, u1.res.status);
  const u2 = await up(lastCommit, 'b');
  record('update with stale last_commit_id is rejected', u2.res.status >= 400, {
    status: u2.res.status,
    message: u2.data?.message,
  });
  const dup = await gl('POST', '/repository/commits', {
    branch,
    commit_message: 'sync',
    actions: [{ action: 'create', file_path: path, content: 'c' }],
  });
  record('create of an existing file is rejected', dup.res.status >= 400, {
    status: dup.res.status,
    message: dup.data?.message,
  });

  // Concurrent updates of the same file with the same last_commit_id: exactly one wins.
  const cur = (await gl('GET', `/repository/files/${encodeURIComponent(path)}?ref=${branch}`)).data
    .last_commit_id;
  const race = await Promise.all([up(cur, 'x'), up(cur, 'y')]);
  record(
    'concurrent same-file updates: exactly one wins',
    race.filter((r) => r.res.status === 201).length === 1,
    race.map((r) => r.res.status),
  );

  // 4. Archive download
  t = performance.now();
  const arc = await gl('GET', `/repository/archive.tar.gz?sha=${branch}&path=spike`);
  record('archive download carries CORS header', corsOk(arc.res) && arc.res.ok, {
    status: arc.res.status,
    allowOrigin: arc.res.headers.get('access-control-allow-origin'),
    bytes: arc.data.byteLength,
    ms: Math.round(performance.now() - t),
  });
} finally {
  await gl('DELETE', `/repository/branches/${encodeURIComponent(branch)}`);
}
summary();
