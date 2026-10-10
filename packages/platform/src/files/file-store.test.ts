import { describe, expect, it } from 'vitest';
import { assertFileName, createMemoryFileStore } from './file-store';

describe('memory file store', () => {
  it('writes, reads, lists and deletes copies of the bytes', async () => {
    const fs = createMemoryFileStore();
    const bytes = new Uint8Array([1, 2, 3]);
    await fs.write('b.lmb', bytes);
    await fs.write('a.lmb', new Uint8Array([9]));
    bytes[0] = 99;
    expect(await fs.read('b.lmb')).toEqual(new Uint8Array([1, 2, 3]));
    expect(await fs.list()).toEqual(['a.lmb', 'b.lmb']);
    await fs.delete('b.lmb');
    await fs.delete('b.lmb');
    expect(await fs.read('b.lmb')).toBeNull();
  });

  it('rejects names that could escape the directory', () => {
    for (const bad of ['', '.', '..', 'a/b', 'a\\b', 'x'.repeat(256)]) {
      expect(() => assertFileName(bad)).toThrow(/Invalid file name/);
    }
    expect(() => assertFileName('ab.lmb')).not.toThrow();
  });
});
