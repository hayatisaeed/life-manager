import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import { expect, test } from '@playwright/test';

const source = await readFile(
  new URL('../../../packages/platform/src/secrets.ts', import.meta.url),
  'utf8',
);
const moduleSource = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
}).outputText;

test('web encrypted-secret storage persists bytes across reload and rejects malformed stored values', async ({
  page,
}) => {
  await page.goto('/');
  const result = await page.evaluate(async (source) => {
    const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
    try {
      const module = (await import(url)) as {
        createWebSecretCipherStore(name: string): Promise<{
          get(name: string): Promise<Uint8Array | null>;
          set(name: string, value: Uint8Array): Promise<void>;
          remove(name: string): Promise<void>;
        }>;
      };
      const store = await module.createWebSecretCipherStore('synthetic-secret-adapter-test');
      await store.set('synthetic', new Uint8Array([1, 2, 3, 4]));
      return [...((await store.get('synthetic')) ?? [])];
    } finally {
      URL.revokeObjectURL(url);
    }
  }, moduleSource);
  expect(result).toEqual([1, 2, 3, 4]);
  await page.reload();
  const resumed = await page.evaluate(async (source) => {
    const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
    try {
      const module = (await import(url)) as {
        createWebSecretCipherStore(name: string): Promise<{
          get(name: string): Promise<Uint8Array | null>;
          remove(name: string): Promise<void>;
        }>;
      };
      const store = await module.createWebSecretCipherStore('synthetic-secret-adapter-test');
      const bytes = [...((await store.get('synthetic')) ?? [])];
      await store.remove('synthetic');
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open('synthetic-secret-adapter-test', 1);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(new Error('Synthetic storage failure'));
      });
      await new Promise<void>((resolve, reject) => {
        const transaction = db.transaction('secrets', 'readwrite');
        transaction.objectStore('secrets').put('malformed synthetic value', 'bad');
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(new Error('Synthetic storage failure'));
      });
      db.close();
      let malformedRejected = false;
      try {
        await store.get('bad');
      } catch {
        malformedRejected = true;
      }
      return { bytes, removed: await store.get('synthetic'), malformedRejected };
    } finally {
      URL.revokeObjectURL(url);
    }
  }, moduleSource);
  expect(resumed).toEqual({ bytes: [1, 2, 3, 4], removed: null, malformedRejected: true });
});
