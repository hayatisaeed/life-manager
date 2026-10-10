// P0.2 spike: sends the CORS preflights a browser would send for the
// requests the sync transports need, without credentials. This only shows
// whether the forge *allows* the cross-origin request; the authenticated
// parts of the GitHub/GitLab spikes (batch reads, CAS races) still need a test
// repo and token (LM_TEST_* env vars, AGENTS.md §7).
const ORIGIN = 'https://app.example';
const CASES = [
  ['github graphql', 'https://api.github.com/graphql', 'POST', 'authorization,content-type'],
  [
    'github git/trees',
    'https://api.github.com/repos/o/r/git/trees',
    'POST',
    'authorization,content-type',
  ],
  [
    'github git/refs',
    'https://api.github.com/repos/o/r/git/refs/heads/main',
    'PATCH',
    'authorization,content-type',
  ],
  ['gitlab tree', 'https://gitlab.com/api/v4/projects/1/repository/tree', 'GET', 'private-token'],
  [
    'gitlab commits',
    'https://gitlab.com/api/v4/projects/1/repository/commits',
    'POST',
    'private-token,content-type',
  ],
  [
    'gitlab archive',
    'https://gitlab.com/api/v4/projects/1/repository/archive.tar.gz',
    'GET',
    'private-token',
  ],
];

for (const [label, url, method, reqHeaders] of CASES) {
  try {
    const res = await fetch(url, {
      method: 'OPTIONS',
      headers: {
        Origin: ORIGIN,
        'Access-Control-Request-Method': method,
        'Access-Control-Request-Headers': reqHeaders,
      },
    });
    const h = (k) => res.headers.get(k);
    const ok =
      ['*', ORIGIN].includes(h('access-control-allow-origin') ?? '') &&
      (h('access-control-allow-methods') ?? '').toUpperCase().includes(method) &&
      reqHeaders
        .split(',')
        .every((x) => (h('access-control-allow-headers') ?? '').toLowerCase().includes(x));
    console.log(
      JSON.stringify({
        label,
        status: res.status,
        ok,
        allowOrigin: h('access-control-allow-origin'),
        allowMethods: h('access-control-allow-methods'),
        allowHeaders: h('access-control-allow-headers'),
        exposeHeaders: h('access-control-expose-headers'),
      }),
    );
  } catch (e) {
    console.log(JSON.stringify({ label, error: String(e?.cause?.message ?? e?.message ?? e) }));
  }
}
