// Same Argon2id measurement as the browser worker, under Node (wasm too), for comparison.
import sodium from 'libsodium-wrappers-sumo';

await sodium.ready;
const salt = new Uint8Array(sodium.crypto_pwhash_SALTBYTES).fill(7);
const out = [];
for (const mib of [64, 128, 256, 512]) {
  const runs = [];
  let error = null;
  for (let i = 0; i < 3; i++) {
    const t = performance.now();
    try {
      sodium.crypto_pwhash(
        32,
        'correct horse battery staple',
        salt,
        3,
        mib * 1024 * 1024,
        sodium.crypto_pwhash_ALG_ARGON2ID13,
      );
    } catch (err) {
      error = String(err);
      break;
    }
    runs.push(Math.round(performance.now() - t));
  }
  out.push({ opslimit: 3, memlimit_mib: mib, runs_ms: runs, error });
}
console.log(
  JSON.stringify(
    { libsodium: sodium.SODIUM_VERSION_STRING, node: process.version, results: out },
    null,
    2,
  ),
);
