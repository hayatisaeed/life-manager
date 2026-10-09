// Starts the spike page with and without COOP/COEP and drives it with headless Chromium.
// Usage: pnpm --filter @lm/spike-web-runtime spike   (prints JSON results)
import { createServer } from 'vite';
import { chromium } from '@playwright/test';

const ISOLATED = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
};

async function withServer(port, headers, fn) {
  const server = await createServer({
    root: import.meta.dirname,
    server: { port, headers },
    logLevel: 'warn',
  });
  await server.listen();
  try {
    return await fn(`http://localhost:${port}`);
  } finally {
    await server.close();
  }
}

async function runPage(context, url) {
  const page = await context.newPage();
  await page.goto(url);
  await page.waitForFunction(() => window.__result, null, { timeout: 300_000 });
  const result = await page.evaluate(() => window.__result);
  await page.close();
  return result;
}

const executablePath = process.env.PW_CHROMIUM_PATH;
const browser = await chromium.launch(executablePath ? { executablePath } : {});
const results = {};

for (const [label, headers, port] of [
  ['cross-origin-isolated', ISOLATED, 5181],
  ['no-isolation (GitHub Pages-like)', {}, 5182],
]) {
  results[label] = await withServer(port, headers, async (base) => {
    const out = {};
    // `+cache` runs repeat the benchmark with a 32 MiB page cache instead of SQLite's
    // default 2 MiB, to see how much of the read cost is storage round trips.
    for (const variant of ['memory', 'opfs', 'opfs-sahpool', 'opfs+cache', 'opfs-sahpool+cache']) {
      const [vfs, cache] = variant.split('+');
      const q = `job=sqlite&vfs=${vfs}${cache ? '&cacheKiB=32768' : ''}`;
      // One context per VFS so each starts with an empty OPFS and the reload check
      // shares the same origin storage as the benchmark run.
      const context = await browser.newContext();
      const bench = await runPage(context, `${base}/?${q}&phase=bench`);
      const verify =
        bench.ok && vfs !== 'memory' ? await runPage(context, `${base}/?${q}&phase=verify`) : null;
      out[variant] = { bench, verify };
      await context.close();
    }
    return out;
  });
}

results.argon2 = await withServer(5183, {}, async (base) => {
  const context = await browser.newContext();
  // CDP CPU throttling only affects the page's main thread, not workers, so it can't
  // stand in for a phone here; Android needs a real device.
  const desktop = await runPage(context, `${base}/?job=argon2&mem=64,128,256`);
  await context.close();
  return desktop;
});

await browser.close();
console.log(JSON.stringify(results, null, 2));
