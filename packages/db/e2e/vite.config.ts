import { defineConfig } from 'vite';

// Builds the browser harness for the repository suite.
export default defineConfig({
  root: new URL('./harness', import.meta.url).pathname,
  // sqlite-wasm loads its .wasm relative to its own module; pre-bundling breaks that.
  optimizeDeps: { exclude: ['@sqlite.org/sqlite-wasm'] },
  worker: { format: 'es' },
  build: {
    outDir: new URL('./dist', import.meta.url).pathname,
    emptyOutDir: true,
    target: 'es2023',
  },
  preview: { port: 4174, strictPort: true },
});
