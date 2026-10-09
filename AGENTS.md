# Instructions for Coding Agents

You are working on **Life Manager**: an offline-first, end-to-end-encrypted
life manager. The clients are React + Tauri (macOS and Windows), Capacitor
(Android, later iOS) and a web PWA. Sync goes through the user's own private
GitHub or GitLab repo. **There is no backend server, and there never will be.**

These instructions apply to every agent session. Read this whole file before
writing code.

## 1. Start of every session

1. Read [docs/STATUS.md](docs/STATUS.md) to see the current state and the next
   milestone.
2. Read [docs/ROADMAP.md](docs/ROADMAP.md) and find the first unchecked
   milestone whose dependencies are done. Work on that unless the user asked
   for something else.
3. Read the spec docs relevant to that milestone:

   | Working on | Read |
   |---|---|
   | Anything | [ARCHITECTURE.md](docs/ARCHITECTURE.md), [DECISIONS.md](docs/DECISIONS.md) |
   | Entities, DB, domain logic | [DATA-MODEL.md](docs/DATA-MODEL.md) |
   | Sync, transports, merge | [SYNC.md](docs/SYNC.md), [SECURITY.md](docs/SECURITY.md) |
   | Crypto, secrets, networking | [SECURITY.md](docs/SECURITY.md) |
   | UI | [DESIGN.md](docs/DESIGN.md) |
   | Adding a dependency | [TECH-STACK.md](docs/TECH-STACK.md) |
   | CI, packaging | [RELEASE.md](docs/RELEASE.md) |

4. Run `git log --oneline -20` to see what recently changed.

## 2. End of every session

1. Make sure `pnpm check` passes (and `pnpm test:e2e` if you touched the UI).
2. Check off completed items in ROADMAP.md.
3. Update docs/STATUS.md:
   - Rewrite "Current state" (phase, next milestone, blockers, risks).
   - Add a dated log entry at the top saying what you did, what's left, and
     any surprises.
4. If you made or changed an architectural choice, append an ADR to
   DECISIONS.md and update the affected spec doc **in the same commit**. Specs
   and code must never disagree.
5. Commit with Conventional Commits (`feat(sync): …`, `fix(core): …`,
   `docs: …`), then push to your assigned branch.

## 3. Commands

| Command | What it does |
|---|---|
| `pnpm install` | Install everything. The cloud SessionStart hook runs this for you. |
| `pnpm check` | Lint + format check + typecheck + unit tests. Run it before every commit. |
| `pnpm lint` | ESLint (including the RTL `no-physical-direction` rule) + `lm-check-deps` (dependency direction) |
| `pnpm format` | Prettier write |
| `pnpm typecheck` | `tsc --noEmit` in every package (Turborepo) |
| `pnpm test` | Vitest in every package (Turborepo) |
| `pnpm test:e2e` | Playwright smoke tests against the built web app. In cloud sessions `PW_CHROMIUM_PATH` points at the preinstalled Chromium; locally run `pnpm --filter @lm/web exec playwright install chromium` once. |
| `pnpm dev:web` | Web app dev server at http://localhost:5173 |
| `pnpm stories` | Ladle component stories for `@lm/ui` |
| `pnpm --filter @lm/<pkg> <script>` | Run a script in one package |

**Adding a package:** create it under `packages/`, export `./src/index.ts`,
and add it to `ALLOWED` in `tooling/repo-checks/src/check-deps.js` and to
ARCHITECTURE.md §3.

## 4. Rules that are never broken

1. **No server.** Don't add a backend, a relay, a proxy or a hosted service.
   Everything runs on the device. The only remote endpoints are the user's
   forge, the user's chosen AI provider, calendar connectors, the optional FX
   rate source, and the update endpoint.
2. **The forge only ever sees ciphertext.** No plaintext record content, type,
   id, title or device name may be written to the repo, file names or commit
   messages. See SYNC.md and SECURITY.md.
3. **Never lose user data.**
   - Merges must keep data: an edit beats a delete, and overlapping text edits
     keep both versions.
   - Undecryptable or unknown-schema records are kept, never deleted.
   - Any change to `packages/sync` or the merge code must keep the convergence
     simulator green.
4. **No telemetry or analytics.** No crash reporting off the device. No
   network calls that the user didn't configure.
5. **Secrets** (tokens, API keys, OAuth tokens, data keys) go only through
   `platform.secrets`. Never put them in SQLite, localStorage, logs, error
   messages or test snapshots.
6. **Don't roll your own crypto.** Use the `packages/crypto` wrappers over
   libsodium only.
7. **Nothing is hard-coded to the owner.** The product is for anyone with
   their own repo. Never commit personal data, repo names or tokens.
8. **AI calls are user-initiated, and their output is a proposal.** Nothing an
   AI produces is saved without the user accepting it, and the privacy toggles
   are respected.
9. **`packages/core` is pure.** No platform, DOM, network or SQLite imports.
   Inject time and randomness so tests are deterministic.
10. **Don't skip, disable or weaken tests** to get CI green. Fix the cause.

## 5. Code conventions

- **TypeScript:** strict mode, ESM, no `any` (use `unknown` and narrow).
  Validate external data (API responses, imports, decrypted records) with zod
  at the boundary.
- **Imports:** packages are imported as `@lm/<name>`. Respect the dependency
  direction in ARCHITECTURE.md §3, and never import "upward".
- **Feature folders:** `packages/ui/src/features/<module>/` holds screens,
  components, hooks and that feature's i18n keys. Shared components go in
  `packages/ui/src/components/`.
- **Dates:**
  - Never use `new Date()` for calendar logic. Use the `@lm/i18n` date utils
    and `core`'s injected clock.
  - Store `LocalDate` and `Instant` as defined in DATA-MODEL.md.
  - Every user-facing date goes through the calendar-system-aware formatters.
- **Money:** integer minor units plus a currency code. Never use floats for
  amounts.
- **Strings:**
  - Every user-visible string goes through i18next.
  - Add the key to **both** `en` and `fa`. If you can't translate it well, copy
    the English text and add the key to `packages/i18n/TODO-fa.md`.
- **Styling:**
  - Tailwind with semantic tokens only. No raw hex colors in components.
  - Logical properties only (`ms-`, `pe-`, `start-`, …). The lint rule enforces
    this.
- **Components:**
  - Accessible: Radix primitives, labels, focus rings, keyboard alternatives
    for drag.
  - Each new shared component gets a Ladle story covering light/dark and
    LTR/RTL.
- **Errors:** never swallow them silently. Sync and IO errors surface in the
  UI status, and logs go through `redact()`.
- **Comments:** explain *why*, not *what*. Every non-obvious algorithm (merge,
  recurrence, streaks, statistics) links to its spec section.

## 6. Testing expectations

| Code | Required tests |
|---|---|
| `core` domain logic | Unit tests; property tests (fast-check) for merge, HLC, recurrence, streaks |
| `crypto` | Known-answer vectors, tamper and relocation rejection |
| `db` | Repository tests run against the web driver |
| `sync` | Fake-forge tests for every branch of the cycle; the convergence simulator; opt-in real-forge contract tests (`LM_TEST_GITHUB_TOKEN`, `LM_TEST_GITHUB_REPO`, `LM_TEST_GITLAB_*`) |
| `ui` | Component tests for logic-heavy components; a Playwright smoke test per feature in light/dark and LTR/RTL |

## 7. Working with external services

- **GitHub/GitLab:** use test repos and tokens supplied through env vars only.
  Never use the owner's real data repo in tests.
- **AI:**
  - Before writing Claude integration code, consult the current Anthropic API
    docs or the `claude-api` skill if available. Don't rely on memory for
    model ids or parameters.
  - Keep the default model id in a single constant in `packages/ai`.
- **Platform tooling** (Rust, Xcode, Android SDK) may be missing in cloud
  sessions:
  - Build and test what you can (web and pure TS packages).
  - In STATUS.md, note which platform-specific parts are unverified, and say
    so in your summary.
  - Don't claim something works on a platform you didn't run.

## 8. When to stop and ask the owner

Stop and ask, recording the question under "Blockers" in STATUS.md, if:

- A spec is ambiguous or contradicts itself, and the choice affects data
  format, sync or security.
- A spike disproves an assumption in SYNC.md (for example, GitLab CAS doesn't
  work as described).
- A task would need a server, a paid service, or weaker encryption.
- You want to change the tech stack in TECH-STACK.md.

For everything else, follow the specs, make a sensible choice, and record it.

## 9. Scope discipline

- One milestone (or a clearly scoped part of one) per PR or branch.
- Don't reformat or refactor unrelated code in the same change.
- Don't build ahead: no speculative abstractions for features in later phases,
  beyond the interfaces the specs already define.

<!-- BEGIN:turborepo-agent-rules -->

# This is NOT the Turborepo you know

Turborepo configuration, task behavior, and CLI commands can vary between installed versions and may differ from your training data. Resolve the `turbo` package from this file's directory or relevant workspace; in monorepos, it may not be visible from the repository root. For example, run `node -p "require.resolve('turbo/package.json')"` from a workspace that depends on `turbo`.

Read `docs/README.md` inside that installed package first, then read the relevant pages from its `docs/` directory before changing Turborepo configuration or commands. Heed deprecation notices. These bundled docs match the installed package version and are available without network access.

This block is written and re-added by `turbo` before repository-scoped commands when an AI agent is detected. In the Turborepo source repository, its template is defined in `crates/turborepo-cli/src/cli/agent_guidance.rs`. Removing the managed block while updates are enabled means a later qualifying invocation will add it again. Set `"agentGuidance": false` in the root `turbo.json` or `turbo.jsonc` to opt out; this does not remove an existing block. Keep the block committed with your work to avoid an uncommitted change on the next agent invocation.
<!-- END:turborepo-agent-rules -->
