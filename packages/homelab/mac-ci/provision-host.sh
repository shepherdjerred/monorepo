#!/usr/bin/env bash
# Provision and validate the native macOS Woodpecker CI host.
#
# This script automates the reproducible setup. Apple ID, FileVault, signing,
# and Accessibility prompts remain interactive by design.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
XCODE_VERSION="$(tr -d '[:space:]' < "$REPO_ROOT/.xcode-version")"
RUN_BOOTSTRAP=1
INSTALL_XCODE=1

# gRPC endpoint, host:port with no scheme. Tailnet rather than the public
# hostname: the agent endpoint is guarded only by the shared agent secret, so
# it is deliberately not exposed through the Cloudflare tunnel.
WOODPECKER_SERVER="${WOODPECKER_SERVER:-woodpecker-grpc:9000}"
# 1Password item holding WOODPECKER_AGENT_SECRET, in the Homelab (Kubernetes)
# vault. Same item the in-cluster server reads its forge OAuth2 credentials
# from (see cdk8s .../ci/woodpecker-credentials.ts).
WOODPECKER_ITEM="${WOODPECKER_ITEM:-Woodpecker Server}"

usage() {
  cat <<'EOF'
Usage: provision-host.sh [--skip-bootstrap] [--skip-xcode]

Provision and validate the Apple Silicon native CI host.

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
  # Same shared secret the in-cluster agents use, read straight from 1Password
  # into this process. It is exported for bootstrap.sh and unset on exit; it is
  # never written to disk here, and bootstrap.sh's own chmod-600 env file is the
  # only place it lands.
  if [[ -z "${WOODPECKER_AGENT_SECRET:-}" ]]; then
    if ! command -v op >/dev/null; then
      echo "error: op is required when WOODPECKER_AGENT_SECRET is not set" >&2
      exit 1
    fi
    echo "==> Reading the Woodpecker agent secret from 1Password"
    WOODPECKER_AGENT_SECRET="$(op item get "$WOODPECKER_ITEM" \
      --vault "Homelab (Kubernetes)" \
      --fields "WOODPECKER_AGENT_SECRET" \
      --reveal)"
  fi
  export WOODPECKER_AGENT_SECRET WOODPECKER_SERVER
  trap 'unset WOODPECKER_AGENT_SECRET' EXIT

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

echo "==> Allowing XCTest to enable Automation Mode without authentication — needs sudo"
sudo /usr/bin/automationmodetool enable-automationmode-without-authentication
/usr/bin/automationmodetool

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
# The preflight is the acceptance check CI uses. Run both suites so
# this host script fails with the same actionable reason CI would report.
# shellcheck source=ci/scripts/macos-native-env.sh
. ci/scripts/macos-native-env.sh
bun --no-install ci/scripts/macos/macos-native-preflight.ts quotabar
bun --no-install ci/scripts/macos/macos-native-preflight.ts tasknotes

echo
echo "Native host setup is complete only after:"
echo "  - FileVault is enabled with the recovery key escrowed in 1Password."
echo "  - Exactly one Apple Development identity is installed for the jerred user."
echo "  - The generated TaskNotes UI runner is approved in Privacy & Security > Accessibility."
echo
echo "Run the affected native preflight from:"
echo "  $REPO_ROOT"
echo
echo "  . ci/scripts/macos-native-env.sh"
echo "  bun --no-install ci/scripts/macos/macos-native-preflight.ts quotabar"
