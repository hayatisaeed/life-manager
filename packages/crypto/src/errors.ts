/**
 * Every failure in @lm/crypto is an LmCryptoError with a stable code. Messages
 * are fixed strings: they never include keys, plaintext, passphrases or file
 * contents, so callers can log them without `redact()`.
 */
export type LmCryptoErrorCode =
  | 'not-ready'
  | 'invalid-input'
  | 'malformed'
  | 'auth-failed'
  | 'wrong-passphrase'
  | 'wrong-recovery-key'
  | 'unsupported-version';

export class LmCryptoError extends Error {
  override readonly name = 'LmCryptoError';
  constructor(
    readonly code: LmCryptoErrorCode,
    message: string,
  ) {
    super(message);
  }
}
