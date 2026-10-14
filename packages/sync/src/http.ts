import type { z } from 'zod';
import { createCrypto } from '@lm/crypto';
import type { Http, HttpResponse, SecretStore } from '@lm/platform';
import { SyncError } from './transport';
import type { RateLimitState, FileChange } from './transport';
export interface TransportOptions {
  http: Http;
  secrets: SecretStore;
  tokenName: string;
  apiBase: string;
  branch: string;
  now?: () => number;
}
export async function forgeClient(options: TransportOptions, provider: 'github' | 'gitlab') {
  const crypto = await createCrypto();
  const base = new URL(options.apiBase);
  if (base.protocol !== 'https:' || base.username || base.password || base.search || base.hash)
    throw new Error('Invalid configured forge URL');
  const rate: RateLimitState = { remaining: null, resetAt: null };
  const apiBase = options.apiBase.replace(/\/$/, '');
  async function request(
    path: string,
    method: 'GET' | 'POST' | 'PATCH' | 'HEAD' = 'GET',
    body?: unknown,
  ): Promise<HttpResponse> {
    const token = await options.secrets.get(options.tokenName);
    if (!token) throw new SyncError('authentication');
    if (!path.startsWith('/') || path.startsWith('//')) throw new SyncError('invalid-remote');
    let response: HttpResponse;
    try {
      response = await options.http.request(`${apiBase}${path}`, {
        method,
        headers:
          provider === 'github'
            ? {
                Authorization: `Bearer ${token}`,
                Accept: 'application/vnd.github+json',
                'X-GitHub-Api-Version': '2026-03-10',
                ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
              }
            : {
                'PRIVATE-TOKEN': token,
                ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
              },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch {
      throw new SyncError('network');
    }
    const numeric = (name: string) => {
      const value = response.headers[name.toLowerCase()];
      if (value === undefined || !/^\d+$/.test(value)) return null;
      const number = Number(value);
      return Number.isSafeInteger(number) ? number : null;
    };
    const remaining = numeric(
      provider === 'github' ? 'x-ratelimit-remaining' : 'ratelimit-remaining',
    );
    const reset = numeric(provider === 'github' ? 'x-ratelimit-reset' : 'ratelimit-reset');
    if (remaining !== null) rate.remaining = remaining;
    if (reset !== null) rate.resetAt = reset * 1000;
    if (
      response.status === 401 ||
      (response.status === 403 && remaining !== 0 && numeric('retry-after') === null)
    )
      throw new SyncError('authentication');
    if (
      response.status === 429 ||
      (response.status === 403 && (remaining === 0 || numeric('retry-after') !== null))
    )
      throw new SyncError(
        'rate-limit',
        rate.resetAt ??
          (numeric('retry-after') === null
            ? undefined
            : (options.now ?? Date.now)() + (numeric('retry-after') ?? 0) * 1000),
      );
    if (response.status >= 500) throw new SyncError('network');
    return response;
  }
  const json = <T>(response: HttpResponse, schema: z.ZodType<T>): T => {
    if (response.status < 200 || response.status >= 300) throw new SyncError('invalid-remote');
    try {
      return schema.parse(JSON.parse(crypto.decodeUtf8(response.body)));
    } catch {
      throw new SyncError('invalid-remote');
    }
  };
  return { request, json, crypto, rateLimit: () => ({ ...rate }) };
}
export function validateChanges(changes: FileChange[]) {
  if (
    !changes.length ||
    !changes.some((file) => file.path === 'lm.json') ||
    new Set(changes.map((file) => file.path)).size !== changes.length
  )
    throw new SyncError('invalid-remote');
  for (const change of changes) {
    if (change.path === 'lm.json') continue;
    const match = /^([rb])\/([0-9a-f]{2})\/([0-9a-f]{2})\/([0-9a-f]{64})\.lm([rb])$/.exec(
      change.path,
    );
    if (
      !match ||
      match[1] !== match[5] ||
      match[2] !== match[4]?.slice(0, 2) ||
      match[3] !== match[4]?.slice(2, 4)
    )
      throw new SyncError('invalid-remote');
  }
}
export async function boundedMap<T, R>(
  items: T[],
  count: number,
  run: (item: T) => Promise<R>,
): Promise<R[]> {
  const result = new Array<R>(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(count, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        const item = items[i];
        if (item === undefined) throw new Error('Missing batch item');
        result[i] = await run(item);
      }
    }),
  );
  return result;
}
