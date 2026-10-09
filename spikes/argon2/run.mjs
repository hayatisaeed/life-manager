// Times Argon2id in Node and in headless Chromium (wasm, main thread).
// Usage: node argon2/run.mjs
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import sodium from 'libsodium-wrappers-sumo';
import { chromium } from 'playwright-core';
import { bench, SETTINGS } from './bench.mjs';

const result = {
  cpu: os.cpus()[0]?.model,
  cores: os.cpus().length,
  node: await bench(sodium, SETTINGS),
};

const root = fileURLToPath(new URL('..', import.meta.url));
const types = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.wasm': 'application/wasm',
};
const server = createServer(async (req, res) => {
  const file = join(root, normalize(new URL(req.url, 'http://x').pathname));
  try {
    const body = await readFile(file);
    res
      .writeHead(200, { 'content-type': types[extname(file)] ?? 'application/octet-stream' })
      .end(body);
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const browser = await chromium.launch({
  executablePath: process.env.PW_CHROMIUM_PATH || undefined,
});
try {
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.error('[page]', e.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/argon2/index.html`);
  await page.waitForFunction(() => window.__result, null, { timeout: 300_000 });
  result.chromium = await page.evaluate(() => window.__result);
  result.chromiumVersion = browser.version();
} finally {
  await browser.close();
  server.close();
}
console.log(JSON.stringify(result, null, 2));
