export interface SecretCipherStore {
  get(name: string): Promise<Uint8Array | null>;
  set(name: string, value: Uint8Array): Promise<void>;
  remove(name: string): Promise<void>;
}
/** SECURITY.md §4: this adapter accepts ciphertext only; encryption is injected from crypto. */
export async function createWebSecretCipherStore(
  databaseName = 'life-manager-secrets',
): Promise<SecretCipherStore> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(databaseName, 1);
    request.onupgradeneeded = () => request.result.createObjectStore('secrets');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error('Secret storage unavailable'));
    request.onblocked = () => reject(new Error('Secret storage blocked'));
  });
  async function operation<T>(
    mode: IDBTransactionMode,
    run: (store: IDBObjectStore) => IDBRequest<T>,
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const transaction = db.transaction('secrets', mode);
      const request = run(transaction.objectStore('secrets'));
      let value: T;
      request.onsuccess = () => {
        value = request.result;
      };
      transaction.oncomplete = () => resolve(value);
      transaction.onerror = () => reject(new Error('Secret storage failed'));
      transaction.onabort = () => reject(new Error('Secret storage failed'));
    });
  }
  return {
    get: async (name) => {
      const value: unknown = await operation('readonly', (store) => store.get(name));
      if (value === undefined) return null;
      if (!(value instanceof Uint8Array)) throw new Error('Invalid encrypted secret');
      return value.slice();
    },
    set: async (name, value) => {
      await operation('readwrite', (store) => store.put(value.slice(), name));
    },
    remove: async (name) => {
      await operation('readwrite', (store) => store.delete(name));
    },
  };
}
