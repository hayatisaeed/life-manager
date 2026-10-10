// Shared helpers for the hand-written forge clients (TECH-STACK.md: no SDKs,
// explicit CORS behaviour).

import type { HttpClient, HttpRequest, HttpResponse } from '@lm/platform';
import { BlockedUrlError, isAllowedUrl } from '@lm/platform';
import type { RateLimitState } from '../transport';
import { ForgeError, RateLimitedError, SyncAuthError } from '../transport';

export function bytesToBase64(b: Uint8Array): string {
  let s = '';
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
}

export function base64ToBytes(t: string): Uint8Array {
  const s = atob(t.replace(/\s/g, ''));
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

export const COMMIT_AUTHOR = { name: 'Life Manager', email: 'noreply@invalid' } as const;
export const COMMIT_MESSAGE = 'sync';

export class ForgeHttp {
  rate: RateLimitState = { remaining: null, resetAt: null };

  constructor(
    private readonly http: HttpClient,
    private readonly authHeaders: Record<string, string>,
    private readonly rateHeaders: { remaining: string; reset: string },
  ) {}

  async send(
    req: HttpRequest,
    ok: (status: number) => boolean = (s) => s >= 200 && s < 300,
  ): Promise<HttpResponse> {
    if (!isAllowedUrl(req.url, 'forge')) throw new BlockedUrlError('forge');
    const res = await this.http.request({
      ...req,
      timeoutMs: req.timeoutMs ?? 60_000,
      headers: { ...this.authHeaders, ...req.headers },
    });
    const rem = res.headers[this.rateHeaders.remaining];
    const reset = res.headers[this.rateHeaders.reset];
    if (rem !== undefined) this.rate.remaining = Number(rem);
    if (reset !== undefined) this.rate.resetAt = Number(reset) * 1000;
    if (ok(res.status)) return res;
    if (res.status === 401) throw new SyncAuthError();
    if (res.status === 429 || (res.status === 403 && this.rate.remaining === 0)) {
      throw new RateLimitedError(this.rate.resetAt);
    }
    let msg = `HTTP ${res.status}`;
    try {
      const body = res.json<{ message?: unknown }>();
      if (body && typeof body.message === 'string') msg = body.message;
      else if (body && body.message) msg = JSON.stringify(body.message);
    } catch {
      /* non-JSON error body */
    }
    if (res.status === 403) throw new SyncAuthError(`The token lacks permission: ${msg}`);
    throw new ForgeError(msg, res.status);
  }
}

export async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (t: T) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (i < items.length) {
        const idx = i++;
        out[idx] = await fn(items[idx] as T);
      }
    }),
  );
  return out;
}
