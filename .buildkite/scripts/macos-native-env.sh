#!/usr/bin/env bash
set -euo pipefail

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  echo "error: source macos-native-env.sh so its environment reaches the native job" >&2
  exit 1
fi

# Native jobs run in a persistent login session, not the Linux Kubernetes pod.
# Keep the host's Homebrew and mise tools explicit, and keep every cache local
# to this user rather than inheriting in-cluster paths or credentials.
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
