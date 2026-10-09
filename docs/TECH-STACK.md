# Tech Stack

**Versions:** use the latest stable release at the time a package is added,
pin it in the lockfile, and record major choices here. Replacing anything in
this list needs an entry in [DECISIONS.md](DECISIONS.md).

| Concern | Choice | Notes |
|---|---|---|
| Language | TypeScript 6.0 (strict, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`) | ESM only. Pinned below 7 until typescript-eslint supports it (ADR-009) |
| Package manager / monorepo | pnpm 10 workspaces + Turborepo 2 | Node 22 (`.nvmrc`) |
| Lint / format | ESLint 9 (flat config, typescript-eslint strict, react, react-hooks, jsx-a11y, `@lm/eslint-plugin`) + Prettier | ESLint pinned to 9 until the React plugins support 10 (ADR-009) |
| Internal packages | Export TypeScript source directly (`"exports": "./src/index.ts"`); no per-package build | Vite and Vitest compile them (ADR-010) |
| Unit tests | Vitest + fast-check; `@vitest/coverage-v8` for coverage gates | `core` enforces 100% coverage |
| E2E | Playwright (Chromium) against `apps/web` | |
| Component stories | Ladle | lighter than Storybook |
| UI framework | React 19 | |
| Bundler | Vite | |
| Routing | TanStack Router | type-safe, file-based |
| UI state | Zustand | data comes from live queries, not a global store |
| Forms | react-hook-form + zod resolvers | |
| Styling | Tailwind CSS v4 + CSS variables (tokens) | |
| Primitives | Radix UI | |
| Icons | lucide-react | |
| Drag and drop | dnd-kit | |
| Charts | visx | token-driven theming, RTL control |
| Markdown editor | CodeMirror 6 (markdown mode, live preview decorations) | stores plain Markdown |
| Markdown render | remark/rehype + DOMPurify | |
| Validation / schemas | zod | |
| Dates | date-fns + date-fns-jalali, @internationalized/date for time zones | |
| i18n | i18next + react-i18next | |
| IDs / clocks | `ulid`, own HLC implementation in `core` | ULID entropy and HLC time come from the injected `Rng` and `Clock` |
| Order keys | `fractional-indexing` | base-62 keys, compared by code unit (ADR-012) |
| SRS | ts-fsrs | |
| Text merge | node-diff3 | |
| Crypto | libsodium-wrappers-sumo | Argon2id requires the sumo build |
| SQLite (web) | @sqlite.org/sqlite-wasm (`opfs-sahpool` VFS) | runs in a worker; one owner tab (ADR-011) |
| SQLite (desktop) | tauri-plugin-sql | |
| SQLite (mobile) | @capacitor-community/sqlite | |
| Desktop shell | Tauri 2 + plugins: sql, http, notification, global-shortcut, autostart, updater, dialog, fs, os, deep-link; keyring via the `keyring` crate | |
| Mobile shell | Capacitor + plugins: Local Notifications, Filesystem, Share (target), App, Preferences, secure storage (Keystore), voice recorder, Http | |
| HTTP | `fetch` on web; native HTTP adapters on Tauri and Capacitor behind `platform.http` | |
| GitHub/GitLab API | thin hand-written clients in `packages/sync/transports` | avoids heavy SDKs and keeps CORS behavior explicit |
| Calendars | ical.js, tsdav, Google Calendar REST (hand-written) | |
| AI | `@anthropic-ai/sdk` (Claude), plain fetch for Ollama | the default model id lives in one constant |
| Transcription | whisper.cpp sidecar (desktop) | ggml base/small multilingual models, downloaded on demand |
| Importers | papaparse (CSV), jszip + sql.js for Anki `.apkg`, vCard parser (own, small) | |
| Passphrase strength | zxcvbn-ts | |
