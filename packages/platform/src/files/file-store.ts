/**
 * A flat directory of files owned by the app (attachments). Each platform
 * implements it over its own storage: OPFS on the web, the app data directory
 * on desktop and mobile (P0.7).
 */
export interface FileStore {
  /** The file's bytes, or null if it doesn't exist. */
  read(name: string): Promise<Uint8Array | null>;
  /** Creates or replaces the file. */
  write(name: string, bytes: Uint8Array): Promise<void>;
  /** Removes the file if it exists. */
  delete(name: string): Promise<void>;
  list(): Promise<string[]>;
}

const NAME = /^[A-Za-z0-9._-]{1,255}$/;

/** File names are flat: no separators, no `.` or `..`. */
export function assertFileName(name: string): void {
  if (!NAME.test(name) || name === '.' || name === '..') {
    throw new Error(`Invalid file name "${name}"`);
  }
}

/** In-memory store for tests and for running without persistent storage. */
export function createMemoryFileStore(): FileStore {
  const files = new Map<string, Uint8Array>();
  return {
    read: (name) => {
      assertFileName(name);
      const bytes = files.get(name);
      return Promise.resolve(bytes ? bytes.slice() : null);
    },
    write: (name, bytes) => {
      assertFileName(name);
      files.set(name, bytes.slice());
      return Promise.resolve();
    },
    delete: (name) => {
      assertFileName(name);
      files.delete(name);
      return Promise.resolve();
    },
    list: () => Promise.resolve([...files.keys()].sort()),
  };
}
