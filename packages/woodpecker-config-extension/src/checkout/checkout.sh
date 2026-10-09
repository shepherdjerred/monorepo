#!/usr/bin/env bash
set -euo pipefail

cache=$1
control=$2
commit=$3
if [[ ! "$commit" =~ ^[a-f0-9]{40}$ ]]; then
  echo 'Source cache requires an exact Git commit SHA' >&2
  exit 1
fi
repository_key=$(printf '%s' 'https://github.com/shepherdjerred/monorepo.git' | sha256sum | cut -d ' ' -f 1)
snapshot="$cache/v1/$repository_key/$commit"
helper=/app/packages/woodpecker-config-extension/src/checkout/main.ts

# The emitter holds the shared GC lock for this entire script. Ready snapshots
# are immutable, so warm readers can copy and verify their objects concurrently.
if [[ -d "$snapshot" ]]; then
  exec bun "$helper" "$cache" "$commit"
fi

exec 9>"$control/$commit.lock"
flock --exclusive 9
# Another miss may have published while we waited. Release the writer lock
# before reading it; retain the shared GC lock inherited from our parent.
if [[ -d "$snapshot" ]]; then
  flock --unlock 9
fi
exec bun "$helper" "$cache" "$commit"
