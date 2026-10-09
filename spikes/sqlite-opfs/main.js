// Runs the benchmark worker once per VFS, then a second worker per VFS to
// check that the data survived (persistence across worker restarts).
function runWorker(msg) {
  return new Promise((resolve, reject) => {
    const w = new Worker('./worker.js', { type: 'module' });
    w.onmessage = (e) => {
      w.terminate();
      resolve(e.data);
    };
    w.onerror = (e) => reject(new Error(e.message));
    w.postMessage(msg);
  });
}

const rows = Number(new URLSearchParams(location.search).get('rows') ?? 50000);
const results = { crossOriginIsolated: self.crossOriginIsolated, runs: [] };
for (const vfs of ['opfs', 'opfs-sahpool']) {
  results.runs.push(await runWorker({ phase: 'write', vfs, rows }));
  results.runs.push(await runWorker({ phase: 'reopen', vfs, rows }));
}
window.__result = results;
