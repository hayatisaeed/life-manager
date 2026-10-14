# Sync implementation and verification

Implemented: record sync on an existing vault v2, authenticated active-state and
generation checks, pinned Merkle reads, 100-record batches, CAS retries, rate
limits, locks, conditional acknowledgments and ciphertext problem preservation.
The SQLite store rechecks current rows inside transactions; it never clears an
edit newer than the version pushed. Resolved ciphertext remains exportable.

GitHub uses REST git-data writes and GraphQL blob reads. GitLab uses pinned
keyset listings, bounded raw reads and a shared `lm.json` file commit guard.
GitLab writes require `verifiedWriteGate`; only dedicated contract validation
can establish that prerequisite. Web callers must supply the platform HTTP
allowlist, encrypted secrets and Web Locks adapters. Keys remain memory-only
until deliberately persisted through `platform.secrets`.

This is not wired into the local web UI. Empty-repo initialization, onboarding,
attachment sync, durable generation/identity pinning, migration orchestration,
offline-device recovery UI and native adapters remain outstanding. Maintenance
must stay unavailable until the accepted protocol's tests pass.

## Simulator

`pnpm test` includes a short simulator: five SQLite WASM replicas, 1,000 random
operations per replica across three independent seeds. It covers new records,
scalar/set/text edits, deletes/restores and random sync order. After quiescence,
all envelopes must match, no dirty/problem entries remain, and every original
text version observed during local writes must remain in every replica.

Run the full 1,000-seed profile directly (avoid Turbo's cached test task):

```sh
LM_SIM_SEEDS=1000 LM_SIM_OPS=1000 pnpm --filter @lm/sync exec vitest run src/convergence.test.ts
```

Use `LM_SIM_SEED` to set the first replay seed; default is `20261013`.
The long GitHub workflow partitions 1,000 distinct seeds into ten shards. Run it
manually, or set repository variable `LM_LONG_SIM_ENABLED=true` to opt into the
nightly schedule. Short local success is not completion of the 1,000-seed gate.
These tests cover notes as a representative envelope; full domain/attachment,
migration and arbitrary network-fault simulator coverage remains future work.

## Dedicated forge contracts

Supply environment variables through your shell or CI secrets, never committed
files. The repo must be **dedicated to synthetic testing**, private and already
initialized with a synthetic vault v2. Do not use a real personal vault.

| Provider | Required | Optional |
|---|---|---|
| GitHub | `LM_TEST_GITHUB_TOKEN`, `LM_TEST_GITHUB_REPO` (`owner/repo`), `LM_TEST_GITHUB_PASSPHRASE` | `LM_TEST_GITHUB_API_BASE`, `LM_TEST_GITHUB_BRANCH` |
| GitLab | `LM_TEST_GITLAB_TOKEN`, `LM_TEST_GITLAB_REPO` (project ID/path), `LM_TEST_GITLAB_PASSPHRASE` | `LM_TEST_GITLAB_API_BASE`, `LM_TEST_GITLAB_BRANCH` |

```sh
pnpm --filter @lm/sync exec vitest run src/contracts.test.ts
```

Each opt-in test holds two writes at the publication boundary, then releases
both. Exactly one create-only record batch plus header gate must succeed, and
the losing record must not appear. Only encrypted synthetic records and gated
headers are written. Records remain for inspection; tests never purge data.
Without these variables the two contract tests are explicitly not run.
These Node HTTP contracts do not prove browser CORS or mobile/native behavior;
those separate P0.2 spikes remain required.
