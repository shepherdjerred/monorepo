#!/usr/bin/env bash
set -euo pipefail

CACHE_LOCK_FILE=${BUN_CACHE_LOCK_FILE:?BUN_CACHE_LOCK_FILE must point to the shared Bun cache lock}

# Bun has no bounded cache GC. Every install takes a shared lock so the
# maintenance job can take the exclusive lock before clearing cached packages.
(
  flock --shared 9
  bun install "$@"
) 9>"$CACHE_LOCK_FILE"
