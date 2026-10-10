// Git object ids, computed locally so we can update `sync_remote` after a push
// without re-listing trees (SYNC.md §5 step 3).

const enc = new TextEncoder();

export async function sha1Hex(bytes: Uint8Array): Promise<string> {
  const d = await globalThis.crypto.subtle.digest('SHA-1', bytes as Uint8Array<ArrayBuffer>);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** `git hash-object` for a blob. */
export async function gitBlobSha(content: string | Uint8Array): Promise<string> {
  const body = typeof content === 'string' ? enc.encode(content) : content;
  const header = enc.encode(`blob ${body.length}\0`);
  const all = new Uint8Array(header.length + body.length);
  all.set(header);
  all.set(body, header.length);
  return sha1Hex(all);
}

export const toBytes = (c: string | Uint8Array): Uint8Array =>
  typeof c === 'string' ? enc.encode(c) : c;
