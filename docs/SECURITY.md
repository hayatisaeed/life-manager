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
| Sub-keys | `crypto_kdf_derive_from_key(dataKey)` with contexts `"lm-rec1"`, `"lm-blob"`, `"lm-path"`, `"lm-locl"` |
| Recovery key | 256 random bits, shown as 24 words (BIP-39 English list) or as a base32 grouped string |

**Associated data:**

- Records: `"lmr1|" + opaqueRemotePath`; verify the decrypted ID maps to that
  path before accepting it (ADR-011).
- Blobs: `"lmb1|" + contentHash`.
- Wrapped keys: `"lmk1|" + kind`.
- Vault v2 control: `"lmc2|" + hex(BLAKE2b-256(canonical header tuple))`,
  with the record subkey. See the maintenance protocol §4 for exact tuple bytes.

KDF contexts above are NUL-padded to exactly eight bytes, with subkey ID 1
per context (ADR-012). Recovery strings use RFC 4648 base32, grouped in four
characters with no padding; nonzero trailing bits are rejected.

## 3. Key lifecycle

**Accepted maintenance policy (ADR-016):** Vault v2 authenticates encrypted
control and clear header metadata using the record subkey and the `lmc2|` domain.
Version 1 remains readable for legacy vaults; ordinary v2 sync rejects v1 writes.
[The maintenance protocol](SYNC-MAINTENANCE-PROPOSAL.md) specifies fencing,
independent-key rotation and returning-device recovery. Maintenance requires
verified snapshot migration into a new private repo and retains the source
archive. No old-data-key-to-new-key bridge is published. Local recovery keys and
old attachment/secret keys stay exclusively behind `platform.secrets` until
rewrites verify. Retain tombstones/text ancestry; do not purge by elapsed time.

- **Data key:** created for the vault; rotation generates an independent new key. It is never sent anywhere unencrypted.
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
