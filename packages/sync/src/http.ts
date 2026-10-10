import type { z } from 'zod';
import { AuthError, RateLimitedError, type RateLimitState } from './transport';

// Shared plumbing for the forge transports (SYNC.md §7, §10). The transports
// never call the global fetch: the shell passes platform.http, which is
// native HTTP on Tauri and Capacitor.

/** The subset of `fetch` the transports use. */
export type Fetch = (url: string, init: RequestInit) => Promise<Response>;

/**
 * An HTTP failure the engine reports as `error`. The message names the
 * operation and the status only: never the URL's query, the token or a body.
 */
export class ForgeHttpError extends Error {
  override name = 'ForgeHttpError';
  constructor(
    readonly status: number,
    what: string,
  ) {
    super(`${what} failed with HTTP ${String(status)}`);
  }
}

/** The forge answered with something that doesn't match its documented shape. */
export class ForgeResponseError extends Error {
  override name = 'ForgeResponseError';
  constructor(what: string) {
    super(`${what}: unexpected response from the forge`);
  }
}

/** Remembers the lowest remaining budget the forge reported, per resource. */
export class RateLimitTracker {
  private readonly byResource = new Map<string, { remaining: number; resetAt: number | null }>();

  constructor(private readonly now: () => number) {}

  update(resource: string, remaining: number | null, resetAt: number | null): void {
    if (remaining === null || Number.isNaN(remaining)) return;
    this.byResource.set(resource, { remaining, resetAt });
  }

  /** When the forge refused: the reset time it gave, or the latest one we know. */
  resetAt(resource: string): number | null {
    return this.byResource.get(resource)?.resetAt ?? null;
  }

  /** The tightest window that hasn't reset yet; the engine skips a cycle on it. */
  current(): RateLimitState {
    let worst: RateLimitState = { remaining: null, resetAt: null };
    for (const s of this.byResource.values()) {
      if (s.resetAt !== null && s.resetAt <= this.now()) continue;
      if (worst.remaining === null || s.remaining < worst.remaining) worst = s;
    }
    return worst;
  }
}

/** Seconds-since-epoch or seconds-from-now header → ms since the epoch. */
export function headerNumber(res: Response, name: string): number | null {
  const v = res.headers.get(name);
  if (v === null || v.trim() === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * The error statuses every forge shares (SYNC.md §10): 401 is a bad token,
 * 429 or an exhausted 403 is the rate limit, any other 403 is a token without
 * the needed permission. Returns normally for anything else.
 */
export function throwForAuthOrLimit(
  res: Response,
  limited: { exhausted: boolean; resetAt: number | null },
): void {
  if (res.status === 401) throw new AuthError('the forge rejected the access token');
  if (res.status === 429 || (res.status === 403 && limited.exhausted))
    throw new RateLimitedError(limited.resetAt);
  if (res.status === 403)
    throw new AuthError('the access token lacks permission for this repository');
}

/** Parses a JSON body against a schema; a mismatch is a ForgeResponseError. */
export async function json<T>(res: Response, schema: z.ZodType<T>, what: string): Promise<T> {
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    throw new ForgeResponseError(what);
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new ForgeResponseError(what);
  return parsed.data;
}

/** The JSON body's `message`, if it has one (GitLab puts error reasons there). */
export async function errorMessage(res: Response): Promise<string> {
  try {
    const body: unknown = await res.json();
    if (typeof body === 'object' && body !== null && 'message' in body) {
      const m = body.message;
      return typeof m === 'string' ? m : JSON.stringify(m);
    }
  } catch {
    // No JSON body: there is no message to read.
  }
  return '';
}

export async function bytes(res: Response): Promise<Uint8Array> {
  return new Uint8Array(await res.arrayBuffer());
}

export function toBase64(data: Uint8Array): string {
  let s = '';
  // btoa takes a binary string; build it in chunks so large blobs don't
  // overflow the argument limit of String.fromCharCode.
  for (let i = 0; i < data.length; i += 0x8000) {
    s += String.fromCharCode(...data.subarray(i, i + 0x8000));
  }
  return btoa(s);
}

/** Runs `fn` over `items` with at most `limit` in flight; results keep their order. */
export async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i] as T);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

/** Encodes each segment of a path for a URL, keeping the slashes. */
export function encodePath(path: string): string {
  return path.split('/').map(encodeURIComponent).join('/');
}

export const COMMIT_MESSAGE = 'sync';
/** The only identity on commits (SYNC.md §1): nothing that names a device or person. */
export const COMMIT_AUTHOR = { name: 'Life Manager', email: 'noreply@invalid' } as const;
