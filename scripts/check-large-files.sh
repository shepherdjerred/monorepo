#!/usr/bin/env bash
set -euo pipefail

# Two size gates, ported from the old CI large-file-check:
# 1. scout-for-lol asset budget (its own script + thresholds)
# 2. no tracked file > 5 MB, honoring .largeignore (one find-style relative
#    path pattern per line, # comments allowed). Only git-tracked files are
#    checked — local build output (target/, dist/, caches) never ships, and
#    the old CI's source mount excluded it the same way.

assetExitCode=0
bun packages/scout-for-lol/scripts/check-asset-sizes.ts || assetExitCode=$?

max=5242880
large=""
while IFS= read -r -d '' f; do
  if [ -f .largeignore ]; then
    skip=0
    while IFS= read -r pattern; do
      case "$pattern" in "" | "#"*) continue ;; esac
      # .largeignore entries are find-style globs relative to the repo root
      # shellcheck disable=SC2254
      case "$f" in $pattern) skip=1 && break ;; esac
    done <.largeignore
    [ "$skip" -eq 1 ] && continue
  fi
  case "$f" in */archive/*) continue ;; esac
  # Skip symlinks (their content is the link target path) and anything that
  # isn't a plain file on disk (e.g. a tracked symlink resolving to a dir).
  [ -f "$f" ] && [ ! -L "$f" ] || continue
  size=$(wc -c <"$f")
  if [ "$size" -gt "$max" ]; then
    large="$large  $f ($((size / 1048576))MB)"$'\n'
  fi
done < <(git ls-files -z)

if [ -n "$large" ]; then
  echo "Tracked files exceed 5MB limit:"
  printf '%s' "$large"
  exit 1
fi

exit "$assetExitCode"
