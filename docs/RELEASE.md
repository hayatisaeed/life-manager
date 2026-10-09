# Building & Releasing

Installers are distributed **outside the app stores**, through **GitHub Releases**
on this repository. The apps update themselves.

## 1. Artifacts per release

| Platform | Artifacts | Notes |
|---|---|---|
| macOS | `.dmg` (universal: arm64 + x86_64), `.app.tar.gz` + `.sig` for the updater | |
| Windows | `.msi` and NSIS `.exe` (x64; arm64 later), plus the updater bundle + `.sig` | |
| Android | `.apk` (universal) signed with the release keystore | The update check reads `latest.json` from GitHub Releases |
| Web | Static build deployed to GitHub Pages (optional) | It's a client-only PWA, so it's safe to host statically |

## 2. Versioning

- Semantic versioning, with one version shared by all apps. The version lives
  in the root `package.json`, and a script stamps it into `tauri.conf.json` and
  Android's `versionName`/`versionCode`.
- Git tags `vX.Y.Z` trigger the release workflow.
- `CHANGELOG.md` is generated from Conventional Commits.

## 3. Signing

| What | How | Required? |
|---|---|---|
| Tauri updater | Ed25519 key pair (`tauri signer generate`). The public key goes in `tauri.conf.json`; the private key is a CI secret. | **Yes**: the updater refuses unsigned updates |
| Android APK | Release keystore, kept as a CI secret | **Yes**. If the key is lost, users can't update; they have to reinstall. Back it up offline. |
| macOS code signing + notarization | Apple Developer ID ($99/yr) | Optional. Without it, users must right-click → Open, or run `xattr -d com.apple.quarantine`, on first launch. Document this on the download page. |
| Windows Authenticode | OV/EV certificate or Azure Trusted Signing | Optional. Without it, SmartScreen shows "unknown publisher". |

CI secrets are named `TAURI_SIGNING_PRIVATE_KEY`,
`TAURI_SIGNING_PRIVATE_KEY_PASSWORD`, `ANDROID_KEYSTORE_B64`,
`ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`, and
optionally `APPLE_*` and `WINDOWS_*`. **Never commit key material.**

## 4. CI workflows (`.github/workflows/`)

- **`ci.yml`:** runs on every PR and push. Lint, typecheck, unit tests,
  convergence simulator (short run), web build, and Playwright smoke tests.
- **`release.yml`:** runs on a `v*` tag. A matrix of macOS, Windows and Ubuntu
  (for Android) builds runs `tauri-action` and the Gradle `assembleRelease`
  task. It then uploads the artifacts and `latest.json` to a draft release.
- **`nightly-sim.yml`:** a long convergence-simulator run, nightly.

## 5. Local builds

```bash
pnpm i
pnpm dev:web                 # http://localhost:5173
pnpm dev:desktop             # Tauri dev (needs Rust + platform deps)
pnpm dev:android             # Capacitor; needs Android SDK + JDK 17
pnpm build:desktop           # bundles for the host OS
pnpm build:android           # debug APK; release needs keystore env vars
```

## 6. iOS (later)

`apps/mobile` is a Capacitor project, so adding `ios/` is a `cap add ios`. App
Store distribution isn't planned. The likely routes are TestFlight or
AltStore, and both need an Apple Developer account. Keep all native code
behind `packages/platform` so iOS only needs adapter implementations.
