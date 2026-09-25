#!/usr/bin/env bash
# Kubernetes steps get bash from their step image; on the Mac, Woodpecker's
# local backend runs the step's `image` as the shell, and the configuration
# extension emits `bash` for it. State that requirement here rather than
# inheriting it, so a shell regression fails with this message instead of an
# unbound BASH_SOURCE or an unknown `pipefail` option.
set -eu
if [ -z "${BASH_VERSION:-}" ]; then
  echo "error: macos-native-env.sh requires bash; the native lanes must run with image: bash" >&2
  exit 1
fi
set -o pipefail

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  echo "error: source macos-native-env.sh so its environment reaches the native job" >&2
  exit 1
fi

# Native jobs run in a persistent login session, not the Linux Kubernetes pod.
# Keep the host's Homebrew and mise tools explicit, and keep every cache local
# to this user rather than inheriting in-cluster paths or credentials. Never let
# a PR change install a tool onto the persistent agent while preflight is
# checking whether the operator provisioned the pinned version.
export MISE_AUTO_INSTALL=0
export MISE_NOT_FOUND_AUTO_INSTALL=0
export PATH="/opt/homebrew/bin:/opt/homebrew/sbin:$HOME/.local/share/mise/shims:$PATH"
export BUN_INSTALL_CACHE_DIR="$HOME/Library/Caches/Bun/install/cache"
export BUN_INSTALL_LOCK_MODE="local"
unset BUN_CACHE_LOCK_FILE
unset TURBO_CACHE
unset TURBO_API
unset TURBO_SCM_BASE
unset TURBO_TEAM
unset TURBO_TELEMETRY_DISABLED
unset TURBO_TOKEN
