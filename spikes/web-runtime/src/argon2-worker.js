import sodium from 'libsodium-wrappers-sumo';

self.onmessage = async ({ data }) => {
  try {
    await sodium.ready;
    const salt = new Uint8Array(sodium.crypto_pwhash_SALTBYTES).fill(7);
    const results = [];
    for (const mib of (data.mem ?? '64,256').split(',').map(Number)) {
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
      results.push({ opslimit: 3, memlimit_mib: mib, runs_ms: runs, error });
    }
    self.postMessage({ ok: true, libsodium: sodium.SODIUM_VERSION_STRING, results });
  } catch (err) {
    self.postMessage({ ok: false, error: String(err) });
  }
};
