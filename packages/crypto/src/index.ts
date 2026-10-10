// @lm/crypto: the app's only cryptography, as thin wrappers over libsodium.
// See docs/SECURITY.md §2 and ADR-016/017. Call `await initCrypto()` first.
export { initCrypto } from './sodium';
export { LmCryptoError, type LmCryptoErrorCode } from './errors';
export { DEFAULT_KDF, KDF_LIMITS, type KdfParams, type Key } from './primitives';
export {
  generateRecoveryKey,
  parseRecoveryKey,
  recoveryKeyToBase32,
  recoveryKeyToWords,
  type RecoveryKey,
} from './recovery';
export {
  LM_FORMAT,
  LM_VERSION,
  createLmJson,
  parseLmJson,
  rewrapPassphrase,
  rewrapRecoveryKey,
  serializeLmJson,
  unlockWithPassphrase,
  unlockWithRecoveryKey,
  type DataKey,
  type LmJson,
  type NewRepoKeys,
} from './lm-json';
export {
  blobPath,
  contentHash,
  decryptBlob,
  decryptRecord,
  deriveSubKeys,
  encryptBlob,
  encryptRecord,
  recordFileName,
  recordNameFromPath,
  recordPath,
  type SubKeys,
} from './codecs';
