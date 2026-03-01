#!/usr/bin/env bash
# Run a package's npm script in the actual source tree.
# Usage: run_npm_script.sh <script_name>
#
# Environment:
#   MONOREPO_PACKAGE - the package path (e.g., packages/birmel)
set -euo pipefail

SCRIPT_NAME="${1:?Usage: run_npm_script.sh <script_name>}"
PACKAGE="${MONOREPO_PACKAGE:?MONOREPO_PACKAGE not set}"

# Find the repo root
REPO_ROOT="$(git rev-parse --show-toplevel)"
SOURCE_DIR="${REPO_ROOT}/${PACKAGE}"

if [ ! -f "${SOURCE_DIR}/package.json" ]; then
  echo "ERROR: package.json not found at ${SOURCE_DIR}" >&2
  exit 1
fi

# Check if the script exists and is not a stub
# Use grep/sed instead of node to avoid PATH issues
SCRIPT_VALUE=$(grep -o "\"${SCRIPT_NAME}\"[[:space:]]*:[[:space:]]*\"[^\"]*\"" "${SOURCE_DIR}/package.json" | sed 's/.*: *"//;s/"$//' || echo "")
if [ -z "${SCRIPT_VALUE}" ] || [ "${SCRIPT_VALUE}" = "true" ]; then
  exit 0
fi

# Find bun
BUN=""
if [ -x "${HOME}/.local/share/mise/installs/bun/latest/bin/bun" ]; then
  BUN="${HOME}/.local/share/mise/installs/bun/latest/bin/bun"
elif command -v bun &>/dev/null; then
  BUN="$(command -v bun)"
elif [ -x "/opt/homebrew/bin/bun" ]; then
  BUN="/opt/homebrew/bin/bun"
elif [ -x "${HOME}/.bun/bin/bun" ]; then
  BUN="${HOME}/.bun/bin/bun"
else
  echo "ERROR: bun not found" >&2
  exit 1
fi

# Ensure PATH has the essentials for child processes
export PATH="${HOME}/.local/share/mise/shims:${HOME}/.local/share/mise/installs/bun/latest/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:${PATH:-}"

# Trust all mise configs in the monorepo to avoid interactive prompts
export MISE_TRUSTED_CONFIG_PATHS="${REPO_ROOT}"

cd "${SOURCE_DIR}"
exec "${BUN}" run "${SCRIPT_NAME}"
