// Runs one job in a worker, chosen by the query string, and publishes the result on
// `window.__result` for run.mjs to collect. ?job=sqlite&vfs=opfs|opfs-sahpool&phase=bench|verify
// or ?job=argon2&mem=64,256
const params = new URLSearchParams(location.search);
const job = params.get('job');
const out = document.getElementById('out');

const worker =
  job === 'argon2'
    ? new Worker(new URL('./argon2-worker.js', import.meta.url), { type: 'module' })
    : new Worker(new URL('./sqlite-worker.js', import.meta.url), { type: 'module' });

worker.onmessage = (e) => {
  window.__result = e.data;
  out.textContent = JSON.stringify(e.data, null, 2);
};
worker.onerror = (e) => {
  window.__result = { ok: false, error: `worker error: ${e.message}` };
  out.textContent = JSON.stringify(window.__result);
};
worker.postMessage({
  ...Object.fromEntries(params),
  crossOriginIsolated: self.crossOriginIsolated,
});
