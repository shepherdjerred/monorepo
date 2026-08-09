#!/usr/bin/env bash
# Fail if any `clippy.toml` ban is inert.
#
# Clippy reports an unresolvable `disallowed-methods` / `disallowed-types` path
# as a *configuration* warning, not a lint. Configuration warnings are emitted
# before lint processing and are NOT escalated by `-D warnings`, so a ban that
# silently resolves to nothing is indistinguishable from an enforced one — the
# build stays green while the gate does nothing.
#
# That is precisely the failure this repo's determinism story cannot tolerate:
# `disallowed-methods` is the only mechanical guard against ambient clocks and
# ambient randomness leaking into the core. A gate you cannot see failing is
# not a gate.
#
# Real instance this was written for: `proptest` pulled `rand 0.9` into the dev
# graph, at which point the existing `rand::thread_rng` ban (removed in 0.9) and
# `rand::rng` ban (ambiguous — resolves to a module, not the function) both went
# inert while clippy stayed green.

set -euo pipefail

cd "$(dirname "$0")/.."

output=$(cargo clippy --workspace --all-targets --all-features --message-format short 2>&1)

# Match clippy's configuration-warning vocabulary for unresolvable paths.
if problems=$(printf '%s\n' "$output" | grep -E \
  'does not refer to a reachable (function|type)|expected a (function|type), found a|no item found|unknown field'); then
  echo "check-clippy-config: one or more clippy.toml entries are INERT." >&2
  echo >&2
  printf '%s\n' "$problems" >&2
  echo >&2
  echo "Fix the path so the ban actually resolves, or delete it." >&2
  echo "A ban that resolves to nothing passes CI while enforcing nothing." >&2
  exit 1
fi

echo "check-clippy-config: all clippy.toml bans resolve"
