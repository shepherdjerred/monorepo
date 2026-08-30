#!/usr/bin/env bash
set -euo pipefail

LOCK_MODE=${BUN_INSTALL_LOCK_MODE:?BUN_INSTALL_LOCK_MODE must be shared or local}

case "$LOCK_MODE" in
  shared)
    CACHE_LOCK_FILE=${BUN_CACHE_LOCK_FILE:?BUN_CACHE_LOCK_FILE must point to the shared Bun cache lock}
    # Bun has no bounded cache GC. Every in-cluster install takes a shared lock
    # so maintenance can take the exclusive lock before clearing the cache.
    (
      flock --shared 9
      bun install "$@"
    ) 9>"$CACHE_LOCK_FILE"
    ;;
  local)
    if [[ -n "${BUN_CACHE_LOCK_FILE:-}" ]]; then
      echo "error: local Bun installs must not inherit BUN_CACHE_LOCK_FILE" >&2
      exit 1
    fi
    bun install "$@"
    ;;
  *)
    echo "error: BUN_INSTALL_LOCK_MODE must be shared or local, got $LOCK_MODE" >&2
    exit 1
    ;;
esac
