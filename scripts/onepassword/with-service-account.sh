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
    # A process outside the login session (for example one left behind by an
    # SSH login that has ended) resolves only the System keychain, so an
    # enrolled token looks missing. Say so instead of prompting re-enrollment.
    if search_list="$(security list-keychains)" && [[ "$search_list" != *login.keychain* ]]; then
      echo "This process cannot see the login Keychain (launchd session: $(launchctl managername)), so the enrolled token looks missing; do not re-enroll." >&2
      echo "Run the command from a process in the GUI login session. A process started by an SSH login that has since ended, such as an SSH-started herdr holder, stays this way until it is replaced." >&2
      exit 1
    fi
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
