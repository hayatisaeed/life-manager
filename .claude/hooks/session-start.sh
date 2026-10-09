#!/bin/bash
# Installs workspace dependencies so lint, typecheck and tests work in
# Claude Code cloud sessions. Local sessions are left alone.
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "$CLAUDE_PROJECT_DIR"

# `pnpm install` (not --frozen-lockfile) so the cached container state is reused.
pnpm install

# Cloud containers ship a preinstalled Chromium; point Playwright at it.
if [ -n "${CLAUDE_ENV_FILE:-}" ] && [ -x /opt/pw-browsers/chromium ]; then
  echo 'export PW_CHROMIUM_PATH=/opt/pw-browsers/chromium' >> "$CLAUDE_ENV_FILE"
fi
