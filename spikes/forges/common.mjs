// Helpers shared by the forge spikes. Node's fetch lets us set `Origin`, so we
// can read the CORS headers a browser would get without running a browser.
export const ORIGIN = 'https://lm-spike.invalid';

export function env(name) {
  const v = process.env[name];
  if (!v) {
    console.error(
      `Set ${name} (see spikes/README.md). Use a throwaway test repo, never a real data repo.`,
    );
    process.exit(2);
  }
  return v;
}

export async function preflight(url, method, headers) {
  const res = await fetch(url, {
    method: 'OPTIONS',
    headers: {
      origin: ORIGIN,
      'access-control-request-method': method,
      'access-control-request-headers': headers.join(','),
    },
  });
  return {
    status: res.status,
    allowOrigin: res.headers.get('access-control-allow-origin'),
    allowHeaders: res.headers.get('access-control-allow-headers'),
    allowMethods: res.headers.get('access-control-allow-methods'),
  };
}

export function corsOk(res) {
  const o = res.headers.get('access-control-allow-origin');
  return o === '*' || o === ORIGIN;
}

export const results = [];
export function record(name, ok, detail) {
  results.push({ name, ok, ...(detail === undefined ? {} : { detail }) });
  console.error(
    `${ok ? 'PASS' : 'FAIL'} ${name}${detail === undefined ? '' : ' ' + JSON.stringify(detail)}`,
  );
}
export function summary() {
  console.log(JSON.stringify(results, null, 2));
  process.exitCode = results.every((r) => r.ok) ? 0 : 1;
}

export const rand = () => Math.random().toString(36).slice(2, 10);
