# P0.2 spikes

Throwaway code that checks the riskiest assumptions in the specs before we
build on them. It is **not** part of the pnpm workspace and is not linted.
Decisions that came out of these spikes are recorded in
[DECISIONS.md](../docs/DECISIONS.md) (ADR-011) and in the spec docs.

```sh
cd spikes
pnpm install --ignore-workspace
PW_CHROMIUM_PATH=/path/to/chromium pnpm sqlite   # or omit PW_CHROMIUM_PATH if Playwright's browser is installed
PW_CHROMIUM_PATH=/path/to/chromium pnpm argon2
LM_TEST_GITHUB_TOKEN=… LM_TEST_GITHUB_REPO=owner/scratch-repo pnpm github
LM_TEST_GITLAB_TOKEN=… LM_TEST_GITLAB_PROJECT=group/scratch-repo pnpm gitlab
```

The forge spikes create a scratch branch `lm-spike-<random>` and delete it at
the end. Point them at a throwaway repo, never at a real data repo. Each one
prints PASS/FAIL lines to stderr and a JSON summary to stdout.

## Results

| Spike | Status | Result |
|---|---|---|
| sqlite-wasm OPFS in a worker | ✅ run (headless Chromium 141, Linux) | Both VFSes work, FTS5 is compiled in; see below |
| Argon2id timing | ⚠️ partly run (x86 Xeon, Node + Chromium) | 256 MiB works in browser wasm; Android not measured |
| GitHub API from the browser | ⏳ script ready, not run | Needs a scratch repo and token |
| GitLab API from the browser | ⏳ script ready, not run | Needs a scratch project and token |
| Tauri 2 plugins | ⏳ not run | Needs macOS and Windows machines (P0.7 scaffolds the app) |
| Capacitor plugins | ⏳ not run | Needs the Android SDK and a device |

### sqlite-wasm OPFS (`sqlite-opfs/`)

`@sqlite.org/sqlite-wasm` 3.53.4, 50,000 rows (`records` table with a
`(type, hlc)` index, plus a contentless FTS5 table with 4-word titles and
40-word bodies), each row inserted in one transaction. Times in ms, headless
Chromium 141 on a 4-core 2.1 GHz Xeon:

| VFS | init | insert 50k + FTS | count(*) | indexed query (50) | FTS `a AND b` | 100 updates (1 tx) | reopen in a new worker |
|---|---|---|---|---|---|---|---|
| `opfs` (needs COOP/COEP) | 77 | 4,948 | 40 | 3 | 6 | 363 | 50,000 rows still there; cold queries 13–86 |
| `opfs-sahpool` (no COOP/COEP) | 57 | 4,484 | 30 | 2 | 3 | 180 | 50,000 rows still there; cold queries 14–60 |

Findings:

- FTS5 is available (`sqlite_compileoption_used('ENABLE_FTS5') = 1`).
- `journal_mode=wal` is not available on either VFS; it stays `delete`. Batch
  writes into transactions.
- `opfs-sahpool` is as fast or faster and does **not** need cross-origin
  isolation. The `opfs` VFS needs `SharedArrayBuffer`, so COOP/COEP headers,
  which would block cross-origin images and embeds without CORP headers and
  are awkward on static hosting.
- `opfs-sahpool` allows only one connection per origin at a time, so a second
  tab cannot open the database. We need a single owner tab (Web Locks), which
  the sync engine already needs (SYNC.md §5).
- The package README's `'opfs' in sqlite3` check is stale: the bootstrap
  deletes `sqlite3.opfs` after init. Check `sqlite3.oo1.OpfsDb` instead.
- A 50k-row first import takes about 5 s, so the initial download needs a
  progress bar (already planned) and must write in batches.

### Argon2id (`argon2/`)

`libsodium-wrappers-sumo` 0.8.4, `crypto_pwhash` with `ALG_ARGON2ID13`,
median of 3 runs after a warm-up, 4-core 2.1 GHz Xeon:

| ops | mem | Node 22 | Chromium 141 (wasm, main thread) |
|---|---|---|---|
| 3 | 64 MiB | 203 ms | 169 ms |
| 3 | 128 MiB | 465 ms | 407 ms |
| 3 | 256 MiB | 1,024 ms | 798 ms |
| 2 | 256 MiB | 520 ms | 512 ms |
| 4 | 64 MiB | 217 ms | 202 ms |

Findings:

- 256 MiB allocates fine in browser wasm. Time scales roughly linearly with
  memory.
- **Spec gap:** SECURITY.md §2 says 256 MiB on desktop and 64 MiB on
  mobile/web, but `lm.json` has a single `kdf` block, so the parameters are
  per repo and fixed by whichever device creates it. A phone joining a repo
  made on a desktop must run the 256 MiB derivation. This is raised as an
  owner question in docs/STATUS.md.
- Still to do: run `argon2/index.html` on a mid-range Android phone (Chrome,
  and later the Capacitor WebView) and record the 64/128/256 MiB timings.

### GitHub (`forges/github.mjs`)

Checks: CORS preflight for REST `PATCH` and GraphQL `POST` with an
`authorization` header; `access-control-allow-origin` on real responses; that
`x-ratelimit-*` headers are exposed; a 100-file tree → commit → ref update;
one GraphQL query reading the 100 blobs by `object(oid:)` and its point cost;
a stale-parent ref update with `force:false` returning 422; and two
simultaneous fast-forwards where exactly one must win.

Not run: this cloud session can't reach a scratch repo (the session's GitHub
access is limited to the code repo, and probing other endpoints was not
permitted). Run it locally with a throwaway repo.

### GitLab (`forges/gitlab.mjs`)

Checks: CORS preflight for `POST /repository/commits`; CORS on responses; a
250-file commit; keyset tree pagination over 3 pages returning 40-hex SHAs,
and whether the `Link` header is exposed to browsers; `last_commit_id` on the
files API; that a stale `last_commit_id` and a duplicate `create` are
rejected; two concurrent same-file updates where exactly one must win; and
CORS on `repository/archive.tar.gz`.

Not run, for the same reason as GitHub.

### Tauri 2 and Capacitor

Not run here (no macOS/Windows or Android tooling in the cloud session). Do
them together with the P0.7 shell scaffolding:

- **Tauri:** a minimal app using `tauri-plugin-sql` (open, migrate, 50k
  inserts), the `keyring` crate (set/get/delete a secret), and
  `tauri-plugin-http` (a `GET` to the forge with an `authorization` header,
  checking the scope config) on macOS and Windows.
- **Capacitor:** `@capacitor-community/sqlite` (same 50k benchmark),
  secure storage backed by the Keystore, and `CapacitorHttp` against the forge
  on Android. Run `argon2/index.html` in the WebView at the same time.
