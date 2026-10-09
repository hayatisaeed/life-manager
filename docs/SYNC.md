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
- **Branch:** the repo's default branch. The app never creates other branches,
  except during compaction (§9).
- **Commit message:** always `sync`. The author is `Life Manager
  <noreply@invalid>`. The commit has no device identifiers in plaintext.

## 2. `lm.json`

```json
{
  "format": "life-manager",
  "version": 1,
  "kdf": { "alg": "argon2id", "opslimit": 3, "memlimit": 268435456, "salt": "<b64>" },
  "wrappedKeys": [
    { "kind": "passphrase", "nonce": "<b64>", "ct": "<b64>" },
    { "kind": "recovery",   "nonce": "<b64>", "ct": "<b64>" }
  ],
  "keyCheck": "<b64 AEAD of constant 'lm-key-check'>",
  "createdAt": "2026-10-09"
}
```

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
  "deletedAt": null,
  "data": { "title": "Call mom", "dueAt": "2026-10-10", "tags": ["family"] }
}
```

- The AEAD associated data is `"lmr1|" + id`. A file moved to another record's
  path therefore fails to decrypt, and the engine skips it and logs an error.
- **HLC format:** `ISO-millis-counter(4 hex)-deviceId`. These strings sort
  lexicographically in time order. Each device keeps one HLC; it is advanced on
  every local write and on receiving a remote HLC. Implemented in
  `packages/core/src/hlc.ts` (ADR-012):
  - The ISO part is always `YYYY-MM-DDTHH:mm:ss.sssZ` (24 characters, up to
    year 9999). The counter is 4 lowercase hex digits. The `deviceId` is 1–32
    ASCII letters or digits, for example a ULID. Every part before the device
    id is fixed width, so string order equals `(time, counter, deviceId)`
    order. Always compare with plain code-unit comparison, never
    `localeCompare`.
  - If the counter would pass `ffff`, the clock moves to the next millisecond
    and the counter resets to 0.
  - A remote HLC from the future is adopted, never rejected, because
    rejecting it would mean refusing a record.

## 4. Local bookkeeping

| Table | Purpose |
|---|---|
| `sync_meta` | Forge config, `lastSyncedCommit`, `deviceId`, HLC state |
| `sync_remote` | `path → blobSha` and `dir → treeSha` as of `lastSyncedCommit` |
| `sync_base` | `recordId → plaintext envelope` as of the last sync. This is the merge base. |
| `change_log` | Record ids changed locally since the last successful push |

**Merge base without git:** "base" is whatever this device last pushed or
accepted for a record. The forge's commit graph isn't needed, so the forge can
stay a plain linear history.

## 5. Sync cycle

```
1. head ← transport.getHead()
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
     files ← encrypt(each dirty record)
     newHead ← transport.commit(parent = head, files)    // CAS on branch
       on conflict → go to 1 (exponential backoff, max 5 tries per cycle)
     sync_base[id] ← pushed envelope; clear change_log entries that were pushed
     update sync_remote with the new blob SHAs (computed locally: git blob SHA-1)
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
| Long text (`body`, `notes`, `content`) | diff3. On overlapping hunks, keep both versions in a fenced conflict block and set `hasConflict = true`; the UI shows a banner |
| Deleted on one side, edited on the other | The edit wins and the record is undeleted. A toast reports "restored" |
| Deleted on both sides | Deleted |
| No base (both created with the same id) | Impossible with ULIDs. Treat as a scalar merge with an empty base |

**Properties:** the rules must be commutative and idempotent. The convergence
simulator checks both.

## 7. Transports

```ts
interface SyncTransport {
  getHead(): Promise<CommitSha>;
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
  1. Create binary blobs with `POST /git/blobs`.
  2. `POST /git/trees` with `base_tree` set to the parent's tree. Text records
     go inline as `content`; blobs go in by SHA.
  3. `POST /git/commits` with the parent commit.
  4. `PATCH /git/refs/heads/{branch}` with `force: false`. **A 422 error means
     someone else moved the branch, so return `'conflict'`.**
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
- **CAS:**
  - GitLab has no "update ref only if" operation.
  - **Approach:** every update action carries `last_commit_id`, the commit id
    of the last change to that file as this device knows it. A `create` fails if
    the file already exists. Either failure is treated as `'conflict'`.
  - Commits that only touch other files may land on a head we haven't seen.
    That is safe, because records merge per file and we pick them up on the
    next cycle.
  - `last_commit_id` per path comes from the commit response for files we
    pushed, and from the `X-Gitlab-Last-Commit-Id` header when we read a file
    through the files API.
  - **This needs a spike to verify.**
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

- **Tombstones:**
  - Deleted records stay as tombstones for 180 days, then compaction removes
    their files.
  - A device that hasn't synced for more than 180 days is told to do a "full
    resync". Its local-only changes are re-pushed as new edits.
- **Compaction** is user-triggered:
  1. Create an orphan commit containing only the live files.
  2. Move the branch to it: a forced ref update on GitHub; a new branch plus a
     default-branch switch on GitLab.
  3. Other devices detect that `lastSyncedCommit` is no longer an ancestor and
     do a full resync, comparing blob SHAs so unchanged records aren't
     re-downloaded.
- **Passphrase change:** rewrap the data key and update `lm.json`.
- **Key rotation:** re-encrypt every file in one commit, then compact so old
  ciphertext leaves the history.

## 10. Error handling

- **Network or 5xx errors:** retry with jitter. Sync is never blocking: the UI
  shows a status pill (synced, syncing, offline, error).
- **Expired or revoked token:** pause sync and show a banner to fix it in
  Settings.
- **Undecryptable file:** skip it, keep a list under Settings → Sync →
  Problems, and never delete it.
- **Record with a newer `schema` than this app understands:** keep the raw
  envelope and don't overwrite it. Show an "update the app" banner.
