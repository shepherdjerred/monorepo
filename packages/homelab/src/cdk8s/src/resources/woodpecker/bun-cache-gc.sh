#!/usr/bin/env bash
set -euo pipefail

CACHE_DIR=${BUN_INSTALL_CACHE_DIR:?BUN_INSTALL_CACHE_DIR must point to the Bun cache data directory}
CACHE_LOCK_FILE=${BUN_CACHE_LOCK_FILE:?BUN_CACHE_LOCK_FILE must point to the shared Bun cache lock}
GC_THRESHOLD_PERCENT=${BUN_CACHE_GC_THRESHOLD_PERCENT:?BUN_CACHE_GC_THRESHOLD_PERCENT must be configured}

case "$GC_THRESHOLD_PERCENT" in
  "" | *[!0-9]*)
    echo "BUN_CACHE_GC_THRESHOLD_PERCENT must be an integer from 1 through 99" >&2
    exit 1
    ;;
esac
if ((GC_THRESHOLD_PERCENT < 1 || GC_THRESHOLD_PERCENT > 99)); then
  echo "BUN_CACHE_GC_THRESHOLD_PERCENT must be an integer from 1 through 99" >&2
  exit 1
fi

mkdir -p "$CACHE_DIR"

(
  flock --exclusive 9

  usage_percent=$(df -P "$CACHE_DIR" | awk 'NR == 2 { sub(/%$/, "", $5); print $5 }')
  case "$usage_percent" in
    "" | *[!0-9]*)
      echo "Could not determine Bun cache volume utilization" >&2
      exit 1
      ;;
  esac

  if ((usage_percent < GC_THRESHOLD_PERCENT)); then
    echo "Bun cache is ${usage_percent}% full; collection threshold is ${GC_THRESHOLD_PERCENT}%"
    exit 0
  fi

  echo "Bun cache is ${usage_percent}% full; clearing it under the exclusive cache lock"
  find "$CACHE_DIR" -mindepth 1 -depth -delete
) 9>"$CACHE_LOCK_FILE"
