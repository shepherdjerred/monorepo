#!/usr/bin/env bash
# Run a package's npm script in the actual source tree.
# Usage: run_npm_script.sh <script_name>
#
# Environment:
#   MONOREPO_PACKAGE - the package path (e.g., packages/birmel)
set -euo pipefail

SCRIPT_NAME="${1:?Usage: run_npm_script.sh <script_name>}"
PACKAGE="${MONOREPO_PACKAGE:?MONOREPO_PACKAGE not set}"

# Find the repo root. In Bazel's execroot, .git is a symlink to the real repo's
# .git directory, so we resolve it to find the actual source tree.
_git_dir="$(git rev-parse --show-toplevel)/.git"
if [ -L "${_git_dir}" ]; then
  # Bazel execroot: .git is a symlink — resolve to find the real repo
  REPO_ROOT="$(dirname "$(readlink "${_git_dir}")")"
else
  REPO_ROOT="$(git rev-parse --show-toplevel)"
fi
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

# Ensure dependencies are installed (critical for CI where node_modules don't exist).
# Uses a marker file to signal completion since node_modules/ appears before install finishes.
INSTALL_DONE="${REPO_ROOT}/.bun-install-done"
if [ ! -f "${INSTALL_DONE}" ]; then
  LOCKDIR="${REPO_ROOT}/.bun-install.lock"
  # Use mkdir as a portable atomic lock (works on macOS and Linux)
  if mkdir "${LOCKDIR}" 2>/dev/null; then
    trap 'rmdir "${LOCKDIR}" 2>/dev/null' EXIT
    echo "Installing dependencies with bun install..." >&2
    (cd "${REPO_ROOT}" && "${BUN}" install --frozen-lockfile) >&2
    touch "${INSTALL_DONE}"
    rmdir "${LOCKDIR}" 2>/dev/null
    trap - EXIT
  else
    # Another process is installing; wait for it to finish
    while [ ! -f "${INSTALL_DONE}" ] && [ -d "${LOCKDIR}" ]; do
      sleep 1
    done
  fi
fi

# Build a workspace package if its output directory doesn't exist.
# Uses mkdir-based locking to avoid duplicate builds from parallel Bazel tests.
# Usage: build_if_missing <marker_dir> <package_dir> <build_command...>
build_if_missing() {
  local marker_dir="$1"
  local pkg_dir="$2"
  shift 2
  local lock_name
  lock_name="$(echo "${pkg_dir}" | tr '/' '-')"

  if [ ! -d "${marker_dir}" ]; then
    local lockdir="${REPO_ROOT}/.build-${lock_name}.lock"
    if mkdir "${lockdir}" 2>/dev/null; then
      trap 'rmdir "${lockdir}" 2>/dev/null' EXIT
      echo "Building ${pkg_dir}..." >&2
      (cd "${REPO_ROOT}/${pkg_dir}" && "$@") >&2
      rmdir "${lockdir}" 2>/dev/null
      trap - EXIT
    else
      while [ ! -d "${marker_dir}" ] && [ -d "${lockdir}" ]; do
        sleep 1
      done
    fi
  fi
}

# Build workspace packages that other packages depend on (import from dist/).
# eslint-config must be built first since all packages use it for linting.
build_if_missing "${REPO_ROOT}/packages/eslint-config/dist" \
  "packages/eslint-config" "${BUN}" run build

build_if_missing "${REPO_ROOT}/packages/webring/dist" \
  "packages/webring" "${BUN}" run build

build_if_missing "${REPO_ROOT}/packages/discord-plays-pokemon/packages/common/dist" \
  "packages/discord-plays-pokemon/packages/common" "${BUN}" run build

# Generate Prisma client for scout-for-lol (typecheck/test need it).
# Uses the full generate script: prisma generate + brand-types + test-template-db.
build_if_missing "${REPO_ROOT}/packages/scout-for-lol/packages/backend/generated" \
  "packages/scout-for-lol/packages/backend" "${BUN}" run generate

cd "${SOURCE_DIR}"
exec "${BUN}" run "${SCRIPT_NAME}"
