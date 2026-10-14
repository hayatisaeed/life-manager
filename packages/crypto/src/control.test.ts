import { beforeAll, describe, expect, it } from 'vitest';
import { createCrypto, vaultControlSchema } from './index';
import type { ControlledVaultHeader, VaultControl } from './index';
let crypto: Awaited<ReturnType<typeof createCrypto>>;
beforeAll(async () => {
  crypto = await createCrypto();
});
const active = (): VaultControl => ({
  state: 'active',
  vaultId: 'a'.repeat(64),
  generation: 1,
  writeNonce: 'b'.repeat(64),
});
function controlled() {
  const vault = crypto.createVault('test passphrase', '2026-10-13');
  return { ...vault, header: crypto.controlHeader(vault.header, vault.dataKey, active()) };
}
describe('authenticated vault v2', () => {
  it('unlocks through either credential and authenticates encrypted control', () => {
    const vault = controlled();
    expect(crypto.unlock(vault.header, 'test passphrase')).toEqual(vault.dataKey);
    expect(crypto.unlock(vault.header, vault.recoveryKey, 'recovery')).toEqual(vault.dataKey);
    const keys = crypto.deriveKeys(vault.dataKey);
    expect(crypto.decodeControl(vault.header, keys.record)).toEqual(active());
    expect(vault.header.control).not.toContain(active().vaultId);
    const again = crypto.controlHeader(vault.header, vault.dataKey, active());
    expect(again.control).not.toBe(vault.header.control);
  });
  it('binds every clear header field and rejects tampering, truncation and control swaps', () => {
    const vault = controlled(),
      other = controlled();
    const keys = crypto.deriveKeys(vault.dataKey);
    const variants: unknown[] = [
      { ...vault.header, createdAt: '2026-10-14' },
      { ...vault.header, kdf: { ...vault.header.kdf, opslimit: 4 } },
      { ...vault.header, kdf: { ...vault.header.kdf, salt: 'A'.repeat(22) } },
      { ...vault.header, kdf: { ...vault.header.kdf, memlimit: 128 * 1024 * 1024 } },
      { ...vault.header, keyCheck: 'A'.repeat(70) },
      {
        ...vault.header,
        wrappedKeys: vault.header.wrappedKeys.map((key) => ({ ...key, nonce: 'A'.repeat(32) })),
      },
      {
        ...vault.header,
        wrappedKeys: vault.header.wrappedKeys.map((key) => ({ ...key, ct: 'A'.repeat(64) })),
      },
      { ...vault.header, control: other.header.control },
      { ...vault.header, control: vault.header.control.slice(0, -30) },
      { ...vault.header, control: 'LMC2.AA' },
      { ...vault.header, private: 'unexpected' },
      { ...vault.header, version: 3 },
    ];
    for (const header of variants)
      expect(() => crypto.decodeControl(header, keys.record)).toThrow();
    expect(() => crypto.decodeControl(vault.header, crypto.randomKey())).toThrow();
    expect(() => crypto.decodeControl(vault.header, new Uint8Array(31))).toThrow();
    expect(() =>
      crypto.unlock({ ...vault.header, createdAt: '2026-10-14' }, vault.recoveryKey, 'recovery'),
    ).toThrow();
  });
  it('canonicalizes property/wrap order and matches an independent header digest vector', () => {
    const header: Omit<ControlledVaultHeader, 'control'> = {
      format: 'life-manager',
      version: 2,
      kdf: { alg: 'argon2id', opslimit: 3, memlimit: 67108864, salt: 'A'.repeat(22) },
      wrappedKeys: [
        { kind: 'recovery', nonce: 'B'.repeat(32), ct: 'C'.repeat(64) },
        { kind: 'passphrase', nonce: 'D'.repeat(32), ct: 'E'.repeat(64) },
      ],
      keyCheck: 'F'.repeat(70),
      createdAt: '2026-10-13',
    };
    const reversed = {
      ...Object.fromEntries(Object.entries(header).reverse()),
      wrappedKeys: [...header.wrappedKeys].reverse(),
    } as typeof header;
    expect(crypto.headerDigest(header)).toBe(crypto.headerDigest(reversed));
    // Python hashlib.blake2b on the specified JSON tuple, separators=(',', ':').
    expect(crypto.headerDigest(header)).toBe(
      'dbb637cb1c024593afb3571ef562b221cde00eafe0ac5ad75c48b0fd4f772b41',
    );
  });
  it('rewraps active v2 controls, preserves receipts and refuses maintenance-state rewraps', () => {
    const vault = controlled();
    const next = crypto.rewrap(vault.header, vault.dataKey, 'new passphrase');
    expect(next.version).toBe(2);
    expect(crypto.unlock(next, 'new passphrase')).toEqual(vault.dataKey);
    expect(crypto.unlock(next, vault.recoveryKey, 'recovery')).toEqual(vault.dataKey);
    const keys = crypto.deriveKeys(vault.dataKey);
    const control = crypto.decodeControl(next, keys.record);
    expect(control.generation).toBe(1);
    expect(control.vaultId).toBe(active().vaultId);
    expect(control.writeNonce).not.toBe(active().writeNonce);
    const frozen = crypto.controlHeader(vault.header, vault.dataKey, {
      ...active(),
      state: 'frozen',
      operationId: 'c'.repeat(64),
    });
    expect(() => crypto.rewrap(frozen, vault.dataKey, 'another')).toThrow('Maintenance');
  });
  it('validates control states and migration receipts without accepting dropped fields', () => {
    expect(() => vaultControlSchema.parse({ ...active(), operationId: 'c'.repeat(64) })).toThrow();
    expect(() =>
      vaultControlSchema.parse({ ...active(), generation: Number.MAX_SAFE_INTEGER + 1 }),
    ).toThrow();
    expect(() => vaultControlSchema.parse({ ...active(), state: 'frozen' })).toThrow();
    expect(() => vaultControlSchema.parse({ ...active(), token: 'never here' })).toThrow();
  });
  it('changes the key fingerprint on rotation and does not accept malformed keys', () => {
    const key = new Uint8Array(32);
    expect(crypto.keyFingerprint(key)).toMatch(/^[0-9a-f]{64}$/);
    expect(crypto.keyFingerprint(key)).not.toBe(crypto.keyFingerprint(crypto.randomKey()));
    expect(() => crypto.keyFingerprint(new Uint8Array(31))).toThrow();
  });
});
