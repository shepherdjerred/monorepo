#!/usr/bin/env bash
# Provision and validate the native macOS Buildkite host.
#
# This script automates the reproducible setup. Apple ID, FileVault, signing,
# and Accessibility prompts remain interactive by design.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
XCODE_VERSION="$(tr -d '[:space:]' < "$REPO_ROOT/.xcode-version")"
RUN_BOOTSTRAP=1
INSTALL_XCODE=1

usage() {
  cat <<'EOF'
Usage: provision-host.sh [--skip-bootstrap] [--skip-xcode]

Provision and validate the Apple Silicon native Buildkite host.

Options:
  --skip-bootstrap  Reuse packages and agent configuration already installed.
  --skip-xcode      Do not download or select Xcode; validate the current host.
EOF
}

while (($# > 0)); do
  case "$1" in
    --skip-bootstrap)
      RUN_BOOTSTRAP=0
      ;;
    --skip-xcode)
      INSTALL_XCODE=0
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      echo "error: unknown option: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
  shift
done

if [[ "$(uname -s)" != "Darwin" || "$(uname -m)" != "arm64" ]]; then
  echo "error: native CI requires an Apple Silicon macOS host" >&2
  exit 1
fi

if ((RUN_BOOTSTRAP)); then
  if [[ -z "${BUILDKITE_AGENT_TOKEN:-}" ]]; then
    if ! command -v op >/dev/null; then
      echo "error: op is required when BUILDKITE_AGENT_TOKEN is not set" >&2
      exit 1
    fi
    echo "==> Reading the Buildkite agent token from 1Password"
    BUILDKITE_AGENT_TOKEN="$(op item get "Buildkite Agent Token" \
      --vault "Homelab (Kubernetes)" \
      --fields "BUILDKITE_AGENT_TOKEN" \
      --reveal)"
  fi
  export BUILDKITE_AGENT_TOKEN
  trap 'unset BUILDKITE_AGENT_TOKEN' EXIT

  echo "==> Running the reproducible package and agent bootstrap"
  "$SCRIPT_DIR/bootstrap.sh"
fi

if ((INSTALL_XCODE)); then
  if ! command -v xcodes >/dev/null; then
    echo "error: xcodes is not installed; run without --skip-bootstrap first" >&2
    exit 1
  fi
  echo "==> Installing/selecting Xcode $XCODE_VERSION"
  if ! xcodes installed | awk -v version="$XCODE_VERSION" '$0 ~ version { found = 1 } END { exit !found }'; then
    xcodes install "$XCODE_VERSION" --select
  else
    xcodes select "$XCODE_VERSION"
  fi
  sudo xcodebuild -license accept
  sudo xcodebuild -runFirstLaunch
  xcodes signout
fi

echo "==> Validating Xcode and native toolchain"
xcodebuild -version
xcode-select -p
command -v xcodegen >/dev/null
command -v swiftlint >/dev/null

echo "==> Validating the always-unlocked CI login session"
screen_lock_status="$(sysadminctl -screenLock status 2>&1)"
if [[ "$screen_lock_status" != *"screenLock is off"* ]]; then
  echo "error: macOS screen lock must be off for unattended signing and UI tests" >&2
  echo "       $screen_lock_status" >&2
  echo "       rerun without --skip-bootstrap to configure it" >&2
  exit 1
fi

echo "==> Checking FileVault and signing prerequisites"
fdesetup status
security find-identity -v -p codesigning

echo "==> Running the native preflight"
cd "$REPO_ROOT"
# The preflight is the acceptance check used by Buildkite. Run both suites so
# this host script fails with the same actionable reason CI would report.
# shellcheck source=.buildkite/scripts/macos-native-env.sh
. .buildkite/scripts/macos-native-env.sh
bun --no-install .buildkite/scripts/macos-native-preflight.ts quotabar
bun --no-install .buildkite/scripts/macos-native-preflight.ts tasknotes

echo
echo "Native host setup is complete only after:"
echo "  - FileVault is enabled with the recovery key escrowed in 1Password."
echo "  - Exactly one Apple Development identity is installed for the jerred user."
echo "  - The generated TaskNotes UI runner is approved in Privacy & Security > Accessibility."
echo
echo "Run the affected native preflight from:"
echo "  $REPO_ROOT"
echo
echo "  . .buildkite/scripts/macos-native-env.sh"
echo "  bun --no-install .buildkite/scripts/macos-native-preflight.ts quotabar"
