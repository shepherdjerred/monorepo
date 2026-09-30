#!/usr/bin/env bash
set -euo pipefail

# Transitional: the version-pinned config extension still generates
# `--filter '@shepherdjerred/macos-cross-site'` until it rebuilds and
# redeploys from main. Retarget the retired filter at the renamed workspace
# so stale loops install a buildable closure (the stale filter alone matches
# nothing, which would starve the aliased deploy entry's build). Remove with
# the deploy-site `macos-cross-site` alias once the extension is reconciled.
if (($# > 0)); then
  for arg in "$@"; do
    case "$arg" in
    "@shepherdjerred/macos-cross-site")
      set -- "$@" --filter '@shepherdjerred/cross-compilers-site'
      ;;
    esac
  done
fi

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
