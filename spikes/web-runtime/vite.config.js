import { defineConfig } from 'vite';

// `run.mjs` starts this twice: once with COOP/COEP (cross-origin isolated, like a
// server we control) and once without (like GitHub Pages, which can't set headers).
export default defineConfig({
  optimizeDeps: { exclude: ['@sqlite.org/sqlite-wasm'] },
  worker: { format: 'es' },
  server: { strictPort: true },
});
