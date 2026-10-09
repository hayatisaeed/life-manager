# Status

**Update this file at the end of every working session.** Keep "Current state"
short and current. Add new log entries at the top.

## Current state

- **Phase:** 0 (foundations). P0.1 is done; **P0.2 Spikes is in progress.**
- **P0.2 progress:**
  - Done: the sqlite-wasm OPFS spike (ADR-011), and the desktop baseline for
    Argon2id (ADR-012). Results are in `spikes/web-runtime/RESULTS.md`.
  - Open, and these need resources the cloud sandbox doesn't have:
    - GitHub API spike: a test repo and fine-grained PAT
      (`LM_TEST_GITHUB_TOKEN`, `LM_TEST_GITHUB_REPO`). The sandbox proxy also
      returns 403 for api.github.com, so run it locally or allow that host.
    - GitLab API spike: a gitlab.com test project and token
      (`LM_TEST_GITLAB_*`).
    - Tauri 2 plugins (macOS and Windows), Capacitor plugins (Android SDK and
      a device), and Argon2id on a mid-range Android phone.
- **Next milestone:** finish P0.2 (the forge spikes are the highest risk).
  P0.3 core primitives depends only on P0.1, so it can start in parallel if
  the forge spikes stay blocked.
- **Blockers / needs owner input:** forge test credentials and network access
  (see above), and a machine or device for the Tauri, Capacitor and Android
  spikes.
- **Known risks:**
  - GitLab commit concurrency (`last_commit_id`) and archive-download CORS
    have not been verified yet.
  - API rate limits during the first sync of large repos.
  - On the web, only one tab can open the database (ADR-011); P0.5 must
    handle a second tab.
- **Unverified:** spike timings come from a cloud sandbox with slow storage;
  re-measure on real hardware before tuning.

## Session log

### 2026-10-09 — P0.2 spikes: sqlite-wasm and Argon2id
- Added `spikes/web-runtime` (a workspace package, excluded from ESLint): a
  Vite page with sqlite and Argon2id workers, driven by headless Chromium
  through `run.mjs`.
- sqlite-wasm 3.53.4: FTS5 is available and tokenizes Persian. `opfs-sahpool`
  works without COOP/COEP (so GitHub Pages works) and survives reloads, but
  only one tab can hold it. The `opfs` VFS needs COOP/COEP. With a 32 MiB
  cache, queries over 50k rows ran in under 40 ms; each commit costs about
  20 ms here, so writes must be batched. Recorded as ADR-011, and
  ARCHITECTURE §4 was updated.
- Argon2id (libsodium 1.0.22, wasm): about 0.2 s at 64 MiB and 1 s at
  256 MiB on 4 vCPUs. The SECURITY.md parameters are kept (ADR-012).
- Surprises: the sqlite-wasm README's `'opfs' in sqlite3` check is out of date
  (use `sqlite3.oo1.OpfsDb`). DevTools CPU throttling doesn't apply to
  workers, so it can't simulate a phone. The sandbox proxy blocks
  api.github.com, so the forge spikes couldn't run.

### 2026-10-09 — P0.1 Monorepo & tooling
- Set up the pnpm + Turborepo workspace, with skeletons for every package in
  ARCHITECTURE.md §3. `apps/desktop` and `apps/mobile` are placeholders until
  P0.7.
- Strict TS base config, ESLint flat config and Prettier.
  - `@lm/eslint-plugin` adds `no-physical-direction` (Tailwind classes and
    inline styles), with 41 tests.
  - `@lm/core` is restricted from DOM, network and Node APIs.
  - `@lm/repo-checks` (`lm-check-deps`) enforces the dependency direction and
    runs in `pnpm lint`.
- Vitest in every package (ui uses jsdom + Testing Library); a Playwright
  smoke test in light and dark (RTL projects come in P0.7, together with RTL
  support); Ladle for `@lm/ui`.
- Added the CI workflow (`check` and `e2e` jobs) and a cloud SessionStart hook
  (installs deps, sets `PW_CHROMIUM_PATH`).
- Pinned TypeScript 6.0 and ESLint 9 because of plugin compatibility
  (ADR-009). Packages ship TS source with no build step (ADR-010).
- Turborepo writes an agent-guidance block into AGENTS.md automatically; it is
  kept on purpose.

### 2026-10-09 — Planning session
- Gathered requirements from the owner and recorded them as decisions
  ADR-001…008.
- Wrote ARCHITECTURE, SYNC, SECURITY, DATA-MODEL, DESIGN, TECH-STACK, RELEASE
  and ROADMAP, plus AGENTS.md and CLAUDE.md.
- Owner's answers: sync through GitHub/GitLab, including from the web; iOS
  eventually; installers without app stores; usable by anyone with their own
  repo; importers wanted; minimal modern design with dark and light modes; en
  + fa (RTL); Jalali; multi-currency; Claude + Ollama; all four calendar
  source types.
