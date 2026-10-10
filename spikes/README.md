# P0.2 spike results

Throwaway code for ROADMAP P0.2. Results are summarised in DECISIONS.md
(ADR-011). Run the scripts from the repo root with `node spikes/<file>.mjs`.

| Spike | Result | Verified where |
|---|---|---|
| GitLab API CORS | `OPTIONS` preflights to `/api/v4/projects/:id/repository/tree` and `/repository/archive.tar.gz` return `access-control-allow-origin: *`, allow `authorization,content-type`, and **expose `X-Gitlab-Last-Commit-Id`, `X-Gitlab-Commit-Id`, `X-Next-Page`**. Archive download is CORS-enabled. | curl from the cloud container (gitlab.com) |
| GitLab `last_commit_id` CAS | Not run (needs a test project + token). The fake forge models the documented behaviour (400 "A file with this name doesn't exist" / "You are attempting to update a file that has changed since you started editing it"). | — **unverified** |
| GitHub API CORS | Could not reach `api.github.com` from the sandbox (proxy 403). GitHub documents CORS support for any origin on REST and GraphQL (`docs.github.com/rest/using-the-rest-api/using-cors-and-jsonp`). The `PATCH …/git/refs` `force:false` → 422 behaviour is documented and modelled in the fake forge. | docs only — **unverified** |
| sqlite-wasm | 50k JSON rows inserted in ~0.6 s (Node, in-memory); an expression index on `json_extract(data,'$.due')` answers a lookup in ~7 ms; **FTS5 is compiled in**. OPFS persistence is checked in the browser by the Playwright suite using the `opfs-sahpool` VFS (no COOP/COEP headers needed). | Node 22 + headless Chromium |
| libsodium-wrappers-sumo Argon2id (ops 3) | 64 MiB ≈ 0.26 s, 128 MiB ≈ 0.41 s, 256 MiB ≈ 1.26 s on the cloud container CPU. A mid-range phone is typically 3–5× slower, so 64 MiB on mobile/web (≈1 s) and 256 MiB on desktop stays as SECURITY.md specifies. | Node 22 (x86-64) — phone **unverified** |
| Tauri 2 plugins (sql, keyring, http) | Not runnable here (no macOS/Windows host). | **unverified** |
| Capacitor (sqlite, secure storage, native HTTP) | Not runnable here (no Android SDK). | **unverified** |
