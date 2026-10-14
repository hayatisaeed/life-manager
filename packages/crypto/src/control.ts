import { z } from 'zod';
import sodium from 'libsodium-wrappers-sumo';

const hex = z.string().regex(/^[0-9a-f]{64}$/);
const sha = z.string().regex(/^[0-9a-f]{40}$/);
const generation = z.number().int().positive().refine(Number.isSafeInteger);
export const forgeIdentitySchema = z.strictObject({
  provider: z.enum(['github', 'gitlab']),
  apiOrigin: z.url({ protocol: /^https$/ }).regex(/^https:\/\/[^/?#@]+$/),
  repositoryId: z.string().min(1),
});
export type ForgeIdentity = z.infer<typeof forgeIdentitySchema>;
const transitionSchema = z.strictObject({
  kind: z.enum(['compaction', 'rotation']),
  source: forgeIdentitySchema,
  sourceCommit: sha,
  sourceHeaderDigest: hex,
  destination: forgeIdentitySchema,
  destinationGeneration: generation,
  keyFingerprint: hex,
});
const entrySchema = z.strictObject({
  path: z.string().regex(/^(?:r|b)\/[0-9a-f]{2}\/[0-9a-f]{2}\/[0-9a-f]{64}\.lm[rb]$/),
  size: z.number().int().nonnegative().refine(Number.isSafeInteger),
  digest: hex,
});
const inventorySchema = z.strictObject({
  sourceCommit: sha,
  entries: z
    .array(entrySchema)
    .refine((entries) =>
      entries.every((entry, i) => i === 0 || (entries[i - 1]?.path ?? '') < entry.path),
    ),
});
const common = { vaultId: hex, generation, writeNonce: hex };
const migrated = {
  operationId: hex,
  transition: transitionSchema,
  inventory: inventorySchema,
};
export const vaultControlSchema = z
  .discriminatedUnion('state', [
    z.strictObject({
      ...common,
      state: z.literal('active'),
      operationId: hex.optional(),
      transition: transitionSchema.optional(),
      inventory: inventorySchema.optional(),
    }),
    z.strictObject({ ...common, state: z.literal('frozen'), operationId: hex }),
    z.strictObject({ ...common, ...migrated, state: z.literal('staging') }),
    z.strictObject({
      ...common,
      state: z.literal('redirect'),
      operationId: hex,
      transition: transitionSchema,
    }),
  ])
  .superRefine((control, context) => {
    if (control.state === 'active') {
      const fields = [control.operationId, control.transition, control.inventory];
      if (
        fields.some((value) => value !== undefined) &&
        fields.some((value) => value === undefined)
      )
        context.addIssue({ code: 'custom', message: 'Incomplete active migration receipt' });
    }
    if ('transition' in control && control.transition) {
      const expected = control.state === 'redirect' ? control.generation + 1 : control.generation;
      if (control.transition.destinationGeneration !== expected)
        context.addIssue({ code: 'custom', message: 'Invalid transition generation' });
      if (
        'inventory' in control &&
        control.inventory &&
        control.inventory.sourceCommit !== control.transition.sourceCommit
      )
        context.addIssue({ code: 'custom', message: 'Inventory source mismatch' });
    }
  });
export type VaultControl = z.infer<typeof vaultControlSchema>;

export const kdfSchema = z.strictObject({
  alg: z.literal('argon2id'),
  opslimit: z.number().int().min(3).max(10),
  memlimit: z
    .number()
    .int()
    .min(64 * 1024 * 1024)
    .max(256 * 1024 * 1024),
  salt: z.string().length(22),
});
const wrappedSchema = z.strictObject({
  kind: z.enum(['passphrase', 'recovery']),
  nonce: z.string().length(32),
  ct: z.string().length(64),
});
const headerFields = {
  format: z.literal('life-manager'),
  kdf: kdfSchema,
  wrappedKeys: z
    .array(wrappedSchema)
    .length(2)
    .refine((keys) => new Set(keys.map((key) => key.kind)).size === 2),
  keyCheck: z.string().length(70),
  createdAt: z.iso.date(),
};
export const legacyHeaderSchema = z.strictObject({ ...headerFields, version: z.literal(1) });
export const controlledHeaderSchema = z.strictObject({
  ...headerFields,
  version: z.literal(2),
  control: z.string().startsWith('LMC2.'),
});
export const vaultHeaderSchema = z.discriminatedUnion('version', [
  legacyHeaderSchema,
  controlledHeaderSchema,
]);
export type LegacyVaultHeader = z.infer<typeof legacyHeaderSchema>;
export type ControlledVaultHeader = z.infer<typeof controlledHeaderSchema>;
export type VaultHeader = z.infer<typeof vaultHeaderSchema>;
export type ControlHeader = Omit<ControlledVaultHeader, 'control'>;

/** ADR-016 / maintenance protocol §4: fixed tuple encoding avoids property-order ambiguity. */
export function headerBindingBytes(input: ControlHeader): Uint8Array {
  const header = controlledHeaderSchema.parse({ ...input, control: 'LMC2.' });
  const kdf = header.kdf;
  return sodium.from_string(
    JSON.stringify([
      header.format,
      header.version,
      [kdf.alg, kdf.opslimit, kdf.memlimit, kdf.salt],
      [...header.wrappedKeys]
        .sort((a, b) => (a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0))
        .map((key) => [key.kind, key.nonce, key.ct]),
      header.keyCheck,
      header.createdAt,
    ]),
  );
}
export function headerDigest(input: ControlHeader): string {
  return sodium.to_hex(sodium.crypto_generichash(32, headerBindingBytes(input), null));
}
function assertKey(key: Uint8Array) {
  if (key.length !== 32) throw new Error('Invalid key length');
}
export function randomControlId(): string {
  return sodium.to_hex(sodium.randombytes_buf(32));
}
export function keyFingerprint(dataKey: Uint8Array): string {
  assertKey(dataKey);
  const prefix = sodium.from_string('lm-key-fingerprint-v2');
  const input = new Uint8Array(prefix.length + dataKey.length);
  input.set(prefix);
  input.set(dataKey, prefix.length);
  try {
    return sodium.to_hex(sodium.crypto_generichash(32, input, null));
  } finally {
    sodium.memzero(input);
  }
}
export function encodeControl(
  header: ControlHeader,
  control: VaultControl,
  recordKey: Uint8Array,
): string {
  assertKey(recordKey);
  const valid = vaultControlSchema.parse(control);
  const nonce = sodium.randombytes_buf(24);
  const plain = sodium.from_string(JSON.stringify(valid));
  try {
    const encrypted = sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(
      plain,
      `lmc2|${headerDigest(header)}`,
      null,
      nonce,
      recordKey,
    );
    const bytes = new Uint8Array(nonce.length + encrypted.length);
    bytes.set(nonce);
    bytes.set(encrypted, nonce.length);
    return `LMC2.${sodium.to_base64(bytes, sodium.base64_variants.URLSAFE_NO_PADDING)}`;
  } finally {
    sodium.memzero(plain);
  }
}
export function decodeControl(input: unknown, recordKey: Uint8Array): VaultControl {
  assertKey(recordKey);
  const header = controlledHeaderSchema.parse(input);
  const bytes = sodium.from_base64(
    header.control.slice(5),
    sodium.base64_variants.URLSAFE_NO_PADDING,
  );
  if (bytes.length < 40) throw new Error('Invalid encrypted control');
  const { control: _control, ...binding } = header;
  let plain: Uint8Array | undefined;
  try {
    plain = sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(
      null,
      bytes.slice(24),
      `lmc2|${headerDigest(binding)}`,
      bytes.slice(0, 24),
      recordKey,
    );
    return vaultControlSchema.parse(JSON.parse(sodium.to_string(plain)));
  } catch {
    throw new Error('Control authentication or validation failed');
  } finally {
    if (plain) sodium.memzero(plain);
  }
}
