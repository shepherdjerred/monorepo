#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/setup-tools.sh"

install_bun

echo "+++ :scissors: Knip check"
while IFS= read -r -d '' lockfile; do
  dir="$(dirname "$lockfile")"
  (cd "$dir" && bun install --frozen-lockfile)
done < <(find packages/ -name bun.lock -not -path "*/node_modules/*" -not -path "*/example/*" -print0)
bunx knip --no-config-hints
