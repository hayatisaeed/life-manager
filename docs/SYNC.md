# Sync Protocol

Sync goes through the user's **private GitHub or GitLab repository**, accessed
**only through the forge HTTP APIs**. Nothing is ever cloned. Every file in the
repo is ciphertext.

Goals, in priority order:

1. **Never lose data.**
2. **Converge:** all devices reach the same state.
3. **Work offline indefinitely.**
4. **Leak as little as possible** to the forge.
5. **Stay inside API rate limits.**

## 1. Repo layout

```
lm.json                         plaintext header (see §2)
r/<s1>/<s2>/<name>.lmr          one encrypted record per file
b/<s1>/<s2>/<name>.lmb          one encrypted attachment blob per file
```

- `name = hex(BLAKE2b-256(key = pathKey, msg = recordId))`. For blobs, the
  message is the plaintext content hash.
- `s1` and `s2` are the first and second byte of `name` in hex. That gives
  65,536 leaf directories, so each tree stays small and the Merkle walk (§5)
  stays cheap.
- `.lmr` file content is **ASCII text**: `LMR1.` followed by base64url of
  `nonce(24) ‖ ciphertext`. Text is used so files can be created inline in tree
  payloads and read through GraphQL `Blob.text`.
- `.lmb` file content is **binary**: `LMB1` ‖ `nonce(24)` ‖ `ciphertext`.
- Blob size cap: **25 MB** after encryption (configurable, hard maximum 50 MB).
  Larger attachments stay on the device only, and the UI says so.
- **Branch:** the configured repository's default branch. Maintenance migrates
  to a fresh private repository (§9); it never force-replaces an active branch.
- **Commit message:** always `sync`. The author is `Life Manager
  <noreply@invalid>`. The commit has no device identifiers in plaintext.

## 2. `lm.json`

```json
{
  "format": "life-manager",
  "version": 2,
  "kdf": { "alg": "argon2id", "opslimit": 3, "memlimit": 268435456, "salt": "<b64>" },
  "wrappedKeys": [
    { "kind": "passphrase", "nonce": "<b64>", "ct": "<b64>" },
    { "kind": "recovery",   "nonce": "<b64>", "ct": "<b64>" }
  ],
  "keyCheck": "<b64 AEAD of constant 'lm-key-check'>",
  "createdAt": "2026-10-09",
  "control": "LMC2.<authenticated encrypted control>"
}
```

Version 2 adds authenticated encrypted control: vault identity, generation,
write nonce and maintenance state. Its exact encoding, header-binding tuple,
strict schemas and migration receipts are specified in
[the maintenance protocol §4](SYNC-MAINTENANCE-PROPOSAL.md#4-proposed-vault-version-2-and-authenticated-write-gate).
Every ordinary commit updates this control with a fresh nonce. Read and
validate `lm.json` at the pinned head on **every** cycle; only an authenticated
`active` control with the configured vault identity and generation permits
ordinary writes. Unknown versions require an update; generation/identity
changes require recovery; frozen/staging/redirect states block ordinary sync.
Legacy v1 crypto remains readable, but this sync implementation refuses v1
writes until an explicit upgrade initializes control.

- `lm.json` is created once, when the first device initializes an empty repo.
- If it already exists, a joining device unlocks it with the passphrase or the
  recovery key.
- If the repo is not empty and has no `lm.json`, the app refuses to use it.

## 3. Record envelope (the plaintext inside `.lmr`)

```json
{
  "id": "01J9...ULID",
  "type": "task",
  "schema": 1,
  "hlc": "2026-10-09T10:15:00.000Z-0003-devA",
  "fieldHlc": { "title": "…", "dueAt": "…" },
  "textVersions": {},
  "deletedAt": null,
  "data": { "title": "Call mom", "dueAt": "2026-10-10", "tags": ["family"] }
}
```

- The AEAD associated data is `"lmr1|" + remotePath` (ADR-011). A joining
  device can decrypt before knowing the ID. After decryption, verify that the
  ID maps to that exact keyed path. A relocated file fails authentication. The
  engine preserves rejected ciphertext and reports an error.
- **HLC format:** `ISO-millis-counter(4 hex)-deviceId`. These strings sort
  lexicographically in time order. Each device keeps one HLC; it is advanced on
  every local write and on receiving a remote HLC.

## 4. Local bookkeeping

| Table | Purpose |
|---|---|
| `sync_meta` | Forge config, `lastSyncedCommit`, `deviceId`, HLC state |
| `sync_remote` | `path → blobSha` and `dir → treeSha` as of `lastSyncedCommit` |
| `sync_base` | `recordId → plaintext envelope` as of the last sync. This is the merge base. |
| `change_log` | Record ids and captured HLCs changed locally since successful acknowledgment |
| `sync_problems` | Every rejected ciphertext variant by opaque path and redacted reason; unresolved variants block writes; resolved variants remain exportable |
| `record_origins` | Durable local creation/ever-synced ledger for safe offline recovery |

**Merge base without git:** "base" is whatever this device last pushed or
accepted for a record. The forge's commit graph isn't needed, so the forge can
stay a plain linear history.

## 5. Sync cycle

```
1. head ← transport.getHead(); authenticate lm.json at that head
   require active control with the expected vault identity/generation
2. if head ≠ lastSyncedCommit:
     changed ← diffTrees(lastSyncedCommit snapshot in sync_remote, head)   // Merkle walk
     blobs   ← transport.readBlobs(changed)                                // batched
     for each changed path:
        theirs ← decrypt(blob)              (skip + report if it fails)
        ours   ← local record (or none)
        base   ← sync_base[id] (or none)
        if id ∉ change_log: apply(theirs);                  sync_base[id] ← theirs
        else:               merged ← merge(base, ours, theirs)
                            write merged locally;            sync_base[id] ← theirs
                            (id stays in change_log, because merged ≠ theirs)
     update sync_remote to the head snapshot
3. if change_log is non-empty:
     files ← encrypt(each dirty, known, unblocked record) + fresh lm.json control
     newHead ← transport.commit(parent = head, files)    // CAS on branch
       on conflict → go to 1 (exponential backoff, max 5 tries per cycle)
     sync_base[id] ← pushed envelope; clear change_log only where id AND hlc match
     obtain actual new blob/tree SHAs from a pinned Merkle read-back
     update sync_remote with the returned blob/tree SHAs
4. lastSyncedCommit ← newHead or head
```

**When sync runs:**

- On app start and on resume.
- 30 seconds after the last local edit (debounced).
- Every 5 minutes while in the foreground.
- From a manual "Sync now".
- Only one cycle runs at a time per device, enforced with a lock. In the web
  build, a Web Locks API lock prevents two tabs from syncing at once.

**Merkle walk:**

- Start by comparing the root tree SHA, then `r/`, then each `s1` directory,
  then each `s2` directory. Only subtrees whose SHA changed are fetched.
- On GitHub, a single recursive tree call is used instead when the repo has
  fewer than about 50k entries. GitHub truncates recursive trees above 100k
  entries or 7 MB.

## 6. Merge rules

`merge(base, ours, theirs)` works field by field over `data`, plus `deletedAt`:

| Situation | Result |
|---|---|
| Field changed on one side only | That side's value |
| Scalar changed on both sides | The value with the higher `fieldHlc`; ties go to the lexicographically larger deviceId |
| Set or array of ids (tags, links, participants) | `base + (oursAdded ∪ theirsAdded) − (oursRemoved ∪ theirsRemoved)` |
| Ordered list (routine steps, checklist) | Merged by item id, using the scalar rule for order keys (fractional indexing) |
| Long text (`body`, `notes`, `content`) | Union original edit graphs (`textVersions`, ADR-013), render live heads in HLC order using diff3 against their newest common ancestor. Overlapping hunks keep both versions in fenced conflict blocks and set `hasConflict = true` |
| Deleted on one side, edited on the other | The edit wins and the record is undeleted. A toast reports "restored" |
| Deleted on both sides | Deleted |
| No base (both created with the same id) | Impossible with ULIDs. Treat as a scalar merge with an empty base |

Long-text metadata stores `{clock,value,parents}` per original edit. Local
text writes must call `editText` so the new version supersedes every current
head. The graph is append-only until safe compaction is specified. Invalid
ancestry and clock collisions are preserved as sync problems.

**Properties:** the rules must be commutative and idempotent. The convergence
simulator checks both.

## 7. Transports

```ts
interface SyncTransport {
  getHead(): Promise<CommitSha>;
  getRoot(commit: CommitSha): Promise<TreeSha>;
  getTree(sha: TreeSha, path: string): Promise<TreeEntry[]>;          // non-recursive
  getTreeRecursive?(commit: CommitSha): Promise<TreeEntry[] | 'truncated'>;
  readBlobs(entries: { path: string; sha: BlobSha }[]): Promise<Map<string, Uint8Array>>;
  readFile(path: string, ref: CommitSha): Promise<Uint8Array | null>;   // lm.json
  commit(parent: CommitSha, changes: FileChange[]): Promise<CommitSha | 'conflict'>;
  rateLimit(): RateLimitState;
}
```

### GitHub (github.com and GitHub Enterprise; configurable API base)

- **Head:** `GET /repos/{o}/{r}/git/ref/heads/{branch}`.
- **Trees:** `GET /repos/{o}/{r}/git/trees/{sha}`, with `?recursive=1` where
  appropriate.
- **Blob reads:**
  - Batch with **GraphQL**: about 100 aliased `object(oid:)` lookups per query,
    returning `... on Blob { text }`.
  - Binary `.lmb` files are read with `GET /git/blobs/{sha}`, which returns
    base64.
- **Commit:**
  1. Create ciphertext blobs with `POST /git/blobs` using base64.
  2. `POST /git/trees` with `base_tree` set to the parent's tree and created
     blob SHAs. Text records may later go inline as `content` after benchmarking.
  3. `POST /git/commits` with the parent commit.
  4. `PATCH /git/refs/heads/{branch}` with `force: false`. Classify a genuine
     non-fast-forward race as `'conflict'`; a 422 can also mean validation or
     abuse limiting and must not always be treated as a race.
- **Token:** a fine-grained PAT limited to this one repo, with **Contents:
  Read and write** and **Metadata: Read**.
- **Rate limits:** 5,000 REST requests per hour and 5,000 GraphQL points per
  hour. The engine tracks the `x-ratelimit-*` headers and backs off.

### GitLab (gitlab.com and self-managed; configurable base URL)

- **Head:** `GET /projects/:id/repository/branches/:branch`.
- **Trees:** `GET /projects/:id/repository/tree?path=&ref=&per_page=100`, with
  keyset pagination. Entries carry `id`, which is the object SHA.
- **Blob reads:**
  - `GET /projects/:id/repository/blobs/:sha/raw`, with bounded concurrency
    (6).
  - For a first sync, try the archive endpoint
    (`/repository/archive.tar.gz?sha=`) first. **This needs a spike** to check
    CORS and size behavior.
- **Commit:** `POST /projects/:id/repository/commits` with `branch`,
  `start_sha` set to the parent commit, and `actions[]` (create, update, delete;
  `encoding: base64` for binary).
- **CAS/write fence:** every commit, including create-only batches, updates
  `lm.json` with fresh encrypted control and its last known **file commit ID**
  as `last_commit_id`. Read this ID at the pinned head; it is not necessarily
  the branch head. The header action and record actions must succeed or fail
  together. Per-record update/delete actions also carry their file commit IDs.
  A changed gate means conflict/re-read. This is the accepted protocol direction,
  but real-forge atomic-gate/CORS tests are required before enabling support.
- **Token:** a project access token (Developer role) or a PAT with the `api`
  scope. GitLab's REST writes need `api`.

### Fake (tests)

An in-memory implementation with exactly the CAS semantics above. Tests can
inject latency, 422/409 conflicts, rate-limit responses and truncation.

## 8. Onboarding flow

1. The user picks GitHub or GitLab and enters the host (default is the cloud
   service), the repo, and a token. Inline guides show how to create a
   **private empty repo** and a token with the minimum scopes.
2. The app checks the repo:
   - It must be private. A public repo is refused. A public repo would hold only
     ciphertext, but it's still refused for defense in depth.
   - The token must have write access.
3. **Empty repo:**
   1. Choose a passphrase (with a strength meter, zxcvbn).
   2. Generate the data key and the recovery key.
   3. Show the recovery key and require the user to confirm they saved it.
   4. Write `lm.json`, then do the first push.
4. **Existing repo:** enter the passphrase or the recovery key, then do the
   initial download with a progress bar.
5. **Merging local data:** if the device already has local data, it is merged
   in like any other change.

## 9. Maintenance

[The accepted maintenance and recovery protocol](SYNC-MAINTENANCE-PROPOSAL.md)
(ADR-016) supersedes the original orphan-commit/180-day-purge sketch:

- Retain tombstones, causal text versions and snapshot attachments indefinitely.
  A full resync must not erase evidence of deletion or stale text ancestry.
- History compaction and key rotation migrate a fenced, complete snapshot to a
  user-configured empty private repository. Keep the source as a recovery archive.
- Verify the complete destination by pinned reads before publishing an encrypted
  source redirect. Activate staging after redirect; crash intervals are resumable.
- Rotation uses an independent data key/new passphrase/recovery key and changes
  every derived key/path. Missing blob-hash inventory, unknown codecs and
  undecryptable files block rotation before redirect. Preserve all data.
- Returning devices retain records, dirty versions, bases and attachment keys,
  stage the full destination, merge pending edits, then switch atomically.
  Missing previously synced records require a repair preview; absence never
  instructs automatic deletion/re-creation.
- Passphrase changes gate an authenticated header rewrap, keeping the data key
  and recovery wrap. They do not revoke previously exposed keys/headers.
- No automatic source deletion, forced active-branch replacement, age-based
  pruning, timer takeover or automatic cross-origin redirect/token forwarding.
- Maintenance UI remains unavailable until protocol §11 acceptance tests pass.

## 10. Error handling

Clean pulls also reject HLC regressions or loss/collision of retained original
text ancestry. Quarantine the received ciphertext and retain the local record;
do not treat a valid older AEAD payload as permission to erase newer history.
SQL/IO failures roll back the entire pull rather than becoming per-record
validation problems. Locking during an in-flight cycle aborts at async boundaries
before any later crypto use, so disposed keys can never encrypt outgoing data.


- **Network or 5xx errors:** retry with jitter. Sync is never blocking: the UI
  shows a status pill (synced, syncing, offline, error).
- **Expired or revoked token:** pause sync and show a banner to fix it in
  Settings.
- **Undecryptable file:** skip it, keep a list under Settings → Sync →
  Problems, and never delete it.
- **Record with a newer `schema` than this app understands:** keep the raw
  envelope and don't overwrite it. Show an "update the app" banner.
