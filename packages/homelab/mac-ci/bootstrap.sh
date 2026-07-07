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
# Tailscale enrollment and headless auto-login are documented manual steps in
# README.md (they need interactive auth / a GUI toggle and aren't scripted).

set -euo pipefail

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "error: this provisions a macOS host, but uname -s is $(uname -s)" >&2
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
# swiftlint       : first native macOS job (tasks-for-obsidian/ios)
# tailscale       : tailnet membership (CLI daemon — enrolled manually, see README)
echo "==> Installing packages (buildkite-agent, swiftlint, tailscale)"
brew install buildkite/buildkite/buildkite-agent swiftlint tailscale

# --- 3. Agent configuration ------------------------------------------------
# Write the agent config with the macos-queue tag. chmod 600 — it holds the
# token. `git-clean-flags="-ffxdq"` forces a clean working tree on every build
# (macOS jobs run natively on a persistent host, so we scrub between builds).
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
build-path="$HOME/.buildkite-agent/builds"
git-clean-flags="-ffxdq"
EOF
chmod 600 "$CFG_FILE"
umask 022

# --- 4. Start the agent as a login service ---------------------------------
# brew services installs a per-user LaunchAgent (runs on login). For a headless
# box, enable auto-login (README) so the agent comes up after a reboot. A
# LaunchAgent (user context) — not a LaunchDaemon — is chosen so keychain/Xcode
# codesigning works if this host later does real Xcode builds.
echo "==> Starting buildkite-agent service"
brew services restart buildkite/buildkite/buildkite-agent

echo
echo "==> Done. Agent registered on the 'macos' queue."
echo "    Verify it's connected: https://buildkite.com/organizations/sjerred/agents"
echo
echo "    Remaining MANUAL steps (see README.md):"
echo "      1. Join the tailnet:  sudo tailscaled install-system-daemon && sudo tailscale up"
echo "      2. Enable auto-login  (System Settings > Users & Groups) for headless reboots"
echo "      3. Flip MACOS_CI_ENABLED=true in the pipeline-upload env to activate the SwiftLint step"
