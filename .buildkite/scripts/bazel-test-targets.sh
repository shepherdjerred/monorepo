#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/setup-tools.sh"

install_base
install_bazel
install_uv
install_shellcheck

# Usage: bazel-test-targets.sh <target1> <target2> ...
# Runs bazel test on the specified targets directly.
if [ $# -eq 0 ]; then
  echo "Usage: bazel-test-targets.sh <target1> [target2] ..." >&2
  exit 1
fi

echo "+++ :bazel: Testing targets: $*"
cd scripts/ci && PYTHONPATH=src uv run python -c "
from ci.lib import bazel
bazel.test($( printf "'%s', " "$@" ))
"
