#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
TOOLCHAIN="${SCRIPT_DIR}/toolchain.sh"

if ! awk '
  $0 == "mise install --yes" { install_line = NR }
  $0 == "mise reshim" { reshim_line = NR }
  END {
    if (install_line == 0 || reshim_line <= install_line) {
      exit 1
    }
  }
' "$TOOLCHAIN"; then
  echo "toolchain must rebuild shims after the runtime install" >&2
  exit 1
fi

echo "toolchain shim test passed"
