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

### ADR-011 — Record authentication binds to the opaque remote path
2026-10-13 · accepted by owner

- **Context:** A joining device knows the keyed filename but cannot know the
  plaintext record ID until it decrypts the record. Requiring that ID as AEAD
  associated data made first sync impossible.
- **Decision:** Records authenticate `lmr1|` followed by the full opaque remote
  path. After decryption, the engine must verify the decrypted ID hashes to that
  path before accepting the envelope. Attachment binding remains content-hash
  based. No released data exists, so format version 1 can be corrected now.
- **Consequences:** Fresh devices can decrypt discovered records while relocation
  is rejected. Crypto and networking dependencies remain the specified libsodium
  wrappers and zod boundary validation; no custom cryptographic primitives.

### ADR-012 — Pure domain utilities and encoding details
2026-10-13 · accepted

- **Decision:** Use `@internationalized/date` CalendarDate arithmetic for both
  Gregorian and Persian recurrence, `ulid` with injected randomness/time, and
  `fractional-indexing` for lexicographic order keys. Use the specified
  `node-diff3` for pairwise text merges and fast-check for randomized tests.
- **Details:** HLC counter overflow carries one millisecond, never wraps. Native
  libsodium KDF contexts are eight bytes: NUL-pad the seven-character names in
  SECURITY.md; subkey ID is 1 for each separate context. Recovery strings use
  uppercase RFC 4648 base32 with four-character groups and no padding.
- **Consequences:** Core remains independent of the DOM, network and OS. No
  security or sync network calls are introduced. The multi-device text merge
  format remains under review because pairwise diff3 alone is not associative.

### ADR-013 — Causal provenance for convergent long-text merges
2026-10-13 · accepted by owner

- **Context:** Pairwise diff3 retains text but is not associative: merging three
  concurrent edits in different orders produces different nested conflict blocks.
- **Decision:** Envelope `textVersions` maps each long-text field to an append-only
  graph of `{clock,value,parents}` original edits. A local edit parents every
  current head. Merge unions the graphs; rendering merges live heads in HLC order
  against their newest common ancestor. Rendered conflict blocks are never stored
  as new original edits unless the user explicitly edits them.
- **Consequences:** Original versions remain available and stale resends cannot
  revive superseded edits. Clock collisions or invalid ancestry are rejected for
  preservation/reporting by sync, never silently discarded. Graph pruning awaits
  a separately specified safe compaction protocol. The five-replica property test
  covers 1,000 randomized delivery orders; this is not yet the full sync simulator.

### ADR-014 — Initial SQLite record store and worker persistence
2026-10-13 · accepted

- **Decision:** Migration 1 stores validated envelopes in a normalized `records`
  table, with per-entity SQL views, type/deletion indexes, FTS5, and sync
  bookkeeping tables. Entity-specific generated columns/indexes can be added
  through numbered migrations as query needs become concrete. This corrects the
  earlier plan to duplicate the whole envelope into independent entity tables.
- **Web driver:** Run SQLite WASM in a module worker using the official OPFS
  synchronous-access-handle pool. Do not fall back silently to a transient DB.
  Persistent-storage failures are shown in the app; another open tab can hold the
  pool lock. The single driver serializes transactions and queries.
- **Consequences:** One atomic write updates data, search, the HLC and change log.
  Unknown/newer envelopes remain exportable and cannot be edited/deleted. Native
  SQLite drivers and encrypted attachment storage are still outstanding.

### ADR-015 — Deliver a working local web slice before connecting services
2026-10-13 · accepted

- **Context:** The owner requested implementation of the entire project in one
  pass, overriding the default instruction to stay within one milestone.
- **Decision:** Implement domain and crypto foundations alongside a local web
  workspace. The UI exposes only working local actions and explicitly identifies
  sync, AI, external calendars and native reminders as unavailable.
- **Consequences:** Native date inputs currently use Gregorian dates, clearly
  labelled; display supports Jalali independently. Initial notes are plain-text
  editable, safely rendered as text. Mobile navigation is a scrollable navigation
  strip until the planned bottom-tab shell arrives. No feature phase is marked
  complete solely because a minimal CRUD screen exists.
