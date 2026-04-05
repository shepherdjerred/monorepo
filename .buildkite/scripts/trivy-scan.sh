#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/setup-tools.sh"

install_trivy

echo "+++ :shield: Trivy scan"
trivy fs --exit-code 1 --severity HIGH,CRITICAL --ignorefile .trivyignore --skip-dirs archive .
