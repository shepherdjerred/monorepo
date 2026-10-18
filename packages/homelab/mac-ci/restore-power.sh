#!/usr/bin/env bash
# Restore the exact AC (charger) power values saved by bootstrap.sh before it
# configured this Mac Mini as an always-on Woodpecker agent. Scoped to `-c`
# (charger profile only) to match bootstrap.sh's `-c` — never touches a
# separately-managed UPS Power profile, if one is attached.

set -euo pipefail

# Hosts provisioned before the rename saved the profile at the legacy path.
# Move it to the current path when only the legacy file exists, so a
# provisioned Mac keeps the only copy of its pre-bootstrap power profile.
LEGACY_POWER_BACKUP_FILE="${LEGACY_POWER_BACKUP_FILE:-/var/db/buildkite-mac-ci-pmset-before}"
POWER_BACKUP_FILE="${POWER_BACKUP_FILE:-/var/db/mac-ci-pmset-before}"

migrate_legacy_power_backup() {
  if ! sudo test -e "$LEGACY_POWER_BACKUP_FILE"; then
    return 0
  fi
  if sudo test -e "$POWER_BACKUP_FILE"; then
    echo "error: saved power profiles exist at both $LEGACY_POWER_BACKUP_FILE and $POWER_BACKUP_FILE" >&2
    echo "Keep the pre-bootstrap profile at $POWER_BACKUP_FILE, remove the other, then re-run." >&2
    exit 1
  fi
  sudo mv "$LEGACY_POWER_BACKUP_FILE" "$POWER_BACKUP_FILE"
  echo "    Moved the saved power profile to $POWER_BACKUP_FILE"
}
POWER_SETTINGS=(sleep disksleep displaysleep powernap womp autorestart)

migrate_legacy_power_backup
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

sudo pmset -c "${restore_args[@]}"
sudo rm "$POWER_BACKUP_FILE"
echo "==> Restored the saved pre-bootstrap power profile."
