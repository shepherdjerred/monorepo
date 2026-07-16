#!/usr/bin/env bash
set -euo pipefail

# Scan tracked source files for unresolved merge-conflict markers, honoring
# .conflictignore (one git pathspec-style path per line, # comments allowed).
# The marker patterns are built by concatenation so this script never contains
# a literal marker and cannot flag itself.

open_marker="<<<<<<<"
close_marker=">>>>>>>"

pathspecs=()
if [ -f .conflictignore ]; then
  while IFS= read -r line; do
    case "$line" in "" | "#"*) continue ;; esac
    pathspecs+=(":(exclude)$line")
  done <.conflictignore
fi

set +e
files=$(git grep -l -e "$open_marker " -e "$close_marker " -- \
  '*.ts' '*.tsx' '*.rs' '*.json' '*.yaml' '*.yml' '*.md' '*.sh' '*.astro' '*.toml' \
  "${pathspecs[@]}")
status=$?
set -e

# git grep exits 1 when nothing matched — that's the success case here.
if [ "$status" -gt 1 ]; then
  echo "git grep failed (exit $status)"
  exit "$status"
fi

if [ -n "$files" ]; then
  echo "Merge conflict markers found:"
  echo "$files"
  exit 1
fi
