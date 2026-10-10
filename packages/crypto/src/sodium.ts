import sodiumLib from 'libsodium-wrappers-sumo';
import { LmCryptoError } from './errors';

export type Sodium = typeof sodiumLib;

let lib: Sodium | null = null;

/** Loads the libsodium wasm module. Await once at startup before any other call. */
export async function initCrypto(): Promise<void> {
  await sodiumLib.ready;
  lib = sodiumLib;
}

/** The initialized libsodium instance. */
export function sodium(): Sodium {
  if (!lib) throw new LmCryptoError('not-ready', 'initCrypto() has not completed');
  return lib;
}
