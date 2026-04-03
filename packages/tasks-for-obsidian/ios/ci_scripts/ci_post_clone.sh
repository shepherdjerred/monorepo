#!/bin/bash
set -euo pipefail

# Ensure Homebrew binaries are in PATH on both Apple Silicon and Intel workers.
if [ -d "/opt/homebrew/bin" ]; then
  export PATH="/opt/homebrew/bin:$PATH"
fi
if [ -d "/usr/local/bin" ]; then
  export PATH="/usr/local/bin:$PATH"
fi

# Xcode Cloud provides CI_PRIMARY_REPOSITORY_PATH. Fall back for local script testing.
if [ -n "${CI_PRIMARY_REPOSITORY_PATH:-}" ]; then
  REPO_ROOT="$CI_PRIMARY_REPOSITORY_PATH"
else
  SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
  REPO_ROOT="$(cd "$SCRIPT_DIR/../../../.." && pwd)"
fi

PKG_DIR="$REPO_ROOT/packages/tasks-for-obsidian"

export HOMEBREW_NO_AUTO_UPDATE=1

if ! command -v node >/dev/null 2>&1; then
  echo "[ci_post_clone] Installing Node via Homebrew..."
  brew install node
fi

if ! command -v bun >/dev/null 2>&1; then
  echo "[ci_post_clone] Installing Bun..."
  curl -fsSL https://bun.sh/install | bash
  export BUN_INSTALL="$HOME/.bun"
  export PATH="$BUN_INSTALL/bin:$PATH"
fi

echo "[ci_post_clone] Installing JS dependencies in $PKG_DIR"
cd "$PKG_DIR"
# React Native + CocoaPods expect a physical node_modules tree.
# Bun's isolated linker can omit it on clean CI workers, so force hoisted mode.
bun install --frozen-lockfile --linker hoisted

echo "[ci_post_clone] Installing CocoaPods dependencies"
cd "$PKG_DIR/ios"
pod install
