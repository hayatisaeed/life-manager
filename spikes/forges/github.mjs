// P0.2 GitHub spike (SYNC.md §7, GitHub): CORS (REST + GraphQL), empty-repo
// bootstrap, GraphQL batch read of 100 blobs, locally computed blob SHAs,
// deletes, binary blobs, and tree → commit → ref CAS with force:false.
//
// If the repo is empty, it first creates `lm-spike.json` on the default branch
// (an empty repo is the onboarding case, so how that works is part of the
// spike). Everything else happens on a scratch branch `lm-spike-<random>`,
// deleted at the end. Env: LM_TEST_GITHUB_TOKEN, LM_TEST_GITHUB_REPO
// (owner/name), optional LM_TEST_GITHUB_API (default https://api.github.com).
// Writes the summary to stdout and to forges/github-result.json.
import { createHash, randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { ORIGIN, env, preflight, corsOk, record, results, rand } from './common.mjs';

const token = env('LM_TEST_GITHUB_TOKEN');
const repo = env('LM_TEST_GITHUB_REPO');
const api = process.env.LM_TEST_GITHUB_API ?? 'https://api.github.com';
const base = `${api}/repos/${repo}`;
const AUTHOR = { name: 'Life Manager', email: 'noreply@invalid' };

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

// git's blob id: SHA-1 over "blob <len>\0" + content. SYNC.md §5 relies on
// computing this locally after a push instead of re-reading the tree.
const gitBlobSha = (buf) =>
  createHash('sha1')
    .update(Buffer.concat([Buffer.from(`blob ${buf.length}\0`), buf]))
    .digest('hex');

// A record path as SYNC.md §1 lays it out, with `.lmr` text content.
function lmrFile() {
  const name = randomBytes(32).toString('hex');
  const content = `LMR1.${randomBytes(24 + 200).toString('base64url')}`;
  return {
    path: `r/${name.slice(0, 2)}/${name.slice(2, 4)}/${name}.lmr`,
    content,
    sha: gitBlobSha(Buffer.from(content)),
  };
}
const inline = (f) => ({ path: f.path, mode: '100644', type: 'blob', content: f.content });

async function commitOn(parent, baseTree, entries) {
  const tr = await gh('POST', '/git/trees', { base_tree: baseTree, tree: entries });
  if (!tr.res.ok) throw new Error(`POST tree ${tr.res.status} ${tr.json?.message}`);
  const c = await gh('POST', '/git/commits', {
    message: 'sync',
    tree: tr.json.sha,
    parents: [parent],
    author: AUTHOR,
  });
  if (!c.res.ok) throw new Error(`POST commit ${c.res.status} ${c.json?.message}`);
  return { sha: c.json.sha, tree: tr.json.sha, commit: c.json };
}

const run = async () => {
  // 1. CORS
  const pf = await preflight(`${base}/git/refs/heads/x`, 'PATCH', [
    'authorization',
    'content-type',
    'x-github-api-version',
  ]);
  record('REST preflight allows PATCH + authorization', pf.status < 300 && !!pf.allowOrigin, pf);
  const pfg = await preflight(`${api}/graphql`, 'POST', ['authorization', 'content-type']);
  record(
    'GraphQL preflight allows POST + authorization',
    pfg.status < 300 && !!pfg.allowOrigin,
    pfg,
  );

  const { res: repoRes, json: repoJson } = await gh('GET', '');
  if (!repoRes.ok) throw new Error(`GET repo ${repoRes.status} ${repoJson?.message}`);
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
    {
      limit: repoRes.headers.get('x-ratelimit-limit'),
      resource: repoRes.headers.get('x-ratelimit-resource'),
    },
  );
  record(
    'repo is private and token can push',
    repoJson.private && repoJson.permissions?.push === true,
    {
      private: repoJson.private,
      push: repoJson.permissions?.push,
    },
  );
  const defaultBranch = repoJson.default_branch;

  // 2. Empty repo: the onboarding case (SYNC.md §8). Record what the git data
  // API does, then bootstrap the first commit with the contents API.
  let head = await gh('GET', `/git/ref/heads/${defaultBranch}`);
  if (!head.res.ok) {
    const blobOnEmpty = await gh('POST', '/git/blobs', { content: 'x', encoding: 'utf-8' });
    const treeOnEmpty = await gh('POST', '/git/trees', {
      tree: [{ path: 'lm.json', mode: '100644', type: 'blob', content: '{}' }],
    });
    record('empty repo: git data API behavior recorded', true, {
      getRef: [head.res.status, head.json?.message],
      createBlob: [blobOnEmpty.res.status, blobOnEmpty.json?.message],
      createTree: [treeOnEmpty.res.status, treeOnEmpty.json?.message],
    });
    const put = await gh('PUT', '/contents/lm-spike.json', {
      message: 'sync',
      content: Buffer.from('{"format":"life-manager-spike"}').toString('base64'),
      branch: defaultBranch,
      author: AUTHOR,
      committer: AUTHOR,
    });
    record('empty repo: contents API creates the first commit', put.res.status === 201, {
      status: put.res.status,
      message: put.json?.message,
      author: put.json?.commit?.author,
      committer: put.json?.commit?.committer,
    });
    head = await gh('GET', `/git/ref/heads/${defaultBranch}`);
  } else {
    record('empty repo: skipped (repo already has commits)', true);
  }

  // 3. Scratch branch from the default branch head
  const branch = `lm-spike-${rand()}`;
  const ref = `/git/refs/heads/${branch}`;
  const move = (sha) => gh('PATCH', ref, { sha, force: false });
  await gh('POST', '/git/refs', { ref: `refs/heads/${branch}`, sha: head.json.object.sha });

  try {
    const { json: parentCommit } = await gh('GET', `/git/commits/${head.json.object.sha}`);

    // 4. One commit with 100 inline .lmr records in the sharded layout
    const files = Array.from({ length: 100 }, lmrFile);
    let t = performance.now();
    const c1 = await commitOn(head.json.object.sha, parentCommit.tree.sha, files.map(inline));
    const upd = await move(c1.sha);
    record('tree+commit+ref with 100 inline files', upd.res.ok, {
      ms: Math.round(performance.now() - t),
      author: c1.commit.author,
      committer: c1.commit.committer,
    });

    // 5. Locally computed blob SHAs match the tree
    const { json: newTree } = await gh('GET', `/git/trees/${c1.tree}?recursive=1`);
    const remote = new Map(newTree.tree.map((e) => [e.path, e.sha]));
    const mismatches = files.filter((f) => remote.get(f.path) !== f.sha).length;
    record('local git blob SHA matches the tree for 100 files', mismatches === 0, {
      mismatches,
      truncated: newTree.truncated,
    });

    // 6. GraphQL batch read of the 100 blobs
    const [owner, name] = repo.split('/');
    const fields = files
      .map((f, i) => `b${i}: object(oid: "${f.sha}") { ... on Blob { text isBinary byteSize } }`)
      .join('\n');
    t = performance.now();
    const gql = await gh('POST', `${api}/graphql`, {
      query: `query { repository(owner: "${owner}", name: "${name}") { ${fields} } rateLimit { cost remaining limit } }`,
    });
    const data = gql.json?.data?.repository ?? {};
    const same = files.filter((f, i) => data[`b${i}`]?.text === f.content).length;
    record('GraphQL batch read of 100 blobs', same === 100 && corsOk(gql.res), {
      ms: Math.round(performance.now() - t),
      matching: same,
      rateLimit: gql.json?.data?.rateLimit,
      errors: gql.json?.errors,
    });

    // 7. Binary .lmb blob: upload as base64, read back, local SHA
    const bin = Buffer.concat([Buffer.from('LMB1'), randomBytes(24 + 256 * 1024)]);
    t = performance.now();
    const blob = await gh('POST', '/git/blobs', {
      content: bin.toString('base64'),
      encoding: 'base64',
    });
    const back = await gh('GET', `/git/blobs/${blob.json?.sha}`);
    record(
      'binary blob round trip (256 KiB)',
      blob.json?.sha === gitBlobSha(bin) &&
        Buffer.from(back.json?.content ?? '', 'base64').equals(bin),
      { ms: Math.round(performance.now() - t), status: blob.res.status },
    );
    const gqlBin = await gh('POST', `${api}/graphql`, {
      query: `query { repository(owner: "${owner}", name: "${name}") { b: object(oid: "${blob.json?.sha}") { ... on Blob { text isBinary } } } }`,
    });
    record(
      'GraphQL marks binary blobs (so .lmb must use REST)',
      true,
      gqlBin.json?.data?.repository?.b,
    );

    // 8. Delete a record (sha: null) and add the binary blob in one commit
    const gone = files[1].path;
    const binPath = `b/${randomBytes(1).toString('hex')}/${randomBytes(1).toString('hex')}/${randomBytes(32).toString('hex')}.lmb`;
    const c2 = await commitOn(c1.sha, c1.tree, [
      { path: gone, mode: '100644', type: 'blob', sha: null },
      { path: binPath, mode: '100644', type: 'blob', sha: blob.json?.sha },
    ]);
    const upd2 = await move(c2.sha);
    const { json: t2 } = await gh('GET', `/git/trees/${c2.tree}?recursive=1`);
    const paths = new Set(t2.tree.map((e) => e.path));
    record(
      'delete via sha:null + add blob by sha',
      upd2.res.ok && !paths.has(gone) && paths.has(binPath),
      {
        emptyDirRemoved: !paths.has(gone.split('/').slice(0, 3).join('/')),
      },
    );

    // 9. CAS race: two commits with the same parent; the second update must 422.
    const mk = async (parent, parentTree) =>
      (await commitOn(parent, parentTree, [inline(lmrFile())])).sha;
    const [a, b] = await Promise.all([mk(c2.sha, c2.tree), mk(c2.sha, c2.tree)]);
    const ua = await move(a);
    const ub = await move(b);
    record('first racer wins', ua.res.status === 200, ua.res.status);
    record('second racer gets 422', ub.res.status === 422, {
      status: ub.res.status,
      message: ub.json?.message,
    });

    // 10. Stale parent: a device synced at X while the branch moved on to a
    // descendant Y. Its commit on X must be rejected, not fast-forwarded.
    const { json: aCommit } = await gh('GET', `/git/commits/${a}`);
    const y = await mk(a, aCommit.tree.sha);
    await move(y);
    const stale = await mk(a, aCommit.tree.sha);
    const us = await move(stale);
    record('commit on a stale (ancestor) parent gets 422', us.res.status === 422, us.res.status);

    // 11. Concurrent variant: valid fast-forwards of the current head sent at
    // once. Exactly one may win each round; the other must see 422.
    let cur = y;
    const rounds = [];
    for (let i = 0; i < 5; i++) {
      const { json: cc } = await gh('GET', `/git/commits/${cur}`);
      const [p, q] = await Promise.all([mk(cur, cc.tree.sha), mk(cur, cc.tree.sha)]);
      const both = await Promise.all([move(p), move(q)]);
      const now = await gh('GET', ref);
      const winner = both[0].res.status === 200 ? p : q;
      rounds.push({
        statuses: both.map((r) => r.res.status).sort(),
        headIsWinner: now.json.object.sha === winner,
      });
      cur = now.json.object.sha;
    }
    record(
      'concurrent fast-forwards: exactly one wins (5 rounds)',
      rounds.every((r) => r.statuses[0] === 200 && r.statuses[1] === 422 && r.headIsWinner),
      rounds,
    );

    const rl = await gh('GET', `${api}/rate_limit`);
    record('rate limits after run', true, {
      core: rl.json?.resources?.core,
      graphql: rl.json?.resources?.graphql,
    });
  } finally {
    await gh('DELETE', ref);
  }
};

try {
  await run();
} catch (e) {
  record('spike crashed', false, String(e?.message ?? e));
}
const out = { ranAt: new Date().toISOString(), node: process.version, results };
writeFileSync(
  new URL('./github-result.json', import.meta.url),
  JSON.stringify(out, null, 2) + '\n',
);
console.log(JSON.stringify(out, null, 2));
process.exitCode = results.every((r) => r.ok) ? 0 : 1;
