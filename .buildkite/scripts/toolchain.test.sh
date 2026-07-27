#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
TOOLCHAIN="${SCRIPT_DIR}/toolchain.sh"
CI_IMAGE="${SCRIPT_DIR}/../ci-image/Dockerfile"
CI_PLAYWRIGHT_IMAGE="${SCRIPT_DIR}/../ci-playwright/Dockerfile"

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

if ! rg -Fq 'ln -sf "$(mise which gh)" /usr/local/bin/gh' "$CI_IMAGE" ||
  ! rg -Fq '&& gh --version' "$CI_IMAGE"; then
  echo "ci image must expose the mise-owned gh binary to login shells" >&2
  exit 1
fi

if ! awk '
  $0 == "RUN rm -f /etc/apt/sources.list.d/nodesource.list /etc/apt/sources.list.d/nodesource.sources \\" { remove_line = NR }
  $0 == "  && apt-get update \\" { update_line = NR }
  END { exit !(remove_line > 0 && update_line == remove_line + 1) }
' "$CI_PLAYWRIGHT_IMAGE"; then
  echo "Playwright CI image must remove the stale NodeSource APT source before updating package indexes" >&2
  exit 1
fi

if ! rg -Fq 'ARG MISE_MINISIGN_PUBLIC_KEY=' "$CI_IMAGE" ||
  ! rg -Fq 'minisign -V -P "${MISE_MINISIGN_PUBLIC_KEY}"' "$CI_IMAGE" ||
  ! rg -Fq 'checksum_line="$(grep -F "  ./${mise_asset}" SHASUMS256.txt)"' "$CI_IMAGE" ||
  rg -q '^ARG MISE_(AMD64|ARM64)_SHA256=' "$CI_IMAGE"; then
  echo "ci image must derive mise asset checksums from the signed release manifest" >&2
  exit 1
fi

echo "toolchain login-shell test passed"
