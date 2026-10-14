import { createCrypto } from '@lm/crypto';
import type { SecretStore, SecretCipherStore } from '@lm/platform';
/** SECURITY.md §4: encrypted IndexedDB secrets, bound to their local slot name. */
export async function createEncryptedSecrets(
  storage: SecretCipherStore,
  dataKey: Uint8Array,
): Promise<SecretStore & { dispose(): void }> {
  const crypto = await createCrypto();
  const keys = crypto.deriveKeys(dataKey);
  for (const name of ['record', 'blob', 'path'] as const) crypto.dispose(keys[name]);
  let locked = false;
  const check = (name: string) => {
    if (locked) throw new Error('Secrets locked');
    if (!/^[A-Za-z0-9._-]{1,128}$/.test(name)) throw new Error('Invalid secret slot');
  };
  return {
    get: async (name) => {
      check(name);
      const encrypted = await storage.get(name);
      check(name);
      if (!encrypted) return null;
      let plain: Uint8Array | undefined;
      try {
        plain = crypto.decrypt(encrypted, keys.local, `lms1|${name}`);
        return crypto.decodeUtf8(plain);
      } catch {
        throw new Error('Secret unlock failed');
      } finally {
        if (plain) crypto.dispose(plain);
      }
    },
    set: async (name, value) => {
      check(name);
      const plain = crypto.encodeUtf8(value);
      try {
        await storage.set(name, crypto.encrypt(plain, keys.local, `lms1|${name}`));
      } finally {
        crypto.dispose(plain);
      }
    },
    remove: async (name) => {
      check(name);
      await storage.remove(name);
    },
    dispose: () => {
      locked = true;
      crypto.dispose(keys.local);
    },
  };
}
