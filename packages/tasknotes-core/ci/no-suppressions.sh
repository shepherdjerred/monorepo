#!/usr/bin/env bash
#
# Enforces the two halves of "no suppressions" that cargo cannot enforce alone.
#
#   1. `#[allow(...)]` / `#![allow(...)]` anywhere in the workspace. The lint
#      config denies `clippy::allow_attributes`, which normally catches this —
#      but only in a crate that actually inherits the workspace lints, which is
#      precisely what check 2 exists to guarantee. Together they close the loop;
#      either alone has a hole. `#[expect(..., reason = "...")]` remains the one
#      legal escape hatch, and `unfulfilled_lint_expectations = "deny"` makes it
#      expire on its own.
#
#   2. Every workspace member declares `[lints] workspace = true`. A member that
#      omits it silently opts out of *every* gate in this repository — pedantic,
#      unwrap_used, as_conversions, the lot — with no diagnostic anywhere.
#
# The member list is read out of the workspace manifest rather than hardcoded,
# so a member added in a later phase cannot quietly escape the check.

set -euo pipefail

script_directory="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
workspace_root="$(dirname -- "${script_directory}")"
cd "${workspace_root}"

status=0

# ── 1. No `#[allow(...)]` ───────────────────────────────────────────────────
# grep exits 1 for "no matches" and >1 for a real failure, so the two are
# distinguished explicitly instead of being collapsed by a blanket fallback.
set +e
allow_matches="$(
  grep -rn --include='*.rs' --exclude-dir=target \
    -e '#\[allow(' \
    -e '#!\[allow(' \
    -- .
)"
grep_status=$?
set -e

if [[ "${grep_status}" -gt 1 ]]; then
  echo "no-suppressions: grep failed with status ${grep_status}" >&2
  exit 1
fi

if [[ -n "${allow_matches}" ]]; then
  echo "no-suppressions: #[allow(...)] is banned in this workspace." >&2
  echo "  Use #[expect(<lint>, reason = \"<why>\")] instead: it carries a" >&2
  echo "  justification and fails the build once it stops being necessary." >&2
  echo "${allow_matches}" >&2
  status=1
fi

# ── 2. Every member inherits the workspace lints ────────────────────────────
members="$(
  awk '
    /^\[/ { in_workspace = ($0 == "[workspace]") }
    in_workspace && /^members[[:space:]]*=/ { collecting = 1 }
    collecting {
      remainder = $0
      while (match(remainder, /"[^"]+"/)) {
        print substr(remainder, RSTART + 1, RLENGTH - 2)
        remainder = substr(remainder, RSTART + RLENGTH)
      }
      if (index($0, "]") > 0) { collecting = 0 }
    }
  ' Cargo.toml
)"

if [[ -z "${members}" ]]; then
  echo "no-suppressions: could not read [workspace] members from Cargo.toml" >&2
  exit 1
fi

while IFS= read -r member; do
  manifest="${member}/Cargo.toml"
  if [[ ! -f "${manifest}" ]]; then
    echo "no-suppressions: workspace member ${member} has no Cargo.toml" >&2
    status=1
    continue
  fi
  if ! awk '
    /^\[/ { in_lints = ($0 == "[lints]") }
    in_lints && /^workspace[[:space:]]*=[[:space:]]*true[[:space:]]*$/ { found = 1 }
    END { exit(found ? 0 : 1) }
  ' "${manifest}"; then
    echo "no-suppressions: ${manifest} is missing:" >&2
    echo "" >&2
    echo "    [lints]" >&2
    echo "    workspace = true" >&2
    echo "" >&2
    echo "  Without it the crate opts out of every workspace lint silently." >&2
    status=1
  fi
done <<<"${members}"

if [[ "${status}" -eq 0 ]]; then
  echo "no-suppressions: clean"
fi

exit "${status}"
