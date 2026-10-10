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
  message is the content hash as hex text (hex BLAKE2b-256 of the plaintext).
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
  "keyCheck": "<b64 of nonce ‖ AEAD('lm-key-check') under the lm-chk1 sub-key>",
  "createdAt": "2026-10-09"
}
```

- `lm.json` is created once, when the first device initializes an empty repo.
  The KDF parameters are per repo (ADR-016); SECURITY.md §2 has the exact
  encodings.
- Unknown fields are kept when a device rewrites `lm.json`. A `version`
  higher than the app knows makes the app refuse to unlock and ask for an
  update.
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
  "fieldHlc": { "title": "…", "dueDate": "…" },
  "deletedAt": null,
  "createdAt": "2026-10-09T10:14:58.120Z",
  "data": { "title": "Call mom", "dueDate": "2026-10-10", "tags": ["01J9...TAG"], "…": "…" }
}
```

- **Decoding** (`decodeRecord` in `@lm/core`, ADR-013):
  1. Validate the envelope.
  2. Upgrade `data` and `fieldHlc` to the current schema.
  3. Validate `data` against the entity's zod schema.
- **Records that fail to decode are kept.** A record that fails any step is
  returned as `kept`, with one of these reasons: `malformedEnvelope`,
  `unknownType`, `futureSchema`, `upgradeFailed` or `invalidData`. The engine
  stores it untouched and never deletes it.
- **`conflicts`** (optional) lists the fields that hold an unresolved text
  conflict block (§6).
- **Unknown top-level keys are carried along.** The envelope is a loose
  object, so keys added by a newer client survive a round-trip.

- The AEAD associated data is `"lmr1|" + name`, where `name` is the file name:
  the keyed hash of the id (§1, ADR-019). A device that has never seen a
  record knows its name but not its id, so the id can't be the AD.
  - After decrypting, the engine checks that the id inside hashes to the same
    path.
  - So a file moved to another path fails to decrypt, and a file whose content
    belongs elsewhere fails the check. Either way it is kept and reported,
    never applied (§10).
- **HLC format:** `ISO-millis-counter(4 hex)-deviceId`. These strings sort
  lexicographically in time order. Each device keeps one HLC; it is advanced on
  every local write and on receiving a remote HLC.
  - The ISO part is always 24 characters (years 0000–9999) and the counter is
    lowercase hex. `deviceId` is 1–64 characters of `[0-9A-Za-z_-]`.
  - If the counter would pass `ffff` within one millisecond, the clock moves to
    the next millisecond instead of failing the write (ADR-012).
  - Malformed remote HLCs are rejected (`HlcError`), never coerced.

## 4. Local bookkeeping

| Table | Purpose |
|---|---|
| `sync_meta` | Forge config, `lastSyncedCommit`, `deviceId`, HLC state |
| `sync_remote` | `path → blobSha` and `dir → treeSha` as of `lastSyncedCommit` |
| `sync_base` | `recordId → plaintext envelope` as of the last sync. This is the merge base. |
| `change_log` | Record ids changed locally since the last successful push |
| `sync_kept` | Remote files this device can't decrypt or decode: path, blob SHA, reason. Kept, never deleted (§10) |

**Merge base without git:** "base" is whatever this device last pushed or
accepted for a record. The forge's commit graph isn't needed, so the forge can
stay a plain linear history.

## 5. Sync cycle

```
1. head ← transport.getHead()
2. if head ≠ lastSyncedCommit:
     changed ← diffTrees(lastSyncedCommit snapshot in sync_remote, head)   // Merkle walk
     blobs   ← transport.readBlobs(changed)                                // batched
     for each changed path (one DB transaction per batch):
        theirs ← decrypt(blob), check id ↔ path, decode
                                            (keep in sync_kept + report if any step fails)
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
       (only if their HLC is unchanged: an edit made during the push stays queued)
     update sync_remote with the new blob SHAs (computed locally: git blob SHA-1),
       and forget the SHAs of the directories above them
     more than one commit's worth (500 files)? → go to 3 again
4. lastSyncedCommit ← newHead or head
```

**Implementation notes** (`SyncEngine` in `@lm/sync`, ADR-020):

- Reading "ours", merging and writing happen in one database transaction
  (`LmDatabase.syncTransaction`), so a local edit can't slip in between.
- After a push the engine doesn't know the new directory SHAs. It drops them
  from `sync_remote`, so the next walk lists those directories and finds the
  pushed blobs already known by SHA: nothing is re-downloaded.
- A cycle is skipped, with `rateLimited`, when the forge reports fewer than 50
  requests left before the reset.

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
| Long text (`body`, `notes`, `content`) | diff3. On overlapping hunks, keep both versions in a fenced conflict block and add the field to the envelope's `conflicts`; the UI shows a banner |
| Deleted on one side, edited on the other | The edit wins and the record is undeleted. A toast reports "restored" |
| Deleted on both sides | Deleted |
| No base (both created with the same id) | Impossible with ULIDs. Treat as a scalar merge with an empty base |

**Implementation details** (`mergeRecords` in `@lm/core`, ADR-014):

- **Merge kinds:** each entity declares which fields are `text`, `set` or
  `list` (DATA-MODEL.md §1). Everything else is a scalar.
- **No side preference:** every choice between the two sides is made by HLC,
  then by the canonical JSON of the value, never by which side is local. So
  `merge(b, o, t)` and `merge(b, t, o)` give byte-identical records. A field
  without a `fieldHlc` entry uses the record's `hlc`.
- **Sets:** compared by canonical JSON. The merged array is sorted by it.
- **Lists:**
  - Items are matched by `id`.
  - An item removed on one side and edited on the other is kept.
  - An item edited on both sides is merged property by property with the
    scalar rule, using the list field's HLCs.
  - The result is sorted by `(order, id)`.
- **Long text:**
  - Merged line by line.
  - A conflict block lists the older version first, then the newer:

    ```
    <<<<<<< conflict
    …older…
    =======
    …newer…
    >>>>>>> end
    ```
  - An optional text field cleared on one side, with no other text left,
    stays absent.
- **Conflict list:** the envelope's `conflicts` (sorted field names) is merged
  as a set with its base, plus the fields that got new conflict blocks. When
  the user resolves a conflict, they remove the field from the list, and that
  removal survives sync.
- **Deletion:**
  - `deletedAt` first gets the one-sided rule. If both sides deleted, the
    earlier timestamp is kept. If both sides changed it and one side
    restored the record, the restore wins.
  - Then, if the record would be deleted but a side that isn't deleted
    changed `data` since the base, the record is restored. The result
    reports `restored` so the UI can show the toast.
- **Free-form maps:** `data._unknown` and envelope keys from newer clients are
  merged key by key with the scalar rule, on the record HLCs.
- **Envelope fields:** the merged `hlc` and each `fieldHlc` are the maximum of
  both sides. `createdAt` is the earlier of the two.
- **Invalid results are kept:** a field-wise merge can break a cross-field
  rule (for example `dueTime` without `dueDate`). The merged record is still
  returned whole, together with the validation `issues`, so nothing is
  dropped.

**Properties:** the rules must be commutative and idempotent.

- fast-check tests in `packages/core/src/merge/` check:
  - commutativity, byte for byte;
  - idempotence;
  - that one-sided changes apply unchanged;
  - that two devices converge;
  - that no added set element, list item or text line is lost.
- The convergence simulator in `packages/sync` (P0.6) checks the same laws
  across full sync cycles.

## 7. Transports

```ts
interface SyncTransport {
  getHead(): Promise<CommitSha | null>;                       // null: empty repo
  // One directory of a commit. `sha` is the directory's tree SHA from its
  // parent's listing (undefined for the root): GitHub lists by SHA, GitLab by path.
  listTree(commit: CommitSha, path: string, sha: string | undefined): Promise<TreeEntry[]>;
  readBlobs(entries: { path: string; sha: BlobSha }[]): Promise<Map<string, Uint8Array>>;
  readFile(path: string, ref: CommitSha): Promise<Uint8Array | null>;   // lm.json
  commit(parent: CommitSha | null, changes: FileChange[]): Promise<CommitResult>;
  rateLimit(): RateLimitState;
}
// CommitSha: landed on `parent`. 'conflict': refused. { sha, rebased: true }:
// landed on a newer head (GitLab's per-file CAS); the engine then keeps the
// head it pulled as lastSyncedCommit, so the next cycle pulls what it skipped.
type CommitResult = CommitSha | 'conflict' | { sha: CommitSha; rebased: true };
```

- Transports throw `RateLimitedError` (with the reset time) and `AuthError`
  (expired or revoked token). The engine turns these into the `rateLimited`
  and `authError` outcomes; any other error is `error`.
- A recursive-tree shortcut for small GitHub repos (§5) can be added inside
  the GitHub transport without changing this interface.
- Transports take an injected `fetch` (the shell passes `platform.http`, which
  is native HTTP on Tauri and Capacitor) and never call the global one.
- Every commit uses the message `sync` and the identity `Life Manager
  <noreply@invalid>` as both author and committer (§1).
- Error messages name the endpoint and HTTP status only: never the token, a
  ref or a file name.
- Responses are validated with zod. Anything unexpected, including a truncated
  tree listing, is an error, never a silently shorter list.

### GitHub (github.com and GitHub Enterprise; configurable API base)

- **Head:** `GET /repos/{o}/{r}/git/ref/heads/{branch}`. A 409 means the repo
  is empty (`null`); a 404 is an error (wrong branch, or no access).
- **Trees:** `GET /repos/{o}/{r}/git/trees/{sha}` (the root by commit SHA).
  Submodule entries are skipped.
- **Blob reads:**
  - Batch with **GraphQL**: up to 100 aliased `object(oid:)` lookups per query,
    passed as `GitObjectID` variables, returning
    `... on Blob { text isBinary isTruncated }`. A blob that comes back binary
    or truncated is re-read over REST.
  - Binary `.lmb` files are read with `GET /git/blobs/{sha}` and the raw media
    type.
  - The GraphQL endpoint is `{api}/graphql`, or `/api/graphql` when the REST
    base is an Enterprise `/api/v3`.
- **`lm.json`:** `GET /contents/{path}?ref=` with the raw media type.
- **First commit (empty repo):** the git data API refuses to write to an empty
  repo, so the first commit goes through `PUT /contents/lm.json`: exactly one
  file. A 409 or 422 (the file already exists) is a `'conflict'`.
- **Commit:**
  1. Create binary blobs with `POST /git/blobs`.
  2. `POST /git/trees` with `base_tree` set to the parent's tree. Text records
     go inline as `content`; blobs go in by SHA.
  3. `POST /git/commits` with the parent commit.
  4. `PATCH /git/refs/heads/{branch}` with `force: false`. **A 422 error means
     someone else moved the branch, so return `'conflict'`.** Without force,
     GitHub only fast-forwards; our commit's only parent is `parent`, so the
     update succeeds only while the branch is still there.
  - The transport remembers the tree of each commit it made, so the next push
    doesn't re-read it.
- **Token:** a fine-grained PAT limited to this one repo, with **Contents:
  Read and write** and **Metadata: Read**.
- **Rate limits:** 5,000 REST requests per hour and 5,000 GraphQL points per
  hour. The transport tracks `x-ratelimit-*` per resource and reports the
  tightest live window. A 403 with no budget left, or a 403/429 with
  `Retry-After` (secondary limits), is `RateLimitedError`. Any other 401/403
  is `AuthError`.

### GitLab (gitlab.com and self-managed; configurable base URL)

- **Head:** `GET /projects/:id/repository/branches/:branch`.
  A 404 "Branch Not Found" means the project is empty (`null`); any other 404
  is an error.
- **Trees:** `GET /projects/:id/repository/tree?path=&ref=&per_page=100&page=`,
  with offset pages (directories are small, and this doesn't depend on the
  `Link` header being exposed to the browser). Entries carry `id`, which is
  the object SHA. A 404 "Tree Not Found" is an empty listing.
- **Blob reads:**
  - `GET /projects/:id/repository/blobs/:sha/raw`, with bounded concurrency
    (6).
  - `lm.json`: `GET /repository/files/:path/raw?ref=`.
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
  - `last_commit_id` per path, and whether to `create` or `update`, comes
    from `GET /repository/files/:path?ref=<parent>` (its JSON
    `last_commit_id`; a 404 means create). Files this device pushed are
    remembered from the commit response and skip the lookup. A stale entry
    only costs one refused commit, after which the cache is cleared. A delete
    of a file already gone at the parent is dropped.
  - A 400 whose message says the file already exists, doesn't exist, or has
    changed is a `'conflict'`; any other 400 is an error.
  - When the commit's parent isn't ours, the result is `rebased` (above).
  - The convergence simulator runs with both CAS kinds.
  - **This needs a spike to verify** against real GitLab (the opt-in contract
    tests do it).
- **Token:** a project access token (Developer role) or a PAT with the `api`
  scope. GitLab's REST writes need `api`.

### Fake (tests)

`FakeForge` in `@lm/sync`: an in-memory implementation with exactly the CAS
semantics above (`cas: 'branch'`, the default, as on GitHub; or
`cas: 'perFile'`, as on GitLab), and tree SHAs that change exactly when something below them
changes. Tests inject races (`beforeCommit`), failures and rate limits
(`onRequest`).

**Convergence simulator** (`packages/sync/src/sim`):

- 5 devices with skewed clocks share one fake forge.
- Random creates, field edits, line edits, deletes, restores and syncs.
  Syncs sometimes race another device mid-push.
- At the end every device syncs until nothing changes. They must then hold
  identical records, with no record lost and nothing left unpushed or kept.
- Every seed runs once with each CAS kind. CI runs 6 seeds × 300 ops on every
  PR. The nightly workflow runs 1,000 seeds × 1,000 ops in 20 shards.

**Emulators and the contract suite:** `GitHubEmulator` and `GitLabEmulator`
(`src/test-support`) stand in for the forge APIs behind a `fetch`, so the real
transports run in CI. One contract suite runs against the fake forge (both
CAS kinds), both transports on their emulators, and, opt-in, both transports
on real repos (`LM_TEST_GITHUB_TOKEN` + `LM_TEST_GITHUB_REPO`,
`LM_TEST_GITLAB_TOKEN` + `LM_TEST_GITLAB_PROJECT`; each run uses a scratch
branch).

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
- **A remote file this device can't use:** skip it, record it in `sync_kept`
  with a reason, list it under Settings → Sync → Problems, and never delete
  it. The reasons:
  - `decryptFailed`, `notJson`;
  - `wrongPath` (the id inside doesn't belong at this path);
  - the decoder's `malformedEnvelope`, `unknownType`, `futureSchema`,
    `upgradeFailed` and `invalidData`;
  - `localUndecodable`: the local copy can't be read, so it isn't
    overwritten.

  A file that later decodes is removed from the list.
- **Record with a newer `schema` than this app understands:** keep the raw
  envelope and don't overwrite it. Show an "update the app" banner.
