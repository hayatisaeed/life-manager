// Shared Argon2id benchmark (crypto_pwhash, ALG_ARGON2ID13). Runs in Node and
// in the browser. Each setting is timed `reps` times after one warm-up.
export async function bench(sodium, settings, reps = 3) {
  await sodium.ready;
  const salt = new Uint8Array(sodium.crypto_pwhash_SALTBYTES).fill(7);
  const out = [];
  for (const { ops, memMiB } of settings) {
    const mem = memMiB * 1024 * 1024;
    const run = () =>
      sodium.crypto_pwhash(
        32,
        'correct horse battery staple',
        salt,
        ops,
        mem,
        sodium.crypto_pwhash_ALG_ARGON2ID13,
      );
    const row = { ops, memMiB };
    try {
      run();
      const times = [];
      for (let i = 0; i < reps; i++) {
        const t = performance.now();
        run();
        times.push(performance.now() - t);
      }
      times.sort((a, b) => a - b);
      row.medianMs = Math.round(times[Math.floor(times.length / 2)]);
    } catch (err) {
      row.error = String(err?.message ?? err);
    }
    out.push(row);
  }
  return out;
}

export const SETTINGS = [
  { ops: 3, memMiB: 64 },
  { ops: 3, memMiB: 128 },
  { ops: 3, memMiB: 256 },
  { ops: 2, memMiB: 256 },
  { ops: 4, memMiB: 64 },
];
