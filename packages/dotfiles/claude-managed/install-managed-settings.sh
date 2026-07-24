#!/usr/bin/env bash
#
# Install Claude Code managed-settings policy to the macOS system location.
#
# The Claude Code runtime rewrites churny keys (model, effortLevel, fast mode)
# back into ~/.claude/settings.json on every /model or /effort. The managed
# layer is the ONE config tier the runtime never writes, and its rules are
# authoritative (a managed `deny` cannot be overridden, even in
# bypassPermissions mode). So the durable, safety-critical config —
# permission rails + enabledPlugins — lives here instead of user settings.
#
# See README.md in this directory for the full architecture and bootstrap.
#
# Usage:  ./install-managed-settings.sh
# Needs:  sudo (writes under /Library/Application Support/), macOS, python3
#         (strict JSON validation).
# Effect: after install, restart Claude Code — managed settings are read at
#         launch. Verify with `/status`.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC="${SCRIPT_DIR}/managed-settings.json"
DEST_DIR="/Library/Application Support/ClaudeCode"
DEST="${DEST_DIR}/managed-settings.json"

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "error: this installer targets macOS; on Linux the managed path differs" >&2
  echo "       (see https://code.claude.com/docs/en/settings)" >&2
  exit 1
fi

if [[ ! -f "${SRC}" ]]; then
  echo "error: source policy not found: ${SRC}" >&2
  exit 1
fi

# Validate the JSON before writing it to an authoritative, un-overridable path,
# so a syntax error stops here instead of shipping a broken policy that could
# block every permission. Use python3's STRICT parser, not `plutil` — plutil is
# lenient (it accepts trailing commas) and would pass files Claude Code's strict
# JSON parser rejects.
echo "Validating ${SRC} ..."
python3 -c 'import json,sys; json.load(open(sys.argv[1]))' "${SRC}"

echo "Installing managed policy -> ${DEST}"
echo "(requires sudo: the destination is a system-wide directory)"
sudo mkdir -p "${DEST_DIR}"
sudo install -m 644 -o root -g wheel "${SRC}" "${DEST}"

echo
echo "Installed. Ownership/mode:"
ls -l "${DEST}"
echo
echo "Restart Claude Code to load it, then run /status to confirm the managed"
echo "source is active. To update the policy: edit managed-settings.json and"
echo "re-run this script. To remove it: sudo rm \"${DEST}\""
