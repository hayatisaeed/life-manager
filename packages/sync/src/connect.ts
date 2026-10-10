// Onboarding helpers (SYNC.md §8): inspect a repo, initialise an empty one
// with `lm.json`, or unlock an existing one.

import type { LmJson, NewVault } from '@lm/crypto';
import {
  createVault,
  parseLmJson,
  serializeLmJson,
  unlockWithPassphrase,
  unlockWithRecoveryKey,
} from '@lm/crypto';
import type { SyncTransport } from './transport';

export type RepoInspection =
  | { kind: 'empty'; head: string | null }
  | { kind: 'initialized'; head: string; header: LmJson }
  | { kind: 'foreign'; head: string }
  | { kind: 'public' };

/** Files a freshly created GitHub/GitLab repo may already contain. */
const STARTER_FILES = /^(README(\.md)?|LICENSE(\.md|\.txt)?|\.gitignore|\.gitattributes)$/i;

export async function inspectRepo(t: SyncTransport): Promise<RepoInspection> {
  const access = await t.checkAccess();
  // Defense in depth: refuse public repos even though they'd only hold ciphertext.
  if (!access.private) return { kind: 'public' };
  const head = await t.getHead();
  if (head === null) return { kind: 'empty', head: null };
  const lm = await t.readFile('lm.json', head);
  if (lm) return { kind: 'initialized', head, header: parseLmJson(new TextDecoder().decode(lm)) };
  const root = await t.listTree(head, '');
  if (root.every((e) => e.type === 'blob' && STARTER_FILES.test(e.path)))
    return { kind: 'empty', head };
  return { kind: 'foreign', head };
}

/** Write `lm.json` into an empty repo. Pass the device's existing local data key to keep local attachments readable. */
export async function initializeRepo(
  t: SyncTransport,
  head: string | null,
  passphrase: string,
  cost: { opslimit: number; memlimit: number },
  createdAt: string,
  dataKey?: Uint8Array,
): Promise<NewVault> {
  const vault = createVault(passphrase, cost, createdAt, dataKey);
  const res = await t.commit(head, [
    { action: 'upsert', path: 'lm.json', content: serializeLmJson(vault.header), exists: false },
  ]);
  if (res === 'conflict')
    throw new Error('The repository changed while it was being set up. Try again.');
  return vault;
}

export function unlockRepo(
  header: LmJson,
  secret: { passphrase: string } | { recoveryKey: string },
): Uint8Array {
  return 'passphrase' in secret
    ? unlockWithPassphrase(header, secret.passphrase)
    : unlockWithRecoveryKey(header, secret.recoveryKey);
}

/** Replace `lm.json` (passphrase change / recovery-key rotation, SYNC.md §9). */
export async function writeHeader(
  t: SyncTransport,
  header: LmJson,
  existsMeta?: string | null,
): Promise<void> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const head = await t.getHead();
    const res = await t.commit(head, [
      {
        action: 'upsert',
        path: 'lm.json',
        content: serializeLmJson(header),
        exists: true,
        meta: existsMeta ?? null,
      },
    ]);
    if (res !== 'conflict') return;
  }
  throw new Error('Could not update lm.json: the repository keeps changing.');
}
