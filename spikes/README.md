# Spikes (P0.2)

Throwaway code that tests risky assumptions before the real packages are built.
Nothing here is imported by the app, and it is excluded from ESLint. The results
are recorded as ADRs in [docs/DECISIONS.md](../docs/DECISIONS.md).

| Spike | Folder | Status | Result |
|---|---|---|---|
| GitHub API from the browser | — | not run | needs a test repo and token (`LM_TEST_GITHUB_*`); the cloud sandbox's proxy blocks api.github.com |
| GitLab API from the browser | — | not run | needs a gitlab.com test project and token (`LM_TEST_GITLAB_*`) |
| sqlite-wasm OPFS in a worker | [web-runtime](web-runtime/RESULTS.md) | **done** | ADR-011 |
| Tauri 2 plugins | — | not run | needs macOS and Windows machines |
| Capacitor plugins | — | not run | needs the Android SDK and a device |
| libsodium Argon2id timing | [web-runtime](web-runtime/RESULTS.md) | desktop baseline only | ADR-012; the Android device measurement is still open |

Run the web-runtime spike with:

```sh
pnpm --filter @lm/spike-web-runtime spike             # sqlite + Argon2id in headless Chromium
pnpm --filter @lm/spike-web-runtime spike:argon2-node # Argon2id under Node, for comparison
```

`PW_CHROMIUM_PATH` is used if set (cloud sessions); otherwise Playwright's own
Chromium is used.
