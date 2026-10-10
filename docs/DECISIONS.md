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

