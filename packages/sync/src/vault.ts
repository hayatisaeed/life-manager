import { createCrypto } from '@lm/crypto';
import type { VaultControl } from '@lm/crypto';
import { SyncError } from './transport';

/** New sync vaults always use ADR-016's authenticated control; legacy vaults are not upgraded silently. */
export async function createSyncVault(
  passphrase: string,
  createdAt: string,
  platform: 'desktop' | 'web' | 'mobile' = 'web',
) {
  const crypto = await createCrypto();
  const vault = crypto.createVault(passphrase, createdAt, platform);
  try {
    const control: VaultControl = {
      state: 'active',
      vaultId: crypto.randomControlId(),
      generation: 1,
      writeNonce: crypto.randomControlId(),
    };
    return {
      ...vault,
      control,
      header: crypto.controlHeader(vault.header, vault.dataKey, control),
    };
  } catch (error) {
    crypto.dispose(vault.dataKey);
    throw error;
  }
}
export async function unlockSyncVault(
  input: unknown,
  secret: string,
  kind: 'passphrase' | 'recovery' = 'passphrase',
) {
  const crypto = await createCrypto();
  const parsed = crypto.parseHeader(input);
  if (parsed.version !== 2) throw new SyncError('update-required');
  const dataKey = crypto.unlock(parsed, secret, kind);
  const keys = crypto.deriveKeys(dataKey);
  try {
    const control = crypto.decodeControl(parsed, keys.record);
    return { header: parsed, dataKey, control };
  } catch (error) {
    crypto.dispose(dataKey);
    throw error;
  } finally {
    for (const key of Object.values(keys)) crypto.dispose(key);
  }
}
