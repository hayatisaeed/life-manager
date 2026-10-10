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
pnpm preflight   # unauthenticated CORS preflights only; no token needed
```

The forge spikes create a scratch branch `lm-spike-<random>` and delete it at
the end. Point them at a throwaway repo, never at a real data repo. Each one
prints PASS/FAIL lines to stderr and a JSON summary to stdout.

## Results

| Spike | Status | Result |
|---|---|---|
| sqlite-wasm OPFS in a worker | ✅ run (headless Chromium 141, Linux) | Both VFSes work, FTS5 is compiled in; see below |
| Argon2id timing | ⚠️ partly run (x86 Xeon, Node + Chromium) | 256 MiB works in browser wasm; Android not measured |
| GitHub API from the browser | ⚠️ preflights pass; read-side checks pass; write/CAS script not run | Owner runs `pnpm github` locally (see below) |
| GitLab API from the browser | ⚠️ preflights pass; full script not run | Needs a scratch project and token |
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
- **Set `cache_size`.** A second run used a 31 MiB DB: a `WITHOUT ROWID`
  `task` table with the ARCHITECTURE.md §4 sync columns and 30-word notes.
  - With the default 2 MiB page cache, a full-scan `count(*)` took 3.4–3.6 s
    on `opfs-sahpool` and 5.0 s on `opfs`.
  - With `PRAGMA cache_size = -32000` (32 MiB) it took 41–65 ms.
  - So the web driver must raise the cache. The 40 ms above came from a
    smaller DB that fit in the default cache.
- In that same run, one committed transaction (a row update plus a
  `change_log` insert) cost about 20 ms on `opfs-sahpool` and about 40 ms on
  `opfs`. `synchronous=NORMAL` saved only about 5%. User edits are fine; sync
  must batch.
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

### Forge CORS preflights (`forges/preflight.mjs`), run 2026-10-10

These are unauthenticated `OPTIONS` requests from Node, with
`Origin: https://app.example`, as a browser would send them. All six pass,
and each response has `Access-Control-Allow-Origin: *`. Raw output is in
`forges/preflight-result.jsonl`.

| Request | Result |
|---|---|
| GitHub GraphQL `POST` | 204 ✅ |
| GitHub `git/trees` `POST` | 204 ✅ |
| GitHub `git/refs` `PATCH` | 204 ✅ |
| GitLab `repository/tree` `GET` | 200 ✅ |
| GitLab `repository/commits` `POST` | 200 ✅ |
| GitLab `repository/archive.tar.gz` `GET` | 200 ✅ |

- The GitHub requests sent `authorization` and `content-type`. GitHub also
  allows `If-Match` and `If-None-Match`.
- The GitLab requests sent `private-token` and `content-type`. GitLab exposes
  `Link`, `X-Next-Page`, `X-Total-Pages` and `X-Gitlab-Last-Commit-Id` to
  browsers.

A passing preflight is necessary but not sufficient. It doesn't show that the
real responses carry CORS headers, especially GitLab's archive redirect. So
the authenticated scripts below are still needed.

### GitHub (`forges/github.mjs`)

Checks:

- CORS: preflights for REST `PATCH` and GraphQL `POST` with an
  `authorization` header, `access-control-allow-origin` on real responses, and
  exposed `x-ratelimit-*` headers.
- **Empty repo** (the onboarding case, SYNC.md §8). It records what the git
  data API does on an empty repo, then creates the first commit with the
  contents API (`PUT /contents/lm-spike.json`).
- A 100-file tree → commit → ref update using the real `.lmr` layout
  (`r/<s1>/<s2>/<name>.lmr`) and the `Life Manager <noreply@invalid>` author.
- Git blob SHAs computed locally match the tree for all 100 files.
- One GraphQL query reading the 100 blobs by `object(oid:)`, and its point
  cost. What GraphQL returns for a binary blob.
- A 256 KiB binary `.lmb` round trip through `POST/GET /git/blobs`.
- Delete via `sha: null` plus add-by-SHA in one commit, and whether the empty
  directory disappears.
- CAS:
  - A same-parent race: the second update must get 422.
  - A stale parent (the branch has moved to a descendant) must also get 422.
  - 5 rounds of truly concurrent fast-forwards: exactly one wins each round.

It writes `forges/github-result.json`, which contains no token.

**Run 2026-10-10 from the cloud sandbox, partial.** The session proxy forbids
REST writes (`git/blobs`, `git/trees`, `contents` PUT → 403), `OPTIONS`
requests and GraphQL, so only the read side could be checked:

- An empty repo returns **409 "Git Repository is empty."** from
  `GET /git/ref/heads/main`. The transport must treat that as "empty repo",
  not as an error.
  - It's still unconfirmed whether the git data API accepts writes on an
    empty repo. GitHub is known to return 409 there; if so, onboarding must
    create `lm.json` with the contents API first. The owner's run will settle
    this.
- Read-only, against the code repo (196 entries):
  - Locally computed git blob SHAs (SHA-1 of `blob <len>\0` + content)
    matched GitHub's for 20/20 blobs read through `GET /git/blobs`.
  - A non-recursive root → leaf tree walk reached the same SHA as the
    recursive tree.
  - About 260 ms per REST blob read, so blob reads must be batched through
    GraphQL, as planned.
- Authenticated responses carry `Access-Control-Allow-Origin: *` and expose
  the rate-limit headers.

**To finish it, run locally against a throwaway repo:**

```sh
cd spikes && pnpm install --ignore-workspace
LM_TEST_GITHUB_TOKEN=github_pat_… LM_TEST_GITHUB_REPO=owner/throwaway pnpm github
```

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
