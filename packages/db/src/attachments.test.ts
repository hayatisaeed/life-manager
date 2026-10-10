import { contentHash, deriveSubKeys, encryptBlob, initCrypto, type DataKey } from '@lm/crypto';
import { createMemoryFileStore } from '@lm/platform';
import { beforeAll, describe, expect, it } from 'vitest';
import { AttachmentCorruptError, AttachmentStore } from './attachments';

const key = (fill: number) => new Uint8Array(32).fill(fill) as DataKey;
let keys: ReturnType<typeof deriveSubKeys>;

beforeAll(async () => {
  await initCrypto();
  keys = deriveSubKeys(key(1));
});

describe('attachment store', () => {
  it('stores encrypted, content-addressed files and reads them back', async () => {
    const files = createMemoryFileStore();
    const store = new AttachmentStore(files, keys);
    const bytes = new TextEncoder().encode('passport scan');
    const ref = await store.put(bytes, 'image/jpeg', 'passport.jpg');
    expect(ref).toEqual({
      hash: contentHash(bytes),
      size: bytes.length,
      mime: 'image/jpeg',
      name: 'passport.jpg',
    });
    expect(await store.put(bytes, 'image/jpeg')).toEqual({
      hash: ref.hash,
      size: bytes.length,
      mime: 'image/jpeg',
    });
    const names = await files.list();
    expect(names).toEqual([store.fileName(ref.hash)]);
    expect(names[0]).toMatch(/^[0-9a-f]{64}\.lmb$/);
    expect(names[0]).not.toContain(ref.hash);
    const stored = await files.read(names[0] ?? '');
    expect(new TextDecoder().decode(stored?.subarray(0, 4))).toBe('LMB1');
    expect(new TextDecoder().decode(stored ?? new Uint8Array())).not.toContain('passport');
    expect(await store.get(ref.hash)).toEqual(bytes);
    expect(await store.has(ref.hash)).toBe(true);
    await store.delete(ref.hash);
    expect(await store.get(ref.hash)).toBeNull();
    expect(await store.has(ref.hash)).toBe(false);
  });

  it('refuses tampered files and files from another repo, and keeps them', async () => {
    const files = createMemoryFileStore();
    const store = new AttachmentStore(files, keys);
    const ref = await store.put(new Uint8Array([1, 2, 3]), 'application/octet-stream');
    const name = store.fileName(ref.hash);
    const bytes = (await files.read(name)) ?? new Uint8Array();
    bytes[10] = (bytes[10] ?? 0) ^ 1;
    await files.write(name, bytes);
    await expect(store.get(ref.hash)).rejects.toThrow(AttachmentCorruptError);
    expect(await files.read(name)).not.toBeNull();

    const other = new AttachmentStore(files, deriveSubKeys(key(2)));
    await files.write(
      other.fileName(ref.hash),
      encryptBlob(keys, ref.hash, new Uint8Array([1, 2, 3])),
    );
    await expect(other.get(ref.hash)).rejects.toThrow(/failed to decrypt/);
  });

  it('detects content that does not match its hash', async () => {
    const files = createMemoryFileStore();
    const store = new AttachmentStore(files, keys);
    const wrongHash = contentHash(new Uint8Array([9]));
    await files.write(store.fileName(wrongHash), encryptBlob(keys, wrongHash, new Uint8Array([1])));
    await expect(store.get(wrongHash)).rejects.toThrow(/does not match/);
  });

  it('validates hashes', () => {
    const store = new AttachmentStore(createMemoryFileStore(), keys);
    expect(() => store.fileName('ABC')).toThrow(/64 lowercase hex/);
  });
});
