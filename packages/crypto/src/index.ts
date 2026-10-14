import sodium from 'libsodium-wrappers-sumo';
import { z } from 'zod';
import {
  vaultHeaderSchema as headerSchema,
  legacyHeaderSchema,
  kdfSchema,
  decodeControl,
  encodeControl,
  headerDigest,
  keyFingerprint,
  randomControlId,
} from './control';
import type { VaultHeader, ControlledVaultHeader, VaultControl } from './control';
export * from './control';
const KEY_BYTES = 32;
const NONCE_BYTES = 24;
const MAX_BLOB_BYTES = 50 * 1024 * 1024;
const pathSchema = z
  .string()
  .regex(/^([rb])\/([0-9a-f]{2})\/([0-9a-f]{2})\/([0-9a-f]{64})\.lm[rb]$/);
function getRecoveryWrap(header: VaultHeader) {
  const wrap = header.wrappedKeys.find((item) => item.kind === 'recovery');
  if (!wrap) throw new Error('Missing recovery key');
  return wrap;
}
export type SubKeys = { record: Uint8Array; blob: Uint8Array; path: Uint8Array; local: Uint8Array };
const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function assertKey(key: Uint8Array): void {
  if (key.length !== KEY_BYTES) throw new Error('Invalid key length');
}
function concat(...parts: Uint8Array[]): Uint8Array {
  const result = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}
/** SECURITY.md §2. Base32 is an encoding only; randomness comes from libsodium. */
export function encodeRecovery(key: Uint8Array): string {
  assertKey(key);
  let bits = 0,
    value = 0,
    output = '';
  for (const byte of key) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      output += alphabet[(value >>> bits) & 31] ?? '';
    }
    value &= (1 << bits) - 1;
  }
  if (bits) output += alphabet[(value << (5 - bits)) & 31] ?? '';
  return (output.match(/.{1,4}/g) ?? []).join('-');
}
export function decodeRecovery(input: string): Uint8Array {
  const text = input.replaceAll('-', '').replaceAll(' ', '').toUpperCase();
  if (!/^[A-Z2-7]{52}$/.test(text)) throw new Error('Invalid recovery key');
  const output: number[] = [];
  let bits = 0,
    value = 0;
  for (const char of text) {
    value = (value << 5) | alphabet.indexOf(char);
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      output.push((value >>> bits) & 255);
    }
    value &= (1 << bits) - 1;
  }
  if (value !== 0 || output.length !== KEY_BYTES) throw new Error('Invalid recovery key');
  return new Uint8Array(output);
}
/** Wait for WASM once. Callers own key lifetime and must dispose it on lock. */
export async function createCrypto() {
  await sodium.ready;
  const b64 = (bytes: Uint8Array) =>
    sodium.to_base64(bytes, sodium.base64_variants.URLSAFE_NO_PADDING);
  const unb64 = (value: string) =>
    sodium.from_base64(value, sodium.base64_variants.URLSAFE_NO_PADDING);
  const encrypt = (plain: Uint8Array, key: Uint8Array, associatedData: string): Uint8Array => {
    assertKey(key);
    const nonce = sodium.randombytes_buf(NONCE_BYTES);
    return concat(
      nonce,
      sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(plain, associatedData, null, nonce, key),
    );
  };
  const decrypt = (bytes: Uint8Array, key: Uint8Array, associatedData: string): Uint8Array => {
    assertKey(key);
    if (bytes.length < NONCE_BYTES + 16) throw new Error('Invalid encrypted data');
    try {
      return sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(
        null,
        bytes.slice(NONCE_BYTES),
        associatedData,
        bytes.slice(0, NONCE_BYTES),
        key,
      );
    } catch {
      throw new Error('Authentication failed');
    }
  };
  const deriveKeys = (key: Uint8Array): SubKeys => {
    assertKey(key);
    // Libsodium requires exactly eight context bytes; the spec names are NUL padded.
    const derive = (context: string) =>
      sodium.crypto_kdf_derive_from_key(KEY_BYTES, 1, context.padEnd(8, '\0'), key);
    return {
      record: derive('lm-rec1'),
      blob: derive('lm-blob'),
      path: derive('lm-path'),
      local: derive('lm-locl'),
    };
  };
  const recordPath = (id: string, pathKey: Uint8Array): string => {
    assertKey(pathKey);
    const name = sodium.to_hex(sodium.crypto_generichash(32, id, pathKey));
    return `r/${name.slice(0, 2)}/${name.slice(2, 4)}/${name}.lmr`;
  };
  const blobPath = (hash: string, pathKey: Uint8Array): string => {
    if (!/^[0-9a-f]{64}$/.test(hash)) throw new Error('Invalid content hash');
    return recordPath(hash, pathKey)
      .replace(/^r\//, 'b/')
      .replace(/\.lmr$/, '.lmb');
  };
  const validatePath = (path: string, kind: 'r' | 'b') => {
    pathSchema.parse(path);
    const parts = path.split('/');
    const filename = parts[3] ?? '';
    if (
      parts[0] !== kind ||
      !filename.endsWith(`.lm${kind}`) ||
      parts[1] !== filename.slice(0, 2) ||
      parts[2] !== filename.slice(2, 4)
    )
      throw new Error('Invalid ciphertext path');
  };
  const derivePassphrase = (passphrase: string, kdf: VaultHeader['kdf']) => {
    kdfSchema.parse(kdf);
    const salt = unb64(kdf.salt);
    if (salt.length !== sodium.crypto_pwhash_SALTBYTES) throw new Error('Invalid KDF salt');
    return sodium.crypto_pwhash(
      KEY_BYTES,
      passphrase,
      salt,
      kdf.opslimit,
      kdf.memlimit,
      sodium.crypto_pwhash_ALG_ARGON2ID13,
    );
  };
  const wrap = (dataKey: Uint8Array, wrappingKey: Uint8Array, kind: 'passphrase' | 'recovery') => {
    const bytes = encrypt(dataKey, wrappingKey, `lmk1|${kind}`);
    return { kind, nonce: b64(bytes.slice(0, NONCE_BYTES)), ct: b64(bytes.slice(NONCE_BYTES)) };
  };
  const unlock = (
    input: unknown,
    secret: string,
    kind: 'passphrase' | 'recovery' = 'passphrase',
  ): Uint8Array => {
    const header = headerSchema.parse(input);
    const key =
      kind === 'passphrase' ? derivePassphrase(secret, header.kdf) : decodeRecovery(secret);
    try {
      const wrapped = header.wrappedKeys.find((item) => item.kind === kind);
      if (!wrapped) throw new Error('Missing wrapped key');
      const nonce = unb64(wrapped.nonce);
      if (nonce.length !== NONCE_BYTES) throw new Error('Invalid wrapped key');
      const dataKey = decrypt(concat(nonce, unb64(wrapped.ct)), key, `lmk1|${kind}`);
      try {
        assertKey(dataKey);
        if (
          sodium.to_string(decrypt(unb64(header.keyCheck), dataKey, 'lmk1|check')) !==
          'lm-key-check'
        )
          throw new Error('Invalid key check');
        if (header.version === 2) {
          const keys = deriveKeys(dataKey);
          try {
            decodeControl(header, keys.record);
          } finally {
            for (const key of Object.values(keys)) sodium.memzero(key);
          }
        }
        return dataKey;
      } catch {
        sodium.memzero(dataKey);
        throw new Error('Unlock failed');
      }
    } finally {
      sodium.memzero(key);
    }
  };
  return {
    encodeBase64: (bytes: Uint8Array) => sodium.to_base64(bytes, sodium.base64_variants.ORIGINAL),
    decodeBase64: (text: string) => sodium.from_base64(text, sodium.base64_variants.ORIGINAL),
    encodeUtf8: (text: string) => sodium.from_string(text),
    decodeUtf8: (bytes: Uint8Array) => sodium.to_string(bytes),
    parseHeader: (input: unknown) => headerSchema.parse(input),
    decodeControl,
    encodeControl,
    headerDigest,
    keyFingerprint,
    randomControlId,
    controlHeader: (
      input: unknown,
      dataKey: Uint8Array,
      control: VaultControl,
    ): ControlledVaultHeader => {
      const header = headerSchema.parse(input);
      assertKey(dataKey);
      if (
        sodium.to_string(decrypt(unb64(header.keyCheck), dataKey, 'lmk1|check')) !== 'lm-key-check'
      )
        throw new Error('Invalid key check');
      const binding = {
        format: header.format,
        version: 2 as const,
        kdf: header.kdf,
        wrappedKeys: header.wrappedKeys,
        keyCheck: header.keyCheck,
        createdAt: header.createdAt,
      };
      const keys = deriveKeys(dataKey);
      try {
        if (header.version === 2) decodeControl(header, keys.record);
        return { ...binding, control: encodeControl(binding, control, keys.record) };
      } finally {
        for (const key of Object.values(keys)) sodium.memzero(key);
      }
    },
    randomKey: () => sodium.randombytes_buf(KEY_BYTES),
    dispose: (key: Uint8Array) => sodium.memzero(key),
    deriveKeys,
    recordPath,
    blobPath,
    encrypt,
    decrypt,
    derivePassphrase,
    unlock,
    contentHash: (content: Uint8Array) =>
      sodium.to_hex(sodium.crypto_generichash(32, content, null)),
    keyedHash: (content: Uint8Array, key: Uint8Array) => {
      assertKey(key);
      return sodium.to_hex(sodium.crypto_generichash(32, content, key));
    },
    encodeRecord: (plain: Uint8Array, path: string, key: Uint8Array): string => {
      validatePath(path, 'r');
      return `LMR1.${b64(encrypt(plain, key, `lmr1|${path}`))}`;
    },
    decodeRecord: (text: string, path: string, key: Uint8Array): Uint8Array => {
      validatePath(path, 'r');
      if (!text.startsWith('LMR1.')) throw new Error('Invalid record format');
      return decrypt(unb64(text.slice(5)), key, `lmr1|${path}`);
    },
    encodeBlob: (
      plain: Uint8Array,
      hash: string,
      key: Uint8Array,
      sizeLimit = 25 * 1024 * 1024,
    ): Uint8Array => {
      if (
        !/^[0-9a-f]{64}$/.test(hash) ||
        sodium.to_hex(sodium.crypto_generichash(32, plain, null)) !== hash
      )
        throw new Error('Invalid content hash');
      if (
        !Number.isSafeInteger(sizeLimit) ||
        sizeLimit < 44 ||
        sizeLimit > MAX_BLOB_BYTES ||
        plain.length + 44 > sizeLimit
      )
        throw new Error('Blob size limit exceeded');
      return concat(sodium.from_string('LMB1'), encrypt(plain, key, `lmb1|${hash}`));
    },
    decodeBlob: (bytes: Uint8Array, hash: string, key: Uint8Array): Uint8Array => {
      if (
        bytes.length > MAX_BLOB_BYTES ||
        sodium.to_string(bytes.slice(0, 4)) !== 'LMB1' ||
        !/^[0-9a-f]{64}$/.test(hash)
      )
        throw new Error('Invalid blob format');
      const plain = decrypt(bytes.slice(4), key, `lmb1|${hash}`);
      if (sodium.to_hex(sodium.crypto_generichash(32, plain, null)) !== hash)
        throw new Error('Invalid content hash');
      return plain;
    },
    createVault: (
      passphrase: string,
      createdAt: string,
      platform: 'desktop' | 'web' | 'mobile' = 'web',
    ) => {
      const dataKey = sodium.randombytes_buf(KEY_BYTES),
        recovery = sodium.randombytes_buf(KEY_BYTES);
      const kdf: VaultHeader['kdf'] = {
        alg: 'argon2id',
        opslimit: 3,
        memlimit: (platform === 'desktop' ? 256 : 64) * 1024 * 1024,
        salt: b64(sodium.randombytes_buf(sodium.crypto_pwhash_SALTBYTES)),
      };
      let wrappingKey: Uint8Array | undefined;
      try {
        wrappingKey = derivePassphrase(passphrase, kdf);
        const header = legacyHeaderSchema.parse({
          format: 'life-manager',
          version: 1,
          kdf,
          wrappedKeys: [
            wrap(dataKey, wrappingKey, 'passphrase'),
            wrap(dataKey, recovery, 'recovery'),
          ],
          keyCheck: b64(encrypt(sodium.from_string('lm-key-check'), dataKey, 'lmk1|check')),
          createdAt,
        });
        return { header, dataKey, recoveryKey: encodeRecovery(recovery) };
      } catch {
        sodium.memzero(dataKey);
        throw new Error('Vault creation failed');
      } finally {
        if (wrappingKey) sodium.memzero(wrappingKey);
        sodium.memzero(recovery);
      }
    },
    rewrap: (input: unknown, dataKey: Uint8Array, newPassphrase: string): VaultHeader => {
      const header = headerSchema.parse(input);
      assertKey(dataKey);
      if (
        sodium.to_string(decrypt(unb64(header.keyCheck), dataKey, 'lmk1|check')) !== 'lm-key-check'
      )
        throw new Error('Invalid key check');
      const kdf = {
        ...header.kdf,
        salt: b64(sodium.randombytes_buf(sodium.crypto_pwhash_SALTBYTES)),
      };
      const key = derivePassphrase(newPassphrase, kdf);
      try {
        const next = {
          ...header,
          kdf,
          wrappedKeys: [wrap(dataKey, key, 'passphrase'), getRecoveryWrap(header)],
        };
        if (header.version === 1) return next;
        const keys = deriveKeys(dataKey);
        try {
          const control = decodeControl(header, keys.record);
          if (control.state !== 'active') throw new Error('Maintenance in progress');
          const { control: _control, ...binding } = next as ControlledVaultHeader;
          return {
            ...binding,
            control: encodeControl(
              binding,
              { ...control, writeNonce: randomControlId() },
              keys.record,
            ),
          };
        } finally {
          for (const key of Object.values(keys)) sodium.memzero(key);
        }
      } finally {
        sodium.memzero(key);
      }
    },
  };
}
