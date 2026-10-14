export interface HttpRequest {
  method: 'GET' | 'POST' | 'PATCH' | 'HEAD';
  headers: Record<string, string>;
  body?: string;
}
export interface HttpResponse {
  status: number;
  headers: Record<string, string>;
  body: Uint8Array;
}
export interface Http {
  request(url: string, input: HttpRequest): Promise<HttpResponse>;
}
/** SECURITY.md §6: explicit configured HTTPS origins; credentials never follow redirects. */
export function createWebHttp(configuredOrigins: string[], request: typeof fetch = fetch): Http {
  const allowed = new Set(
    configuredOrigins.map((origin) => {
      const url = new URL(origin);
      if (url.protocol !== 'https:' || url.origin !== origin || url.username || url.password)
        throw new Error('Invalid configured network origin');
      return origin;
    }),
  );
  return {
    request: async (url, input) => {
      const target = new URL(url);
      if (
        !allowed.has(target.origin) ||
        target.protocol !== 'https:' ||
        target.username ||
        target.password
      )
        throw new Error('Network destination not configured');
      try {
        const response = await request(target, {
          method: input.method,
          headers: input.headers,
          ...(input.body === undefined ? {} : { body: input.body }),
          credentials: 'omit',
          redirect: 'error',
          cache: 'no-store',
          referrerPolicy: 'no-referrer',
          signal: AbortSignal.timeout(30000),
        });
        return {
          status: response.status,
          headers: Object.fromEntries(response.headers.entries()),
          body: new Uint8Array(await response.arrayBuffer()),
        };
      } catch {
        throw new Error('Configured network request failed');
      }
    },
  };
}
