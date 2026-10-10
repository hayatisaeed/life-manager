// A fetch-based HttpClient (web, and a fallback elsewhere).

import type { HttpClient, HttpRequest, HttpResponse } from './types';

export function makeResponse(
  status: number,
  headers: Record<string, string>,
  body: Uint8Array,
): HttpResponse {
  let text: string | undefined;
  return {
    status,
    headers,
    bytes: () => body,
    text: () => (text ??= new TextDecoder().decode(body)),
    json: <T>() => JSON.parse(text ?? (text = new TextDecoder().decode(body))) as T,
  };
}

export class HttpError extends Error {
  constructor(
    message: string,
    public readonly kind: 'network' | 'timeout',
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export function fetchHttpClient(f: typeof fetch = globalThis.fetch.bind(globalThis)): HttpClient {
  return {
    async request(req: HttpRequest): Promise<HttpResponse> {
      const ctrl = new AbortController();
      const timer = req.timeoutMs ? setTimeout(() => ctrl.abort(), req.timeoutMs) : undefined;
      try {
        const res = await f(req.url, {
          method: req.method ?? 'GET',
          headers: req.headers ?? {},
          body: (req.body ?? null) as BodyInit | null,
          signal: ctrl.signal,
          // Never send ambient cookies to forges/AI providers.
          credentials: 'omit',
          cache: 'no-store',
        });
        const headers: Record<string, string> = {};
        res.headers.forEach((v, k) => {
          headers[k.toLowerCase()] = v;
        });
        return makeResponse(res.status, headers, new Uint8Array(await res.arrayBuffer()));
      } catch (e) {
        if (ctrl.signal.aborted) throw new HttpError('Request timed out', 'timeout');
        throw new HttpError(e instanceof Error ? e.message : 'Network error', 'network');
      } finally {
        if (timer) clearTimeout(timer);
      }
    },
  };
}
