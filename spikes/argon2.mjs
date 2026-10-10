import { createRequire } from 'node:module';
const require = createRequire(process.cwd() + '/packages/crypto/x.js');
const sodium = require('libsodium-wrappers-sumo');
await sodium.ready;
for (const mem of [64, 128, 256]) {
  const t = performance.now();
  sodium.crypto_pwhash(
    32,
    'correct horse battery staple',
    new Uint8Array(16),
    3,
    mem * 1024 * 1024,
    sodium.crypto_pwhash_ALG_ARGON2ID13,
  );
  console.log(`argon2id ops=3 mem=${mem}MiB: ${(performance.now() - t).toFixed(0)}ms`);
}
