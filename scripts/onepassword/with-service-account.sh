#!/usr/bin/env bash
set -euo pipefail

if (( $# == 0 )); then
  echo "Usage: scripts/onepassword/with-service-account.sh <command> [args...]" >&2
  exit 2
fi

if [[ -z "${OP_SERVICE_ACCOUNT_TOKEN:-}" ]]; then
  if [[ "$(uname -s)" != "Darwin" ]]; then
    echo "OP_SERVICE_ACCOUNT_TOKEN is required outside macOS." >&2
    exit 1
  fi

  if ! service_token="$(security find-generic-password \
    -a "$(id -un)" \
    -s monorepo-homelab-1password-service-account \
    -w)"; then
    echo "No homelab 1Password service account token is available in Keychain." >&2
    exit 1
  fi
  if (( ${#service_token} <= 128 )); then
    echo "The Keychain token is incomplete; run the Swift enrollment helper." >&2
    exit 1
  fi
  export OP_SERVICE_ACCOUNT_TOKEN="$service_token"
  unset service_token
fi

exec "$@"
