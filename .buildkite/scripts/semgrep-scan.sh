#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/setup-tools.sh"

install_base
install_semgrep

echo "+++ :mag: Semgrep scan"
semgrep scan --config auto .
