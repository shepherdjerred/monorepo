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

# Record the command in toolkit's credential read log (never a value) so
# wrapper use shows up when attributing the shared 1Password daily budget.
log_wrapper_use() {
  local directory="$HOME/.toolkit/logs" command="${1##*/}" subcommand="${2:-}"
  [[ "$command" =~ ^[A-Za-z0-9._-]+$ ]] || command="?"
  [[ "$subcommand" =~ ^[a-z][a-z0-9-]*$ ]] || subcommand=""
  # Same daily file and 14-day retention as toolkit's fileReadLog. The log is
  # diagnostics: report a failure to write it, but run the command.
  local file
  file="$directory/credential-reads-$(date -u +%Y-%m-%d).jsonl"
  if ! { mkdir -p "$directory" &&
    printf '{"ts":"%s","host":"%s","runtime":"wrapper","command":"%s","ppid":%d,"name":"OP_SERVICE_ACCOUNT_TOKEN","backend":"wrapper","outcome":"ok"}\n' \
      "$(date -u +%Y-%m-%dT%H:%M:%S.000Z)" "$(hostname)" "$command${subcommand:+ $subcommand}" "$PPID" \
      >>"$file" &&
    find "$directory" -maxdepth 1 -name 'credential-reads-*.jsonl' -mtime +14 -delete; }; then
    echo "with-service-account.sh: could not write $file" >&2
  fi
}
log_wrapper_use "$@"

exec "$@"
