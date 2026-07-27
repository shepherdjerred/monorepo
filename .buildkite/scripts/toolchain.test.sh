#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
TOOLCHAIN="${SCRIPT_DIR}/toolchain.sh"

if ! awk '
  $0 == "mise install --yes" { install_line = NR }
  $0 == "mise reshim" { reshim_line = NR }
  $0 == "GH_EXECUTABLE=$(mise which gh)" { gh_lookup_line = NR }
  $0 == "ln -sf \"$GH_EXECUTABLE\" /usr/local/bin/gh" { gh_link_line = NR }
  END {
    valid = install_line > 0
    valid = valid && reshim_line > install_line
    valid = valid && gh_lookup_line > reshim_line
    valid = valid && gh_link_line > gh_lookup_line
    if (!valid) {
      exit 1
    }
  }
' "$TOOLCHAIN"; then
  echo "toolchain must expose the installed gh binary to login shells" >&2
  exit 1
fi

echo "toolchain login-shell test passed"
