#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/setup-tools.sh"

install_bun

echo "+++ :scissors: Knip check"
for dir in $(find packages/ -name bun.lock -not -path "*/node_modules/*" -not -path "*/example/*" | xargs -I{} dirname {}); do
  (cd "$dir" && bun install --frozen-lockfile)
done
bunx knip --no-config-hints
