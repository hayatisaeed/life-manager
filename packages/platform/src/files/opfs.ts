import { assertFileName, type FileStore } from './file-store';

/**
 * A FileStore in a directory of the Origin Private File System. Used by the
 * web build for encrypted attachments (ARCHITECTURE.md §4).
 */
export async function openOpfsFileStore(directory: string): Promise<FileStore> {
  assertFileName(directory);
  const root = await navigator.storage.getDirectory();
  const dir = await root.getDirectoryHandle(directory, { create: true });
  const missing = (error: unknown) =>
    error instanceof DOMException && error.name === 'NotFoundError';
  return {
    async read(name) {
      assertFileName(name);
      try {
        const file = await (await dir.getFileHandle(name)).getFile();
        return new Uint8Array(await file.arrayBuffer());
      } catch (error) {
        if (missing(error)) return null;
        throw error;
      }
    },
    async write(name, bytes) {
      assertFileName(name);
      // createWritable writes to a swap file and replaces the target on close,
      // so a crash mid-write leaves the old file intact.
      const writable = await (await dir.getFileHandle(name, { create: true })).createWritable();
      await writable.write(new Uint8Array(bytes));
      await writable.close();
    },
    async delete(name) {
      assertFileName(name);
      try {
        await dir.removeEntry(name);
      } catch (error) {
        if (!missing(error)) throw error;
      }
    },
    async list() {
      const names: string[] = [];
      // `keys()` exists on FileSystemDirectoryHandle in every browser with OPFS.
      for await (const name of (dir as unknown as { keys(): AsyncIterable<string> }).keys())
        names.push(name);
      return names.sort();
    },
  };
}
