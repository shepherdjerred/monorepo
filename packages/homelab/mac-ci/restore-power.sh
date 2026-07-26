#!/usr/bin/env bash
# Restore the exact AC power values saved by bootstrap.sh before it configured
# this Mac Mini as an always-on Buildkite agent.

set -euo pipefail

POWER_BACKUP_FILE="/var/db/buildkite-mac-ci-pmset-before"
POWER_SETTINGS=(sleep disksleep displaysleep powernap womp autorestart)

if ! sudo test -f "$POWER_BACKUP_FILE"; then
  echo "error: no pre-bootstrap power profile exists at $POWER_BACKUP_FILE" >&2
  exit 1
fi

restore_args=()
for setting in "${POWER_SETTINGS[@]}"; do
  value="$(
    sudo awk -v setting="$setting" '
      /^AC Power:/ { in_ac_profile = 1; next }
      /^[^[:space:]].* Power:$/ { in_ac_profile = 0 }
      in_ac_profile && $1 == setting { print $2; exit }
    ' "$POWER_BACKUP_FILE"
  )"

  if [[ ! "$value" =~ ^[0-9]+$ ]]; then
    echo "error: saved AC profile is missing numeric value for $setting" >&2
    exit 1
  fi

  restore_args+=("$setting" "$value")
done

sudo pmset -a "${restore_args[@]}"
sudo rm "$POWER_BACKUP_FILE"
echo "==> Restored the saved pre-bootstrap power profile."
