import { sha1 } from '@noble/hashes/legacy.js';

// Git's blob id: SHA-1 over "blob <len>\0" + content. Not a security
// primitive here; it's how the forge names content, and computing it locally
// lets the engine record what it pushed without re-reading trees (SYNC.md §5).
export function gitBlobSha(content: Uint8Array): string {
  const header = new TextEncoder().encode(`blob ${String(content.length)}\0`);
  const all = new Uint8Array(header.length + content.length);
  all.set(header);
  all.set(content, header.length);
  return Array.from(sha1(all), (b) => b.toString(16).padStart(2, '0')).join('');
}
