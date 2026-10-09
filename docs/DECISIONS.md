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

