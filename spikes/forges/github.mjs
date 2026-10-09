// P0.2 GitHub spike: CORS (REST + GraphQL), GraphQL batch read of 100 blobs,
// and tree → commit → ref CAS with force:false (422 on a race).
// Works on a scratch branch `lm-spike-<random>` in LM_TEST_GITHUB_REPO and
// deletes it at the end. Env: LM_TEST_GITHUB_TOKEN, LM_TEST_GITHUB_REPO (owner/name),
// optional LM_TEST_GITHUB_API (default https://api.github.com).
import { ORIGIN, env, preflight, corsOk, record, summary, rand } from './common.mjs';

const token = env('LM_TEST_GITHUB_TOKEN');
const repo = env('LM_TEST_GITHUB_REPO');
const api = process.env.LM_TEST_GITHUB_API ?? 'https://api.github.com';
const base = `${api}/repos/${repo}`;

async function gh(method, path, body) {
  const res = await fetch(path.startsWith('http') ? path : `${base}${path}`, {
    method,
    headers: {
      origin: ORIGIN,
      authorization: `Bearer ${token}`,
      accept: 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28',
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const json = res.status === 204 ? null : await res.json().catch(() => null);
  return { res, json };
}

// 1. CORS
const pf = await preflight(`${base}/git/refs/heads/x`, 'PATCH', [
  'authorization',
  'content-type',
  'x-github-api-version',
]);
record('REST preflight allows PATCH + authorization', pf.status < 300 && !!pf.allowOrigin, pf);
const pfg = await preflight(`${api}/graphql`, 'POST', ['authorization', 'content-type']);
record('GraphQL preflight allows POST + authorization', pfg.status < 300 && !!pfg.allowOrigin, pfg);

const { res: repoRes, json: repoJson } = await gh('GET', '');
record(
  'REST response carries CORS header',
  corsOk(repoRes),
  repoRes.headers.get('access-control-allow-origin'),
);
record(
  'rate-limit headers exposed',
  !!repoRes.headers
    .get('access-control-expose-headers')
    ?.toLowerCase()
    .includes('x-ratelimit-remaining'),
);
const defaultBranch = repoJson.default_branch;

// 2. Scratch branch from the default branch head
const { json: head } = await gh('GET', `/git/ref/heads/${defaultBranch}`);
const branch = `lm-spike-${rand()}`;
await gh('POST', '/git/refs', { ref: `refs/heads/${branch}`, sha: head.object.sha });

try {
  const { json: parentCommit } = await gh('GET', `/git/commits/${head.object.sha}`);

  // 3. One commit with 100 inline text files (like .lmr records)
  const files = Array.from({ length: 100 }, (_, i) => ({
    path: `spike/${String(i).padStart(3, '0')}.lmr`,
    mode: '100644',
    type: 'blob',
    content: Buffer.from(`record ${i} ${rand()}`).toString('base64'),
  }));
  let t = performance.now();
  const { json: tree } = await gh('POST', '/git/trees', {
    base_tree: parentCommit.tree.sha,
    tree: files,
  });
  const { json: c1 } = await gh('POST', '/git/commits', {
    message: 'sync',
    tree: tree.sha,
    parents: [head.object.sha],
  });
  const upd = await gh('PATCH', `/git/refs/heads/${branch}`, { sha: c1.sha, force: false });
  record('tree+commit+ref with 100 inline files', upd.res.ok, {
    ms: Math.round(performance.now() - t),
  });

  // 4. GraphQL batch read of the 100 blobs
  const { json: newTree } = await gh('GET', `/git/trees/${tree.sha}?recursive=1`);
  const blobs = newTree.tree.filter((e) => e.path.startsWith('spike/') && e.type === 'blob');
  const [owner, name] = repo.split('/');
  const fields = blobs
    .map((b, i) => `b${i}: object(oid: "${b.sha}") { ... on Blob { text isBinary byteSize } }`)
    .join('\n');
  t = performance.now();
  const gql = await gh('POST', `${api}/graphql`, {
    query: `query { repository(owner: "${owner}", name: "${name}") { ${fields} } rateLimit { cost remaining } }`,
  });
  const got = Object.values(gql.json?.data?.repository ?? {}).filter(
    (v) => typeof v?.text === 'string',
  );
  record('GraphQL batch read of 100 blobs', got.length === 100 && corsOk(gql.res), {
    ms: Math.round(performance.now() - t),
    rateLimit: gql.json?.data?.rateLimit,
    errors: gql.json?.errors,
  });

  // 5. CAS race: two commits with the same parent; the second update must 422.
  const mk = async (tag, parent) => {
    const { json: tr } = await gh('POST', '/git/trees', {
      base_tree: tree.sha,
      tree: [{ path: `spike/race-${tag}.lmr`, mode: '100644', type: 'blob', content: tag }],
    });
    const { json: c } = await gh('POST', '/git/commits', {
      message: 'sync',
      tree: tr.sha,
      parents: [parent],
    });
    return c.sha;
  };
  const [a, b] = await Promise.all([mk('a', c1.sha), mk('b', c1.sha)]);
  const ua = await gh('PATCH', `/git/refs/heads/${branch}`, { sha: a, force: false });
  const ub = await gh('PATCH', `/git/refs/heads/${branch}`, { sha: b, force: false });
  record('first racer wins', ua.res.status === 200, ua.res.status);
  record('second racer gets 422', ub.res.status === 422, {
    status: ub.res.status,
    message: ub.json?.message,
  });

  // Concurrent variant: two valid fast-forwards of the current head, sent at
  // once. Exactly one may win; the other must see 422.
  const [p, q] = await Promise.all([mk('p', a), mk('q', a)]);
  const both = await Promise.all([
    gh('PATCH', `/git/refs/heads/${branch}`, { sha: p, force: false }),
    gh('PATCH', `/git/refs/heads/${branch}`, { sha: q, force: false }),
  ]);
  const statuses = both.map((r) => r.res.status).sort();
  record(
    'concurrent fast-forwards: exactly one wins',
    statuses[0] === 200 && statuses[1] === 422,
    statuses,
  );
} finally {
  await gh('DELETE', `/git/refs/heads/${branch}`);
}
summary();
