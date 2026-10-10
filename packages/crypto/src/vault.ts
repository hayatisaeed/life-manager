// `lm.json`: the plaintext repo header holding the wrapped data key (SYNC.md §2,
// SECURITY.md §3).

import { decodeRecoveryKey, encodeRecoveryKey, newRecoveryKeyBytes } from './recovery';
import type { KdfParams } from './sodium';
import {
  CryptoError,
  KEY_BYTES,
  NONCE_BYTES,
  deriveKek,
  fromB64,
  fromUtf8,
  newKdfParams,
  open,
  randomBytes,
  seal,
  toB64,
  utf8,
} from './sodium';

export interface WrappedKey {
  kind: 'passphrase' | 'recovery';
  nonce: string;
  ct: string;
}

export interface LmJson {
  format: 'life-manager';
  version: 1;
  kdf: KdfParams;
  wrappedKeys: WrappedKey[];
  /** base64 of nonce ‖ AEAD("lm-key-check") under the data key. */
  keyCheck: string;
  createdAt: string;
}

const KEY_CHECK = 'lm-key-check';
const wrapAd = (kind: WrappedKey['kind']) => `lmk1|${kind}`;

function wrap(kek: Uint8Array, dataKey: Uint8Array, kind: WrappedKey['kind']): WrappedKey {
  const { nonce, ct } = seal(kek, dataKey, wrapAd(kind));
  return { kind, nonce: toB64(nonce), ct: toB64(ct) };
}

function makeKeyCheck(dataKey: Uint8Array): string {
  const { nonce, ct } = seal(dataKey, utf8(KEY_CHECK), 'lmk1|check');
  const out = new Uint8Array(nonce.length + ct.length);
  out.set(nonce);
  out.set(ct, nonce.length);
  return toB64(out);
}

function verifyKeyCheck(dataKey: Uint8Array, keyCheck: string): void {
  const all = fromB64(keyCheck);
  const pt = open(dataKey, all.subarray(0, NONCE_BYTES), all.subarray(NONCE_BYTES), 'lmk1|check');
  if (fromUtf8(pt) !== KEY_CHECK) throw new CryptoError('wrong-key');
}

export interface NewVault {
  header: LmJson;
  dataKey: Uint8Array;
  /** Shown to the user once (SYNC.md §8 step 3). */
  recoveryKey: string;
}

export function createVault(
  passphrase: string,
  cost: { opslimit: number; memlimit: number },
  createdAt: string,
  existingDataKey?: Uint8Array,
): NewVault {
  const dataKey = existingDataKey ?? randomBytes(KEY_BYTES);
  const recovery = newRecoveryKeyBytes();
  const kdf = newKdfParams(cost);
  const kek = deriveKek(passphrase, kdf);
  const header: LmJson = {
    format: 'life-manager',
    version: 1,
    kdf,
    wrappedKeys: [wrap(kek, dataKey, 'passphrase'), wrap(recovery, dataKey, 'recovery')],
    keyCheck: makeKeyCheck(dataKey),
    createdAt,
  };
  return { header, dataKey, recoveryKey: encodeRecoveryKey(recovery) };
}

function unwrap(header: LmJson, kek: Uint8Array, kind: WrappedKey['kind']): Uint8Array {
  const w = header.wrappedKeys.find((k) => k.kind === kind);
  if (!w) throw new CryptoError('bad-format');
  let dataKey: Uint8Array;
  try {
    dataKey = open(kek, fromB64(w.nonce), fromB64(w.ct), wrapAd(kind));
  } catch {
    throw new CryptoError('wrong-key');
  }
  verifyKeyCheck(dataKey, header.keyCheck);
  return dataKey;
}

export function unlockWithPassphrase(header: LmJson, passphrase: string): Uint8Array {
  return unwrap(header, deriveKek(passphrase, header.kdf), 'passphrase');
}

export function unlockWithRecoveryKey(header: LmJson, recoveryKey: string): Uint8Array {
  return unwrap(header, decodeRecoveryKey(recoveryKey), 'recovery');
}

/** Passphrase change (SYNC.md §9): rewrap the same data key under a new passphrase. */
export function rewrapPassphrase(
  header: LmJson,
  dataKey: Uint8Array,
  newPassphrase: string,
  cost: { opslimit: number; memlimit: number },
): LmJson {
  verifyKeyCheck(dataKey, header.keyCheck);
  const kdf = newKdfParams(cost);
  const kek = deriveKek(newPassphrase, kdf);
  return {
    ...header,
    kdf,
    wrappedKeys: [
      wrap(kek, dataKey, 'passphrase'),
      ...header.wrappedKeys.filter((k) => k.kind !== 'passphrase'),
    ],
  };
}

/** Replace the recovery key (e.g. after it was exposed). Returns the new one to show. */
export function rotateRecoveryKey(
  header: LmJson,
  dataKey: Uint8Array,
): { header: LmJson; recoveryKey: string } {
  verifyKeyCheck(dataKey, header.keyCheck);
  const recovery = newRecoveryKeyBytes();
  return {
    header: {
      ...header,
      wrappedKeys: [
        ...header.wrappedKeys.filter((k) => k.kind !== 'recovery'),
        wrap(recovery, dataKey, 'recovery'),
      ],
    },
    recoveryKey: encodeRecoveryKey(recovery),
  };
}

/** Validate untrusted `lm.json` bytes (SYNC.md §2). */
export function parseLmJson(text: string): LmJson {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new CryptoError('bad-format');
  }
  const o = raw as Partial<LmJson> | null;
  const isStr = (v: unknown): v is string => typeof v === 'string';
  if (
    !o ||
    o.format !== 'life-manager' ||
    o.version !== 1 ||
    !o.kdf ||
    o.kdf.alg !== 'argon2id' ||
    typeof o.kdf.opslimit !== 'number' ||
    typeof o.kdf.memlimit !== 'number' ||
    !isStr(o.kdf.salt) ||
    !Array.isArray(o.wrappedKeys) ||
    !o.wrappedKeys.every(
      (w) => (w.kind === 'passphrase' || w.kind === 'recovery') && isStr(w.nonce) && isStr(w.ct),
    ) ||
    !isStr(o.keyCheck) ||
    !isStr(o.createdAt)
  ) {
    throw new CryptoError('bad-format');
  }
  return o as LmJson;
}

export function serializeLmJson(h: LmJson): string {
  return `${JSON.stringify(h, null, 2)}\n`;
}
