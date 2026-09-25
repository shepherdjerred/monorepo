#!/usr/bin/env bash
#
# Provision a fresh macOS host (Mac Mini) as a Woodpecker CI agent running the
# local backend, which is how the native Swift/Xcode lanes reach real hardware.
#
# This is a THIN, idempotent, re-runnable bootstrap. The Mac is treated as a
# headless CI appliance, deliberately kept SEPARATE from the personal chezmoi
# dotfiles layer (packages/dotfiles/) — that layer is for workstations, not
# servers. Nothing here touches your personal shell, defaults, or apps.
#
# Usage:
#   WOODPECKER_SERVER="…" WOODPECKER_AGENT_SECRET="…" ./bootstrap.sh
#
# The agent secret is the same shared secret the in-cluster agents use, so no
# new credential is needed — read it from 1Password rather than typing it:
#   WOODPECKER_AGENT_SECRET="$(op read 'op://<vault>/<item>/<field>')" \
#     WOODPECKER_SERVER="woodpecker.sjer.red:443" ./bootstrap.sh
#
# WOODPECKER_SERVER is the gRPC endpoint, host:port with no scheme.
#
# Tailscale enrollment, FileVault, Xcode installation, signing, and the GUI
# privacy grants are documented manual steps in README.md. They require either
# interactive authentication or a deliberate security decision. This script
# does configure the accepted always-unlocked CI session after prompting for
# the local account password; otherwise signing and UI tests can deadlock
# behind the lock screen after an unattended display timeout.

set -euo pipefail

# Historical name — an already-provisioned Mac has the saved profile at this
# exact path and restore-power.sh reads it there. Renaming it for tidiness
# would strand the only copy of the pre-bootstrap power profile.
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

if [[ -z "${WOODPECKER_SERVER:-}" ]]; then
  echo "error: WOODPECKER_SERVER is not set (gRPC host:port, no scheme)." >&2
  exit 1
fi

if [[ -z "${WOODPECKER_AGENT_SECRET:-}" ]]; then
  echo "error: WOODPECKER_AGENT_SECRET is not set." >&2
  echo "Read the shared agent secret from 1Password and re-run:" >&2
  echo "  WOODPECKER_AGENT_SECRET=\"\$(op read 'op://<vault>/<item>/<field>')\" ./bootstrap.sh" >&2
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
# mise            : installs the repository-pinned Bun and Rust versions
# xcodes          : installs and selects the repository-pinned Xcode
# xcodegen        : generates QuotaBar and TaskNotes Xcode projects
# swiftlint       : strict Swift lint and analyzer checks
# coreutils       : gtimeout, which bounds every generated step (macOS has no
#                   timeout of its own)
# tailscale       : tailnet membership (enrolled manually, see README)
echo "==> Installing native CI packages"
brew install mise xcodes xcodegen swiftlint coreutils tailscale

# Woodpecker ships no Homebrew formula, so the agent is a released binary.
# Pinned by version rather than tracking latest: the agent and server speak a
# versioned gRPC protocol, and a silently-upgraded agent is how a working host
# stops claiming jobs.
WOODPECKER_AGENT_VERSION="3.18.1"
WOODPECKER_AGENT_BIN="$HOME/.local/bin/woodpecker-agent"
AGENT_BUILD_PATH="$HOME/.woodpecker/builds"

if [[ ! -x "$WOODPECKER_AGENT_BIN" ]]; then
  echo "==> Installing woodpecker-agent $WOODPECKER_AGENT_VERSION"
  mkdir -p "$(dirname "$WOODPECKER_AGENT_BIN")"
  ARCHIVE="$(mktemp -d)/agent.tar.gz"
  curl -fsSL -o "$ARCHIVE" \
    "https://github.com/woodpecker-ci/woodpecker/releases/download/v${WOODPECKER_AGENT_VERSION}/woodpecker-agent_darwin_arm64.tar.gz"
  tar -xzf "$ARCHIVE" -C "$(dirname "$WOODPECKER_AGENT_BIN")" woodpecker-agent
  chmod 755 "$WOODPECKER_AGENT_BIN"
fi

echo "==> Installing the repository-pinned Bun and Rust toolchains"
mise install --cd "$REPO_ROOT" --yes bun rust
mise reshim

# TaskNotes packages a universal macOS XCFramework. rustup installs only the
# host architecture's standard library with a new toolchain, so provision both
# slices against the repository-pinned Rust version.
echo "==> Installing TaskNotes Rust targets"
mise exec --cd "$REPO_ROOT" -- rustup target add \
  aarch64-apple-darwin \
  x86_64-apple-darwin

# Jobs are checked out below the configured build path, not below this
# bootstrap checkout. Trust that path so mise can load the job checkout's
# repository-pinned tools when the native preflight runs through its shims.
echo "==> Trusting CI checkout configs"
mise settings set trusted_config_paths "$AGENT_BUILD_PATH"

# --- 3. Agent configuration ------------------------------------------------
# The agent reads its configuration from the environment. chmod 600 — it holds
# the shared agent secret.
#
# WOODPECKER_BACKEND=local is the whole reason this host exists: Swift and
# Xcode cannot run in a Linux container, so these jobs run directly on the host
# as the logged-in user. There is no isolation here, which is why the generated
# macOS lanes carry no credentials and why fork pull requests must never reach
# this agent.
#
# The platform label is what the generated workflows select on; the Linux
# agents do not carry it.
CFG_FILE="$HOME/.woodpecker/agent.env"
mkdir -p "$(dirname "$CFG_FILE")"
echo "==> Writing $CFG_FILE"
umask 077
cat >"$CFG_FILE" <<EOF
# Managed by packages/homelab/mac-ci/bootstrap.sh — do not hand-edit.
WOODPECKER_SERVER=$WOODPECKER_SERVER
WOODPECKER_AGENT_SECRET=$WOODPECKER_AGENT_SECRET
WOODPECKER_BACKEND=local
WOODPECKER_AGENT_LABELS=platform=darwin/$(uname -m)
WOODPECKER_BACKEND_LOCAL_TEMP_DIR=$AGENT_BUILD_PATH
WOODPECKER_MAX_WORKFLOWS=1
EOF
chmod 600 "$CFG_FILE"
umask 022

# --- 4. Power management — never sleep -------------------------------------
# A CI agent that sleeps drops off the server and hangs any job dispatched to it
# (this is why the Mini kept "falling asleep" and never held a stable agent). A
# Mac Mini is AC-powered with no battery, so force a permanent always-on
# profile. `-c` scopes this to the charger (AC Power) profile only — the same
# scope restore-power.sh captures and restores; `-a` would also stomp a
# separately-managed UPS Power profile if one is ever attached. Needs sudo
# (will prompt).
#   sleep 0         never idle-sleep the system
#   disksleep 0     never spin the disk down
#   displaysleep 0  keep the GUI available for signing and UI automation
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
sudo pmset -c sleep 0 disksleep 0 displaysleep 0 powernap 0 womp 1 autorestart 1
echo "    Full profile (verify sleep=0): pmset -g custom"

# --- 5. Keep the CI login session available --------------------------------
# The native trust boundary already requires an unlocked GUI user. Disabling
# only system sleep is insufficient: macOS can still lock the display, lock the
# login keychain, and leave codesign waiting for a prompt that no unattended
# job can answer. Disable both idle screen saver activation and password lock.
# `sysadminctl` asks for the local account password without placing it in this
# script, an environment variable, or shell history.
echo "==> Configuring the always-unlocked CI login session"
defaults -currentHost write com.apple.screensaver idleTime -int 0
screen_lock_status="$(sysadminctl -screenLock status 2>&1)"
if [[ "$screen_lock_status" != *"screenLock is off"* ]]; then
  echo "    Enter the jerred account password when prompted."
  sysadminctl -screenLock off -password -
fi
screen_lock_status="$(sysadminctl -screenLock status 2>&1)"
if [[ "$screen_lock_status" != *"screenLock is off"* ]]; then
  echo "error: macOS screen lock is still enabled: $screen_lock_status" >&2
  exit 1
fi

# --- 6. Start the agent as a login service ---------------------------------
# A per-user LaunchAgent (runs on login) — NOT a LaunchDaemon. FileVault and
# auto-login are intentionally incompatible here: after a cold boot, a human
# unlocks the disk and logs in before the agent can reconnect. User context is
# required for keychain signing and the Accessibility-approved TaskNotes UI
# test runner; a daemon has neither.
#
# The secret reaches the agent through the chmod-600 env file rather than the
# plist, because a LaunchAgent plist is world-readable.
LAUNCH_AGENT_LABEL="red.sjer.woodpecker-agent"
LAUNCH_AGENT_PLIST="$HOME/Library/LaunchAgents/$LAUNCH_AGENT_LABEL.plist"
AGENT_LOG_DIR="$HOME/.woodpecker/logs"
mkdir -p "$(dirname "$LAUNCH_AGENT_PLIST")" "$AGENT_LOG_DIR" "$AGENT_BUILD_PATH"

echo "==> Writing $LAUNCH_AGENT_PLIST"
cat >"$LAUNCH_AGENT_PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LAUNCH_AGENT_LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>-lc</string>
    <string>set -a; . "$CFG_FILE"; set +a; exec "$WOODPECKER_AGENT_BIN"</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>WorkingDirectory</key><string>$AGENT_BUILD_PATH</string>
  <key>StandardOutPath</key><string>$AGENT_LOG_DIR/agent.log</string>
  <key>StandardErrorPath</key><string>$AGENT_LOG_DIR/agent.err.log</string>
</dict>
</plist>
EOF

echo "==> Starting $LAUNCH_AGENT_LABEL"
GUI_TARGET="gui/$(id -u)"
# Re-runnable: bootstrap fails outright on an already-loaded label, so unload
# first. Guarded by an explicit lookup rather than a swallowed exit code — a
# bootout that fails on a service that IS loaded must still stop the script.
if launchctl print "$GUI_TARGET/$LAUNCH_AGENT_LABEL" >/dev/null; then
  launchctl bootout "$GUI_TARGET/$LAUNCH_AGENT_LABEL"
fi
launchctl bootstrap "$GUI_TARGET" "$LAUNCH_AGENT_PLIST"
launchctl kickstart -k "$GUI_TARGET/$LAUNCH_AGENT_LABEL"

echo
echo "==> Done. Agent registered with $WOODPECKER_SERVER."
echo "    Verify it's connected: https://woodpecker.sjer.red/admin/agents"
echo "    Agent log: $AGENT_LOG_DIR/agent.log"
echo
echo "    Remaining MANUAL steps (see README.md):"
echo "      1. Join the tailnet:  sudo tailscaled install-system-daemon && sudo tailscale up"
echo "      2. Install/select .xcode-version with xcodes, then remove its credentials"
echo "      3. Enable FileVault and escrow its recovery key in 1Password"
echo "      4. Provision one Apple Development identity and Accessibility trust"
