import { LmCryptoError } from './errors';
import { sodium } from './sodium';

export const utf8 = (s: string): Uint8Array => sodium().from_string(s);
export const fromUtf8 = (b: Uint8Array): string => sodium().to_string(b);

export function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

export const toHex = (b: Uint8Array): string => sodium().to_hex(b);

/** Standard base64 with padding (RFC 4648 §4), used in lm.json. */
export const toB64 = (b: Uint8Array): string =>
  sodium().to_base64(b, sodium().base64_variants.ORIGINAL);

/** base64url without padding (RFC 4648 §5), used in `.lmr` files. */
export const toB64url = (b: Uint8Array): string =>
  sodium().to_base64(b, sodium().base64_variants.URLSAFE_NO_PADDING);

export function fromB64(s: string): Uint8Array {
  return decode(s, sodium().base64_variants.ORIGINAL);
}

export function fromB64url(s: string): Uint8Array {
  return decode(s, sodium().base64_variants.URLSAFE_NO_PADDING);
}

function decode(s: string, variant: number): Uint8Array {
  try {
    return sodium().from_base64(s, variant);
  } catch {
    throw new LmCryptoError('malformed', 'invalid base64');
  }
}
