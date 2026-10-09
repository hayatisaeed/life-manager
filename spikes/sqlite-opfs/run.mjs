// Serves this folder with COOP/COEP (needed for the `opfs` VFS) and runs the
// spike in headless Chromium. Usage: node sqlite-opfs/run.mjs [rows]
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const root = fileURLToPath(new URL('..', import.meta.url));
const types = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.wasm': 'application/wasm',
};
const server = createServer(async (req, res) => {
  const path = normalize(new URL(req.url, 'http://x').pathname);
  const file = join(root, path === '/' ? 'sqlite-opfs/index.html' : path);
  try {
    const body = await readFile(file);
    res.writeHead(200, {
      'content-type': types[extname(file)] ?? 'application/octet-stream',
      'cross-origin-opener-policy': 'same-origin',
      'cross-origin-embedder-policy': 'require-corp',
    });
    res.end(body);
  } catch {
    console.error('404', req.url);
    res.writeHead(404).end();
  }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const { port } = server.address();
const rows = Number(process.argv[2] ?? 50000);

const browser = await chromium.launch({
  executablePath: process.env.PW_CHROMIUM_PATH || undefined,
});
try {
  const page = await browser.newPage();
  page.on('console', (m) => console.error('[page]', m.text()));
  await page.goto(`http://127.0.0.1:${port}/sqlite-opfs/index.html?rows=${rows}`);
  await page.waitForFunction(() => window.__result, null, { timeout: 300_000 });
  const result = await page.evaluate(() => window.__result);
  result.browser = browser.version();
  console.log(
    JSON.stringify(result, (k, v) => (typeof v === 'number' ? Math.round(v * 10) / 10 : v), 2),
  );
} finally {
  await browser.close();
  server.close();
}
