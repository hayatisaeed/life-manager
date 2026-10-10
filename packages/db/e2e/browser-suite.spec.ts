import { expect, test } from '@playwright/test';

interface Result {
  name: string;
  ok: boolean;
  error?: string;
}

test('repository suite passes through the web worker on OPFS', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await page.waitForFunction(() => 'window' in globalThis && '__results' in window, null, {
    timeout: 60_000,
  });
  const results = await page.evaluate(
    () => (window as unknown as { __results: Result[] }).__results,
  );
  expect(errors).toEqual([]);
  expect(results.length).toBeGreaterThan(10);
  for (const r of results) expect(r, r.error).toMatchObject({ ok: true });
});
