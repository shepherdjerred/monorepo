#!/usr/bin/env bash
# prettier --check over staged files, skipping paths that no longer exist.
# lefthook's {staged_files} includes staged DELETIONS, and prettier hard-errors
# on missing files ("No files matching the pattern were found"), which blocked
# any commit that deletes a prettier-matched file.
set -euo pipefail

existing=()
for f in "$@"; do
  if [ -f "$f" ]; then
    existing+=("$f")
  fi
done

if [ "${#existing[@]}" -eq 0 ]; then
  echo "prettier-staged: no existing staged files to check"
  exit 0
fi

exec bunx prettier --check "${existing[@]}"
