#!/usr/bin/env bash
#
# Provision a fresh macOS host (Mac Mini) as a Buildkite CI agent on the
# `macos` queue.
#
# This is a THIN, idempotent, re-runnable bootstrap. The Mac is treated as a
# headless CI appliance, deliberately kept SEPARATE from the personal chezmoi
# dotfiles layer (packages/dotfiles/) — that layer is for workstations, not
# servers. Nothing here touches your personal shell, defaults, or apps.
#
# Usage:
#   BUILDKITE_AGENT_TOKEN="…" ./bootstrap.sh
#
# Get the token from 1Password (item "Buildkite Agent Token") — it's the same
# per-cluster token the in-cluster agents use, so no new token is needed:
#   BUILDKITE_AGENT_TOKEN="$(op read 'op://<vault>/Buildkite Agent Token/<field>')" \
#     ./bootstrap.sh
#
# Tailscale enrollment, FileVault, Xcode installation, signing, and the GUI
# privacy grants are documented manual steps in README.md. They require either
# interactive authentication or a deliberate security decision.

set -euo pipefail

POWER_BACKUP_FILE="/var/db/buildkite-mac-ci-pmset-before"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "error: this provisions a macOS host, but uname -s is $(uname -s)" >&2
  exit 1
fi

if [[ "$(uname -m)" != "arm64" ]]; then
  echo "error: native CI requires Apple Silicon, but uname -m is $(uname -m)" >&2
  exit 1
fi

if [[ -z "${BUILDKITE_AGENT_TOKEN:-}" ]]; then
  echo "error: BUILDKITE_AGENT_TOKEN is not set." >&2
  echo "Fetch it from 1Password (item \"Buildkite Agent Token\") and re-run:" >&2
  echo "  BUILDKITE_AGENT_TOKEN=\"\$(op read 'op://<vault>/Buildkite Agent Token/<field>')\" ./bootstrap.sh" >&2
  exit 1
fi

# --- 1. Homebrew -----------------------------------------------------------
if ! command -v brew >/dev/null 2>&1; then
  echo "==> Installing Homebrew"
  NONINTERACTIVE=1 /bin/bash -c \
    "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
fi
# Load brew into this shell's PATH (Apple Silicon prefix first, then Intel).
if [[ -x /opt/homebrew/bin/brew ]]; then
  eval "$(/opt/homebrew/bin/brew shellenv)"
elif [[ -x /usr/local/bin/brew ]]; then
  eval "$(/usr/local/bin/brew shellenv)"
else
  echo "error: brew not found after install" >&2
  exit 1
fi

# --- 2. Packages -----------------------------------------------------------
# buildkite-agent : the CI agent daemon
# mise            : installs the repository-pinned Bun and Rust versions
# xcodes          : installs and selects the repository-pinned Xcode
# xcodegen        : generates QuotaBar and TaskNotes Xcode projects
# swiftlint       : strict Swift lint and analyzer checks
# tailscale       : tailnet membership (enrolled manually, see README)
BUILDKITE_FORMULA="buildkite/buildkite/buildkite-agent@3"
BUILDKITE_SERVICE="buildkite-agent@3"
echo "==> Trusting the Buildkite Homebrew tap"
brew tap buildkite/buildkite
brew trust --formula "$BUILDKITE_FORMULA"

echo "==> Installing native CI packages"
brew install "$BUILDKITE_FORMULA" mise xcodes xcodegen swiftlint tailscale

AGENT_BUILD_PATH="$HOME/.buildkite-agent/builds"

echo "==> Installing the repository-pinned Bun and Rust toolchains"
mise install --cd "$REPO_ROOT" --yes bun rust
mise reshim

# Buildkite checks jobs out below the configured build path, not below this
# bootstrap checkout. Trust that path so mise can load the job checkout's
# repository-pinned tools when the native preflight runs through its shims.
echo "==> Trusting Buildkite checkout configs"
mise settings set trusted_config_paths "$AGENT_BUILD_PATH"

# --- 3. Agent configuration ------------------------------------------------
# Write the agent config with the macos-queue tag. chmod 600 — it holds the
# token. `git-clean-flags="-ffxdq"` forces a clean working tree on every build
# (macOS jobs run natively on a persistent host, so we scrub between builds).
# `shell` is pinned because the native steps source macos-native-env.sh, which
# needs bash; Kubernetes steps get the same guarantee from BUILDKITE_SHELL in
# their pod spec, and this queue has no pod spec to carry it.
CFG_DIR="$(brew --prefix)/etc/buildkite-agent"
CFG_FILE="$CFG_DIR/buildkite-agent.cfg"
mkdir -p "$CFG_DIR"
echo "==> Writing $CFG_FILE"
umask 077
cat >"$CFG_FILE" <<EOF
# Managed by packages/homelab/mac-ci/bootstrap.sh — do not hand-edit.
token="$BUILDKITE_AGENT_TOKEN"
name="%hostname-%spawn"
tags="queue=macos,os=darwin,arch=$(uname -m)"
tags-from-host=false
build-path="$AGENT_BUILD_PATH"
git-clean-flags="-ffxdq"
shell="/bin/bash -e -c"
EOF
chmod 600 "$CFG_FILE"
umask 022

# --- 4. Power management — never sleep -------------------------------------
# A CI agent that sleeps drops off Buildkite and hangs any job dispatched to it
# (this is why the Mini kept "falling asleep" and never held a stable agent). A
# Mac Mini is AC-powered with no battery, so force a permanent always-on
# profile. `-c` scopes this to the charger (AC Power) profile only — the same
# scope restore-power.sh captures and restores; `-a` would also stomp a
# separately-managed UPS Power profile if one is ever attached. Needs sudo
# (will prompt).
#   sleep 0         never idle-sleep the system
#   disksleep 0     never spin the disk down
#   displaysleep 10 allow the display to sleep without locking the session
#   powernap 0      no Power Nap wake/maintenance cycles
#   womp 1          wake on network access (magic packet)
#   autorestart 1   power back on automatically after a power loss
echo "==> Configuring power management (never sleep) — needs sudo"
if sudo test -e "$POWER_BACKUP_FILE" && ! sudo test -f "$POWER_BACKUP_FILE"; then
  echo "error: $POWER_BACKUP_FILE exists but is not a regular file" >&2
  echo "restore-power.sh reads it with 'test -f', so teardown could not restore" >&2
  echo "the pre-bootstrap profile. Remove or move it, then re-run." >&2
  exit 1
fi

if ! sudo test -f "$POWER_BACKUP_FILE"; then
  power_backup="$(mktemp)"
  pmset -g custom >"$power_backup"
  sudo install -m 600 "$power_backup" "$POWER_BACKUP_FILE"
  rm "$power_backup"
  echo "    Saved the previous profile to $POWER_BACKUP_FILE"
fi
sudo pmset -c sleep 0 disksleep 0 displaysleep 10 powernap 0 womp 1 autorestart 1
echo "    Full profile (verify sleep=0): pmset -g custom"

# --- 5. Start the agent as a login service ---------------------------------
# brew services installs a per-user LaunchAgent (runs on login). FileVault and
# auto-login are intentionally incompatible here: after a cold boot, a human
# unlocks the disk and logs in before the agent can reconnect. A LaunchAgent
# (user context) — not a LaunchDaemon — is required for keychain signing and
# the Accessibility-approved TaskNotes UI test runner.
echo "==> Starting buildkite-agent service"
brew services restart "$BUILDKITE_SERVICE"

echo
echo "==> Done. Agent service configured for the 'macos' queue."
echo "    Verify it's connected: https://buildkite.com/organizations/sjerred/agents"
echo
echo "    Remaining MANUAL steps (see README.md):"
echo "      1. Join the tailnet:  sudo tailscaled install-system-daemon && sudo tailscale up"
echo "      2. Install/select .xcode-version with xcodes, then remove its credentials"
echo "      3. Enable FileVault and escrow its recovery key in 1Password"
echo "      4. Provision one Apple Development identity and Accessibility trust"
