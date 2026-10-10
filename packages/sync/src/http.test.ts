import { describe, expect, it } from 'vitest';
import { RateLimitTracker, encodePath, errorMessage, mapLimit, toBase64 } from './http';

describe('forge HTTP helpers', () => {
  it('base64-encodes data larger than one chunk', () => {
    const data = Uint8Array.from({ length: 0x8000 * 2 + 5 }, (_, i) => i % 256);
    const back = Uint8Array.from(atob(toBase64(data)), (c) => c.charCodeAt(0));
    expect(back).toEqual(data);
  });

  it('keeps result order and the concurrency limit', async () => {
    let inFlight = 0;
    let peak = 0;
    const out = await mapLimit([5, 1, 3, 2, 4], 2, async (n) => {
      peak = Math.max(peak, ++inFlight);
      await new Promise((r) => setTimeout(r, n));
      inFlight--;
      return n * 10;
    });
    expect(out).toEqual([50, 10, 30, 20, 40]);
    expect(peak).toBe(2);
    expect(await mapLimit([], 4, () => Promise.resolve(1))).toEqual([]);
  });

  it('reads error messages defensively', async () => {
    expect(await errorMessage(new Response('{"message":"no"}'))).toBe('no');
    expect(await errorMessage(new Response('{"message":{"a":1}}'))).toBe('{"a":1}');
    expect(await errorMessage(new Response('{}'))).toBe('');
    expect(await errorMessage(new Response('<html>'))).toBe('');
  });

  it('reports the tightest live rate-limit window', () => {
    let now = 0;
    const limits = new RateLimitTracker(() => now);
    limits.update('core', 100, 1000);
    limits.update('graphql', 20, null);
    limits.update('search', null, 5);
    expect(limits.current()).toEqual({ remaining: 20, resetAt: null });
    limits.update('graphql', 500, 2000);
    expect(limits.current()).toEqual({ remaining: 100, resetAt: 1000 });
    now = 1500;
    expect(limits.current()).toEqual({ remaining: 500, resetAt: 2000 });
    expect(encodePath('a b/c#d')).toBe('a%20b/c%23d');
  });
});
