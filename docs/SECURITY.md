# Security & Privacy

## 1. Threat model

| Actor | Can | Must not be able to |
|---|---|---|
| Forge (GitHub/GitLab), or someone who steals the repo | Read all files and history; delete or corrupt files | Read any user data, record types, ids or names; forge valid records |
| Network attacker | Observe TLS metadata | Read or modify traffic (TLS only, no plain-HTTP fallback) |
| Someone holding an unlocked device | Everything the user can do | — (out of scope; rely on OS lock and disk encryption) |
| AI provider | See exactly what the user chose to send | See modules the user excluded, or anything sent without the user starting it |
| A malicious import file | — | Run code (importers parse data only; Markdown is sanitized) |

**Accepted leaks to the forge:**

- The number of records and their approximate sizes.
- Commit timestamps, which show activity patterns.
- The repo name, which the user chooses.

## 2. Cryptography

All primitives come from **libsodium** (`libsodium-wrappers-sumo`). We never
implement our own primitives.

| Use | Primitive |
|---|---|
| Passphrase → key-encryption key | Argon2id (`crypto_pwhash`); ops 3, mem 256 MiB on desktop, 64 MiB on mobile/web; the parameters are stored in `lm.json` |
| Record and blob encryption | XChaCha20-Poly1305 IETF with random 24-byte nonces |
| Key wrapping | XChaCha20-Poly1305 |
| File names | BLAKE2b-256 keyed with `pathKey` |
| Sub-keys | `crypto_kdf_derive_from_key(dataKey, id 1)` with the 8-byte contexts `"lm-rec1_"`, `"lm-blob_"`, `"lm-path_"`, `"lm-locl_"` (ADR-012) |
| Recovery key | 256 random bits plus a 1-byte BLAKE2b checksum, shown as a grouped base32 string (`XXXX-XXXX-…`, 53 characters) |

**Associated data:**

- Records: `"lmr1|" + name` (the keyed-hash file name), plus a post-decrypt
  check that the record id hashes to that name.
- Blobs: `"lmb1|" + contentHash`.
- Wrapped keys: `"lmk1|" + kind`.
- Device-local secrets (web): `"lml1|" + secretName`.

## 3. Key lifecycle

- **Data key:** created once per repo. It is never sent anywhere unencrypted.
- **On each device:**
  - **Native:** the unwrapped data key is stored in the OS keychain (macOS
    Keychain, Windows Credential Manager, Android Keystore) and released after
    an optional biometric or OS-auth check.
  - **Web:** the data key is kept only in memory. The passphrase is asked for on
    each session, and an "unlock for 7 days" option keeps a non-extractable
    WebCrypto key wrapping it in IndexedDB.
- **Auto-lock:** optional. The app locks after N minutes in the background on
    mobile and desktop.
- **Sign-out and wipe:** removes the keys, tokens, local DB and attachments
  from the device.

## 4. Secrets

The forge token, AI API keys, calendar OAuth refresh tokens and CalDAV
passwords:

- **Native:** stored in the OS keychain through `packages/platform`. Never in
  SQLite, localStorage or logs.
- **Web:** encrypted with the `"lm-locl"` sub-key and stored in IndexedDB.
- **Device-local by default.** A later option, "sync my settings", stores them
  as encrypted records.

## 5. Local data at rest

- **v1:** the local SQLite database is not encrypted separately. It relies on
  OS full-disk encryption. **Attachments are encrypted** at rest because they
  are often sensitive (IDs, contracts).
- **Later:** SQLCipher on desktop and mobile as an option. This is tracked in
  the roadmap.

## 6. App hardening rules (agents must follow these)

- **No telemetry, analytics or crash reporting** that sends data off the device
  unless the user explicitly opts in. None is planned.
- **Network calls** go only to the configured forge, AI provider, calendar
  connectors, FX-rate endpoint and update endpoint. Each is listed in
  `packages/platform/net/allowlist.ts`, and the Tauri capability config
  mirrors that list.
- **Tauri:** use a strict CSP, give each window the minimum capabilities, and
  never use `shell.open` with untrusted URLs without validation.
- **Rendered Markdown** is sanitized (DOMPurify). Raw HTML in notes is
  disabled.
- **Logs** never include record contents, tokens or keys. Use `redact()`
  helpers.
- **Dependencies:** lockfile committed, with `pnpm audit` in CI. New
  dependencies need a line in DECISIONS.md if they touch crypto, sync or
  networking.
