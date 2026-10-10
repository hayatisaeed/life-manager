# Decision Log

This is a lightweight ADR log. **Append a new entry whenever you make or change
an architectural choice.** Don't rewrite old entries. Supersede them with a new
one.

Format: `ADR-NNN — Title` · date · status · context → decision → consequences.

---

### ADR-001 — No Django; shared TypeScript core
2026-10-09 · accepted

- **Context:** The owner initially asked for Django, but there will never be a
  remote server. Bundling Django locally would mean shipping Python on desktop,
  and it can't run on Android.
- **Decision:** All logic lives in TypeScript packages shared by every client.
  The owner explicitly allowed dropping Django.
- **Consequences:** There is one implementation of the domain logic. Rust
  (Tauri) is used only for OS integration.

### ADR-002 — React + Tauri 2 + Capacitor
2026-10-09 · accepted

- **Decision:** One React codebase. Tauri 2 for macOS and Windows, Capacitor
  for Android (iOS later), and a web PWA.
- **Consequences:** Small desktop binaries and most UI code shared. Native
  features go through `packages/platform`.

### ADR-003 — Sync via GitHub/GitLab APIs, not the git protocol
2026-10-09 · accepted (supersedes the earlier isomorphic-git plan)

- **Context:** The owner wants sync through GitHub or GitLab, including from
  the web build. Browsers can't speak the git smart-HTTP protocol to these
  hosts because of CORS, while their REST and GraphQL APIs do send CORS
  headers.
- **Decision:** Sync uses forge APIs only, through a `SyncTransport` interface
  with GitHub and GitLab implementations. Devices never clone the repo. The
  merge base is tracked locally (`sync_base`), not taken from git history.
- **Consequences:**
  - One sync path for all platforms.
  - No local working-tree copy.
  - Generic git servers (Gitea, plain SSH) aren't supported. That could be
    added later as another transport.
  - We must manage API rate limits, which is why the Merkle walk and batching
    exist.
  - GitLab's commit-concurrency approach needs a spike (ROADMAP P0.2).

### ADR-004 — One encrypted file per record, field-level 3-way merge
2026-10-09 · accepted

- **Decision:**
  - Each record is a separate file encrypted with XChaCha20-Poly1305.
  - File names come from a keyed hash.
  - Merge is per field, using HLCs, a set merge, or diff3 depending on the
    field (SYNC.md §6).
- **Consequences:** The forge can't read file contents or diffs. Commutative,
  idempotent merge rules make the system converge.

### ADR-005 — Pluggable AI (Claude + Ollama), user-initiated only
2026-10-09 · accepted

- **Decision:**
  - One `AIProvider` interface.
  - No AI call happens unless the user starts it.
  - Sensitive modules are excluded by default for remote providers.
  - Plans are always proposals that the user must accept.

### ADR-006 — Multi-user product, single-user data
2026-10-09 · accepted

- **Decision:**
  - Anyone can install the app and connect their own repo.
  - Each repo holds one person's data. There is no sharing between users in
    v1.
  - Nothing may be hard-coded to the owner: no repo names, tokens or personal
    data in the source.

### ADR-007 — Distribution via GitHub Releases, no app stores
2026-10-09 · accepted

- **Decision:**
  - Installers: `.dmg`, `.msi`/`.exe` and `.apk`.
  - Self-update: the Tauri updater on desktop and an APK update check on
    Android.
  - Code signing on macOS and Windows is optional, and the app documents the
    first-run workaround for unsigned builds.

### ADR-008 — Calendar system independent of language
2026-10-09 · accepted

- **Decision:**
  - Dates are stored in Gregorian ISO form.
  - Jalali vs. Gregorian is a display and recurrence setting, independent of
    the UI language.
  - The recurrence engine is our own and calendar-aware.

### ADR-009 — Pin TypeScript 6.0 and ESLint 9
2026-10-09 · accepted

- **Context:** TypeScript 7 (the native compiler) and ESLint 10 are the latest
  releases. typescript-eslint supports TypeScript only below 6.1, and
  eslint-plugin-react and eslint-plugin-jsx-a11y don't support ESLint 10 yet.
- **Decision:** Use TypeScript 6.0.x and ESLint 9.x.
- **Consequences:** Upgrade both when their plugin ecosystems catch up. Check
  the peer dependencies of typescript-eslint, eslint-plugin-react and
  eslint-plugin-jsx-a11y first.

### ADR-010 — Internal packages ship TypeScript source, no build step
2026-10-09 · accepted

- **Context:** Every consumer of `@lm/*` packages (Vite, Vitest, `tsc
  --noEmit`) can compile TypeScript itself.
- **Decision:**
  - Each package's `exports` points at `src/index.ts`. Only `apps/*` have a
    `build` script.
  - `tooling/repo-checks` (`lm-check-deps`, part of `pnpm lint`) enforces the
    dependency direction from ARCHITECTURE.md §3.
- **Consequences:**
  - No stale `dist/` folders and no build ordering between packages.
  - A package must never rely on emit-only features (for example `const enum`
    across packages); `isolatedModules` and `verbatimModuleSyntax` guard this.

### ADR-011 — Web SQLite uses the `opfs-sahpool` VFS with one owner tab
2026-10-09 · accepted

- **Context:** The P0.2 spike (spikes/README.md) ran 50k rows plus FTS5 on
  both OPFS VFSes of `@sqlite.org/sqlite-wasm` 3.53 in a worker. Both work and
  persist. `opfs-sahpool` was as fast or faster. The `opfs` VFS needs
  `SharedArrayBuffer`, so COOP/COEP headers, which block cross-origin images
  and embeds and are awkward on static hosting. Neither VFS supports WAL.
- **Decision:**
  - The web `SqlDriver` runs sqlite-wasm in a dedicated worker on
    `opfs-sahpool`. The web build does not set COOP/COEP.
  - `opfs-sahpool` allows one connection per origin, so one tab owns the
    database, elected with a Web Locks lock. Other tabs show a "Life Manager
    is open in another tab" screen with a "use here" action. Proxying queries
    between tabs can come later if needed.
  - Writes are batched in transactions (no WAL).
- **Consequences:** No multi-tab editing in the web build for v1. The same
  lock can also serve as the sync lock (SYNC.md §5).

### ADR-012 — HLC, ULID and order-key details
2026-10-09 · accepted

- **Context:** P0.3 implements the primitives that SYNC.md §3 and DATA-MODEL.md
  §1 describe only by format.
- **Decision:**
  - **HLC:** Kulkarni-style hybrid logical clock with `now()` and
    `receive()`. `deviceId` is restricted to `[0-9A-Za-z_-]{1,64}` so the
    wire string is unambiguous. On counter overflow the clock borrows the next
    millisecond rather than throwing. Time beyond year 9999, a broken physical
    clock, or a malformed remote HLC throws `HlcError`. There is no maximum
    drift check yet: rejecting a far-future remote HLC would block that record
    from syncing, so how to handle a badly skewed device is left to the sync
    engine (P0.6).
  - **ULID:** the `ulid` package's monotonic factory, fed by the injected
    `Clock` and `Rng`. `isUlid` accepts only the canonical uppercase form.
  - **Order keys:** the `fractional-indexing` package (default base-62
    alphabet). No random jitter: concurrent inserts at the same spot may get
    equal keys, and the `(order, id)` sort keeps them deterministic. Inserting
    between two equal keys requires re-spacing with `ordersBetween`.
- **Consequences:** These strings are part of the encrypted record format, so
  changing any of them later needs a schema upgrader.

### ADR-013 — Record envelope, entity schemas and upgrades
2026-10-10 · accepted

- **Context:** P0.3 turns DATA-MODEL.md into zod schemas. The spec left some
  formats and enum values open, and nothing yet said how a client treats a
  record it can't read.
- **Decision:**
  - **Envelope:** `{ id, type, schema, hlc, fieldHlc, deletedAt, createdAt,
    data }`. `createdAt` was missing from SYNC.md's example.
  - The envelope is a loose object: unknown top-level keys are carried along.
  - **Decoding:** `decodeRecord` never throws. A record that is malformed, of
    an unknown type, on a newer schema, failing an upgrader, or holding
    invalid data is returned as `kept` with the raw value, for the engine to
    store untouched.
  - **Unknown data fields:** they move into `data._unknown` before
    validation. Nested objects are strict, so an unknown key inside one makes
    the record `kept`, not silently stripped.
  - Free-form maps (`data`, `_unknown`, `fieldHlc`) are checked as plain
    objects and passed through as is. `z.record` and zod's loose objects drop
    a `__proto__` key, and a property test found that. The decoded record is
    built from the raw object for the same reason.
  - **Upgrades:** each entity has a `version` and an `upgraders` list
    (`upgraders[i]` turns `i + 1` into `i + 2`). Upgraders map
    `{data, fieldHlc}`, so renames carry their HLCs.
  - **Merge kinds** are declared per entity: `text`, `set` and `list`, with
    scalars as the default. The merge doesn't infer them from field names,
    because long text fields such as `why` and `rationale` don't follow the
    `body`/`notes`/`content` naming.
  - **Optional fields** are left out of the record, never null. The schemas
    apply no defaults.
  - **Formats:**
    - `Instant` is the exact `toISOString` form.
    - `BlobRef` is `{hash (hex BLAKE2b-256 of the plaintext), size, mime,
      name?}`.
    - Colors are palette names.
    - `tags` hold Tag ids.
  - **Filled gaps:**
    - Goal `status` is `active|onHold|done|dropped`.
    - Goal `manualProgress` is an integer percent.
    - `Task.recurrenceOf` exists.
    - Plan-proposal blocks carry the id their TimeBlock will get.
    - The `settings` record has a fixed id, `SETTINGS_ID` (26 zeros), and the
      fields listed in DATA-MODEL.md §14.
- **Consequences:**
  - Every type name, enum value and format above is part of the encrypted
    record format. Changing one needs a schema bump and an upgrader.
  - No real data exists yet, so the filled gaps can still be changed freely
    before the first release.

### ADR-014 — Merge implementation details
2026-10-10 · accepted

- **Context:** SYNC.md §6 gives the merge rules. Implementing them showed a
  few gaps:
  - where `hasConflict` lives;
  - how ties and list items are handled;
  - how a deletion interacts with a restore;
  - how to stay commutative down to the byte.
- **Decision:**
  - `hasConflict` is the envelope field `conflicts: string[]`, which lists the
    field names. It is merged as a set, so a resolution sticks.
  - **No side preference:** choices between sides are made by HLC, then by
    canonical JSON, never by which side is local.
    - Sets are output sorted, lists by `(order, id)`, and keys sorted.
    - The text-conflict block puts the older version first.
    - As a result, both devices write byte-identical records, and git blob
      SHAs match.
  - **Lists:** items edited on both sides merge property by property, using
    the list field's HLCs. An edit beats a removal.
  - **Deletion:**
    - The one-sided rule applies first. Both deleted keeps the earlier
      timestamp, and a restore beats a re-delete.
    - Edit-beats-delete then undeletes, and `restored` is reported.
  - **Invalid results:** a merged record that breaks a cross-field rule is
    returned whole, with `issues`, never dropped or "fixed".
  - **Library:** text merge is line-based `node-diff3` (`diff3Merge`, false
    conflicts excluded). The two sides are passed in HLC order.
- **Consequences:**
  - The merge is pure and side-agnostic, so the sync engine can call it in
    either direction.
  - Conflict blocks are plain text markers in the field. The UI must detect
    them through `conflicts`, not by parsing.

### ADR-015 — Recurrence engine
2026-10-10 · accepted

- **Context:** P0.3 needs a calendar-aware recurrence engine (ADR-008).
  - `core` must stay pure, and it must not depend on the device time zone.
  - date-fns-jalali works on JS `Date` objects in local time.
  - DATA-MODEL.md's `Recurrence` has no start date, and a completed task hands
    its rule to a new instance. So `count` and the defaults RFC 5545 takes
    from DTSTART need a defined meaning across instances.
- **Decision:**
  - **Day arithmetic** uses Julian Day Numbers.
    - Jalali conversion uses `jalaali-js` (Borkowski's algorithm, pure
      integers, exact for Jalali years -61…3177). It's a small dependency
      with no transitive packages.
    - Gregorian conversion uses the same library's `g2d`/`d2g`.
  - **Month days are clamped** to the month's length, instead of skipped as
    in RFC 5545. Negative days count from the end.
  - **Defaults:**
    - Defaults come from the start date as in RFC 5545.
    - `nextInstance` writes them out in the rule it returns, so chained
      instances never drift.
    - `count` on a stored rule means "instances left, including this one".
  - **Modes:**
    - In `fixed` mode, the next instance is the first occurrence after the
      current due date. Missed occurrences aren't skipped.
    - In `afterCompletion` mode, it's the completion date plus the interval,
      then the first day matching the rule's filters.
  - **Week start** is a caller option taken from the `weekStart` setting, not
    part of the rule.
  - **Never-matching rules:** a series with no occurrence for 4000 days, 1000
    weeks, 1000 months or 400 years is treated as ended. This bounds the
    work an impossible rule causes.
- **Consequences:**
  - The engine is exact and time-zone-free, so recurrence results are the
    same on every device.
  - ICS import (later) must map RFC 5545 rules that rely on skipping invalid
    days. There is no exact equivalent; the closest is a `bySetPos` or `-1`
    rule.
  - Jalali rules are limited to Gregorian years 560–3798.

### ADR-016 — Argon2id parameters are per repo
2026-10-10 · accepted (owner)

- **Context:** SECURITY.md §2 said 256 MiB on desktop and 64 MiB on
  mobile/web. But `lm.json` has a single `kdf` block, so whichever device
  creates the repo fixes the parameters for every device. The P0.2 spike
  measured ops 3 / 256 MiB at about 0.8 s in Chromium wasm on a desktop-class
  CPU.
- **Decision:**
  - One Argon2id setting per repo, stored in `lm.json`.
  - The default is ops 3 / 256 MiB on every platform.
  - If the pending Android measurement (P0.2) exceeds about 3 s, the default
    drops to 128 MiB. Existing repos keep their parameters until the next
    passphrase change, which may set new ones (`rewrapPassphrase`).
  - Readers accept ops 1–10 and mem 8 MiB–1 GiB. That bounds what a tampered
    `lm.json` can make a device allocate.
- **Consequences:**
  - A phone joining a desktop-created repo runs the 256 MiB derivation once
    per unlock. Native apps keep the data key in the keychain, so that's rare.
  - The derivation blocks the calling thread for about a second. The web
    unlock flow should run it in a worker (P0.7).
  - Rejected alternative: one wrapped key per KDF setting. It adds a weaker
    wrap that an attacker would target.

### ADR-017 — Crypto encodings and libraries
2026-10-10 · accepted

- **Context:** P0.4 needed byte-exact definitions that SECURITY.md left open,
  and one spec error came to light: libsodium's `crypto_kdf` takes exactly 8
  context bytes, but the documented contexts are 7 characters.
- **Decision:**
  - **Sub-key contexts:** keep the documented names and pad each with a NUL
    byte. That's what a C or Rust caller passing the same string literal
    gets. Subkey id 1. The `lm.json` key check gets its own context,
    `"lm-chk1"`, so the data key itself encrypts nothing.
  - **Recovery key:**
    - The words are standard BIP-39 for 256-bit entropy, via
      `@scure/bip39`: audited, small, built on `@noble/hashes`.
    - The base32 form is Crockford base32 of key ‖ 3 checksum bytes
      (BLAKE2b-256 prefix): 56 characters in groups of 4. On input `O` reads
      as 0 and `I`/`L` as 1.
    - The recovery key is the wrap key directly; no KDF is needed for 256
      random bits.
  - **Passphrases are NFKC-normalized**, so compatibility forms such as
    Arabic presentation forms derive the same key.
  - **Blob names** hash the content hash as hex text, the same way record
    names hash the id string.
  - **`lm.json` parsing** is a zod schema that keeps unknown fields. A newer
    `version` returns `unsupported-version`.
  - **Errors:** every failure is an `LmCryptoError` with a fixed code and
    message, and never contains secret material.
  - **Test-only dependencies:** `@noble/hashes` and `@noble/ciphers`. They are
    an independent implementation that cross-checks the Argon2id, BLAKE2b,
    `crypto_kdf` and XChaCha20-Poly1305 outputs.
- **Consequences:**
  - The known-answer tests pin the derived keys, paths and a v1 `lm.json`
    fixture. Changing any of them breaks existing repos, so it needs a new
    format version.
  - Long blobs (up to 50 MB) are sealed in one shot, in memory. Streaming
    (`secretstream`) would need a new `LMB2` format.

### ADR-018 — Local database design
2026-10-10 · accepted

- **Context:** P0.5 builds `packages/db`. ARCHITECTURE.md §4 left open:
  - how the "typed tables per entity" are laid out;
  - where the drivers live and how transactions work over async platform
    APIs;
  - what the search index covers;
  - how attachments are stored.
- **Decision:**
  - **Drivers** live in `packages/db`, behind `SqlDriver` (`run`, `all`,
    `script`, `transaction`, `close`). Values are text, numbers or null
    only; no BLOBs.
    - `createSerialDriver` puts every call through one queue, and a
      transaction is `BEGIN IMMEDIATE … COMMIT`. A statement from elsewhere
      can't land inside an open transaction.
    - Web: sqlite-wasm in a dedicated worker on `opfs-sahpool`, reached over
      a small `postMessage` RPC. The worker reserves pool capacity before
      opening: the default 6 slots ran out in the browser suite with
      `SQLITE_CANTOPEN`.
    - Tauri and Capacitor: the shells pass in the plugin's connection object
      (structural interfaces), so `db` has no native dependencies. Capacitor
      calls always pass `transaction = false`.
  - **Entity tables:** one table per type, `ent_<snake_case type>`, with
    columns `id, schema, hlc, field_hlc, deleted_at, created_at, device_id,
    data (JSON), extra (JSON of other envelope keys such as conflicts)`.
    - Query fields are indexed with `json_extract(data, '$.field')`
      expression indexes, chosen per type in the migration.
    - Storing `data` as JSON keeps `_unknown` and nested values exactly as
      decoded, and avoids hand-written columns for 46 types.
    - Migration 1 uses a frozen list of types. A test fails when core gains
      an entity without a migration that creates its table.
  - **Bookkeeping:** `sync_meta` (key/value: device id, HLC state),
    `sync_remote`, `sync_base`, `change_log` and `sync_kept` (remote files
    that can't be used, kept and listed, SYNC.md §10).
  - **Repository writes:**
    - Each write is one transaction: the row, `change_log`, the search index
      and the persisted HLC state.
    - Updates stamp a field HLC only on fields whose value changed, compared
      as JSON with sorted keys. A no-op update writes nothing.
    - Deletes are tombstones, and `restore` undoes them. Editing a
      tombstone is refused.
    - Rows are decoded with core's `decodeRecord` on every read, so older
      schemas upgrade transparently. A row that no longer decodes is
      skipped, reported through `onProblem` and never deleted.
  - **Live queries:** listeners run in a microtask after each committed
    write that touched their types. `liveQuery` drops results that arrive
    out of order.
  - **Search:** FTS5 (`unicode61 remove_diacritics 2`) over a title and a
    body per type.
    - The title is the first of `title, name, text, …`. The body is the
      type's `text` merge fields, plus `back` and `transcript`.
    - `search_doc` maps `(type, id)` to a stable FTS rowid, so an update
      doesn't scan the index.
    - Text is NFKC-normalized, and Arabic yeh/kaf become the Persian forms.
    - Words containing a ZWNJ are indexed both split and joined. The
      tokenizer splits at the ZWNJ, but people type these words both ways.
    - Queries quote every word as a prefix term, so user input can't use
      FTS5 operators.
  - **Attachments:** `AttachmentStore` on a `FileStore` (in
    `@lm/platform`: an in-memory store, and OPFS on the web).
    - Each file is exactly the repo's `.lmb` bytes, named like the repo
      path's last segment. Sync can move files without re-encrypting, and
      local names don't reveal content hashes.
    - Reads verify both the AEAD and the content hash.
    - `db` now depends on `@lm/crypto`; the dependency direction in
      ARCHITECTURE.md §3 already allowed it.
- **Consequences:**
  - Queries on unindexed fields scan the table. Adding an index means adding
    a migration.
  - Unverified on devices:
    - **Tauri:** `tauri-plugin-sql` runs queries on a connection pool, and
      BEGIN/COMMIT may not reach the same connection. If not, the desktop
      needs a small single-connection Rust command.
    - **Capacitor:** BEGIN/COMMIT through `run()`.
    - FTS5 availability in both native SQLite builds.
    - OPFS `createWritable` in Safari.

    The P0.2 Tauri and Capacitor spikes must check these.
  - Multi-tab web use stays out (ADR-011). The app shell (P0.7) owns the Web
    Locks election and starts the worker.

### ADR-019 — Record files are bound to their file name, not their id
2026-10-10 · accepted (owner)

- **Context:**
  - SECURITY.md §2 made a record's AEAD associated data `"lmr1|" + id`.
  - A file's name is a one-way keyed hash of the id. A device pulling a
    record it has never seen knows the name but not the id, so it could
    never decrypt a new record.
  - Building the sync engine (P0.6) exposed this.
- **Decision:**
  - The associated data is `"lmr1|" + fileName`, the 64-hex keyed hash in
    the record's path.
  - `decryptRecord(keys, path, text)` takes the path, and checks that its
    shard directories match the name.
  - After decrypting, the engine checks `recordPath(keys, id) === path`. A
    mismatch is kept as `wrongPath`.
  - Chosen by the owner over a plaintext id header, which would show every
    record id to the forge.
- **Consequences:**
  - The same guarantees as before: a file moved to another path fails the
    AEAD, and content that belongs elsewhere fails the id check. Nothing new
    is revealed.
  - The pinned `.lmr` test vector changed. No real data existed yet, so no
    migration is needed.

### ADR-020 — Sync engine design (fake forge, cycle, simulator)
2026-10-10 · accepted

- **Context:** P0.6 implements SYNC.md §5. The GitHub and GitLab transports
  wait for the forge spike results (P0.2), so this part builds the
  transport-independent pieces.
- **Decision:**
  - **Transport interface:**
    - `listTree(commit, path, sha)` replaces `getTree`/`getTreeRecursive`.
      GitHub lists by SHA, GitLab by path and ref, and the engine passes both.
    - `getHead()` returns null for an empty repo.
    - `commit(parent | null, changes)`.
    - Errors are `RateLimitedError` and `AuthError`.
  - **Pull:**
    - A top-down Merkle walk against `sync_remote`. Blobs are read and
      applied in batches of 100, one database transaction per batch.
    - Read, merge and write go through `LmDatabase.syncTransaction`.
    - Files that can't be used go to `sync_kept` and never block the rest.
    - A local row that can't be decoded is never overwritten.
  - **Push:**
    - Up to 500 files per commit. Larger change logs take several commits in
      one cycle.
    - After a successful CAS, `sync_base` is set and change-log entries are
      cleared only if their HLC is unchanged.
    - Pushed blob SHAs are computed locally (SHA-1 via `@noble/hashes`;
      libsodium has none). The SHAs of the directories above them are
      dropped, so the next walk revisits those directories without
      re-downloading.
  - **Conflicts:** up to 5 attempts per cycle, with exponential backoff and
    jitter.
  - **Rate limits:** a cycle is skipped while fewer than 50 requests remain.
  - **Lock:** one cycle at a time per engine; concurrent callers share the
    running cycle. Cross-tab exclusion stays with the web shell's Web Lock
    (ADR-011).
  - **Simulator:**
    - 5 devices with skewed clocks.
    - Random record operations, plus syncs that race another device
      mid-push.
    - Pass criteria: identical final records, no record lost, nothing kept
      or unpushed, and at least one real CAS rejection across the run.
    - A deliberately broken merge was confirmed to fail it.
    - CI runs 6 × 300 ops; the nightly workflow runs 1,000 seeds × 1,000
      ops in 10 shards.
- **Consequences:**
  - The engine is complete against the fake forge. The real transports must
    match the fake's CAS semantics; their contract tests will check that.
  - Not handled yet:
    - compaction, and a `lastSyncedCommit` that is no longer an ancestor
      (SYNC.md §9, P10.4);
    - the HLC drift guard (ADR-012 risk).

