// lm.json: the plaintext repo header (SYNC.md §2). Holds the Argon2id
// parameters, the data key wrapped by the passphrase and by the recovery key,
// and a key check. Nothing in it is secret.
import { z } from 'zod';
import { concat, fromB64, fromUtf8, toB64, utf8 } from './encoding';
import { LmCryptoError } from './errors';
import {
  DEFAULT_KDF,
  KDF_LIMITS,
  NONCE_BYTES,
  SALT_BYTES,
  deriveKek,
  deriveSubKey,
  open,
  randomBytes,
  randomKey,
  seal,
  assertKdfParams,
  type KdfParams,
  type Key,
} from './primitives';
import { generateRecoveryKey, type RecoveryKey } from './recovery';

export const LM_FORMAT = 'life-manager';
export const LM_VERSION = 1;

export type DataKey = Key;
export type WrapKind = 'passphrase' | 'recovery';

const KEY_CHECK = 'lm-key-check';

const b64 = z.string().regex(/^[A-Za-z0-9+/]*={0,2}$/);
const localDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const wrappedKeySchema = z.looseObject({
  kind: z.enum(['passphrase', 'recovery']),
  nonce: b64,
  ct: b64,
});

// looseObject keeps unknown fields so a rewrap by this version doesn't drop
// anything a newer v1 writer added.
const lmJsonSchema = z.looseObject({
  format: z.literal(LM_FORMAT),
  version: z.literal(LM_VERSION),
  kdf: z.looseObject({
    alg: z.literal('argon2id'),
    opslimit: z.number().int().min(KDF_LIMITS.opslimit.min).max(KDF_LIMITS.opslimit.max),
    memlimit: z
      .number()
      .int()
      .min(KDF_LIMITS.memlimit.min)
      .max(KDF_LIMITS.memlimit.max)
      .multipleOf(1024),
    salt: b64,
  }),
  wrappedKeys: z
    .array(wrappedKeySchema)
    .refine((ks) => new Set(ks.map((k) => k.kind)).size === ks.length, 'duplicate kind'),
  keyCheck: b64,
  createdAt: localDate,
});

export type LmJson = z.infer<typeof lmJsonSchema>;

/** Parses and validates lm.json text read from the repo. */
export function parseLmJson(text: string): LmJson {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new LmCryptoError('malformed', 'lm.json is not valid JSON');
  }
  if (
    typeof raw === 'object' &&
    raw !== null &&
    'format' in raw &&
    raw.format === LM_FORMAT &&
    'version' in raw &&
    typeof raw.version === 'number' &&
    raw.version > LM_VERSION
  ) {
    throw new LmCryptoError('unsupported-version', 'lm.json was written by a newer app version');
  }
  const parsed = lmJsonSchema.safeParse(raw);
  if (!parsed.success) throw new LmCryptoError('malformed', 'lm.json does not match the schema');
  return parsed.data;
}

export function serializeLmJson(lm: LmJson): string {
  return `${JSON.stringify(lm, null, 2)}\n`;
}

const wrapAd = (kind: WrapKind) => `lmk1|${kind}`;
const CHECK_AD = 'lmc1|key-check';

function wrap(kek: Key, kind: WrapKind, dataKey: DataKey) {
  const sealed = seal(kek, dataKey, wrapAd(kind));
  return {
    kind,
    nonce: toB64(sealed.subarray(0, NONCE_BYTES)),
    ct: toB64(sealed.subarray(NONCE_BYTES)),
  };
}

function makeKeyCheck(dataKey: DataKey): string {
  return toB64(seal(deriveSubKey(dataKey, 'check'), utf8(KEY_CHECK), CHECK_AD));
}

export interface NewRepoKeys {
  lmJson: LmJson;
  dataKey: DataKey;
  recoveryKey: RecoveryKey;
}

/**
 * First device on an empty repo (SYNC.md §8): makes a data key and a recovery
 * key and wraps the data key with both. `createdAt` is injected (LocalDate).
 */
export function createLmJson(opts: {
  passphrase: string;
  createdAt: string;
  kdf?: KdfParams;
}): NewRepoKeys {
  const kdf = opts.kdf ?? DEFAULT_KDF;
  const salt = randomBytes(SALT_BYTES);
  const dataKey = randomKey();
  const recoveryKey = generateRecoveryKey();
  const lmJson = parseLmJson(
    JSON.stringify({
      format: LM_FORMAT,
      version: LM_VERSION,
      kdf: { alg: 'argon2id', ...kdf, salt: toB64(salt) },
      wrappedKeys: [
        wrap(deriveKek(opts.passphrase, salt, kdf), 'passphrase', dataKey),
        wrap(recoveryKey, 'recovery', dataKey),
      ],
      keyCheck: makeKeyCheck(dataKey),
      createdAt: opts.createdAt,
    }),
  );
  return { lmJson, dataKey, recoveryKey };
}

function unwrap(lm: LmJson, kind: WrapKind, kek: Key, failure: LmCryptoError): DataKey {
  const entry = lm.wrappedKeys.find((k) => k.kind === kind);
  if (!entry) throw new LmCryptoError('malformed', `lm.json has no ${kind} key`);
  let dataKey: DataKey;
  try {
    dataKey = open(kek, concat(fromB64(entry.nonce), fromB64(entry.ct)), wrapAd(kind)) as DataKey;
  } catch (e) {
    if (e instanceof LmCryptoError && e.code === 'auth-failed') throw failure;
    throw e;
  }
  // The wrap already authenticates; the check catches an lm.json whose wraps
  // and key check were assembled from different repos.
  if (!keyCheckMatches(lm, dataKey))
    throw new LmCryptoError('malformed', 'lm.json key check failed');
  return dataKey;
}

export function unlockWithPassphrase(lm: LmJson, passphrase: string): DataKey {
  const kek = deriveKek(passphrase, fromB64(lm.kdf.salt), lm.kdf);
  return unwrap(lm, 'passphrase', kek, new LmCryptoError('wrong-passphrase', 'wrong passphrase'));
}

export function unlockWithRecoveryKey(lm: LmJson, recoveryKey: RecoveryKey): DataKey {
  return unwrap(
    lm,
    'recovery',
    recoveryKey,
    new LmCryptoError('wrong-recovery-key', 'wrong recovery key'),
  );
}

/**
 * Passphrase change (SYNC.md §9): new salt, optionally new Argon2id
 * parameters, same data key. The recovery wrap is untouched.
 */
export function rewrapPassphrase(
  lm: LmJson,
  dataKey: DataKey,
  newPassphrase: string,
  kdf: KdfParams = { opslimit: lm.kdf.opslimit, memlimit: lm.kdf.memlimit },
): LmJson {
  assertSameKey(lm, dataKey);
  assertKdfParams(kdf);
  const salt = randomBytes(SALT_BYTES);
  return {
    ...lm,
    kdf: { ...lm.kdf, ...kdf, salt: toB64(salt) },
    wrappedKeys: replaceWrap(lm, wrap(deriveKek(newPassphrase, salt, kdf), 'passphrase', dataKey)),
  };
}

/** Issues a new recovery key; the old one stops working. */
export function rewrapRecoveryKey(
  lm: LmJson,
  dataKey: DataKey,
): { lmJson: LmJson; recoveryKey: RecoveryKey } {
  assertSameKey(lm, dataKey);
  const recoveryKey = generateRecoveryKey();
  return {
    lmJson: { ...lm, wrappedKeys: replaceWrap(lm, wrap(recoveryKey, 'recovery', dataKey)) },
    recoveryKey,
  };
}

function replaceWrap(lm: LmJson, next: ReturnType<typeof wrap>) {
  return [...lm.wrappedKeys.filter((k) => k.kind !== next.kind), next];
}

function keyCheckMatches(lm: LmJson, dataKey: DataKey): boolean {
  try {
    return (
      fromUtf8(open(deriveSubKey(dataKey, 'check'), fromB64(lm.keyCheck), CHECK_AD)) === KEY_CHECK
    );
  } catch {
    return false;
  }
}

/** Refuses to rewrap with a key that isn't this repo's data key. */
function assertSameKey(lm: LmJson, dataKey: DataKey): void {
  if (!keyCheckMatches(lm, dataKey)) {
    throw new LmCryptoError('invalid-input', 'data key does not belong to this lm.json');
  }
}
