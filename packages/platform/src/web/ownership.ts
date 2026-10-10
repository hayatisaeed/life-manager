/**
 * One tab owns the database at a time (ADR-011): `opfs-sahpool` allows a
 * single connection per origin. Ownership is a Web Lock held for as long as
 * the tab keeps the database open.
 */
export interface Ownership {
  /** Resolves if another tab takes the lock over ("use it here"). */
  readonly lost: Promise<void>;
  /** Gives the lock up. */
  release(): void;
}

/**
 * Claims the lock. Returns null if another tab holds it, unless `steal` is
 * set, which takes it over; the other tab then sees `lost` resolve.
 */
export function claimOwnership(name: string, { steal = false } = {}): Promise<Ownership | null> {
  return new Promise((resolve) => {
    let release: () => void = noop;
    const held = new Promise<void>((r) => {
      release = r;
    });
    let markLost: () => void = noop;
    const lost = new Promise<void>((r) => {
      markLost = r;
    });
    navigator.locks
      .request(name, steal ? { steal: true } : { ifAvailable: true }, async (lock) => {
        if (!lock) {
          resolve(null);
          return;
        }
        resolve({ lost, release });
        await held;
      })
      // A stolen lock rejects the original request with an AbortError.
      .catch(() => markLost());
  });
}

const noop = () => undefined;

/** Uniform [0, 1) from the platform CSPRNG, for ULIDs and device ids (core's `Rng`). */
export function cryptoRng(): number {
  const [n = 0] = crypto.getRandomValues(new Uint32Array(1));
  return n / 2 ** 32;
}
