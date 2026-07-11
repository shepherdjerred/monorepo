#!/bin/bash
# Sets a per-torrent qBittorrent seeding-time limit computed from PrivateHD's
# Hit & Run formula (required seed time is a function of torrent size), so a
# torrent never stops seeding before it's tracker-compliant. qBittorrent's
# global GlobalMaxSeedingMinutes is a flat cap and under-shoots the formula
# for anything above ~50GB (a common size for this setup's UHD REMUX grabs).
#
# Usage:
#   hitandrun-share-limit.sh <hash>   Invoked by qBittorrent's AutoRun\OnTorrentAdded
#                                     hook with the new torrent's info hash (%I).
#   hitandrun-share-limit.sh --all    Backfill every currently-active torrent
#                                     (for torrents added before this hook existed).
#
# Formula (hours, x = size in GB):
#   x <= 1        : 72
#   1 < x < 50    : 72 + 2*x
#   x >= 50       : 100*ln(x) - 219.2023
set -euo pipefail

QBT_URL="http://localhost:8080"
LOG_PREFIX="hitandrun-share-limit"

log() { echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) [$LOG_PREFIX] $*"; }
err() { echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) [$LOG_PREFIX] ERROR: $*" >&2; }

# qBittorrent's WebAPI returns 200 for some endpoints (setShareLimits) and 204
# for others (auth/login) on success -- treat any 2xx as success.
is_success_status() {
  case "$1" in
  2??) return 0 ;;
  *) return 1 ;;
  esac
}

login() {
  local status
  status=$(curl -s -o /dev/null -w '%{http_code}' -c "$cookie_jar" \
    --data-urlencode "username=${QBT_USERNAME}" \
    --data-urlencode "password=${QBT_PASSWORD}" \
    "${QBT_URL}/api/v2/auth/login")
  if ! is_success_status "$status"; then
    err "auth/login failed (HTTP $status)"
    exit 1
  fi
}

# Required seeding hours per the formula above, given size in GB. Kept as a
# standalone function (not inlined) so the test suite can invoke it directly.
required_hours() {
  python3 -c "
import math, sys
gb = float(sys.argv[1])
if gb <= 1:
    hours = 72.0
elif gb < 50:
    hours = 72.0 + 2.0 * gb
else:
    hours = 100.0 * math.log(gb) - 219.2023
print(hours)
" "$1"
}

apply_limit() {
  local hash="$1"
  local info size_bytes size_gb name ratio_limit hours minutes status

  info=$(curl -s -b "$cookie_jar" "${QBT_URL}/api/v2/torrents/info?hashes=${hash}")
  if [ "$(echo "$info" | jq 'length')" -eq 0 ]; then
    err "torrent ${hash} not found via torrents/info; skipping"
    return 1
  fi

  size_bytes=$(echo "$info" | jq -r '.[0].size')
  name=$(echo "$info" | jq -r '.[0].name')
  # Pass the existing per-torrent ratio_limit straight through (Prowlarr/Sonarr/Radarr
  # already set this at grab time, e.g. 3.0) — we only add the seeding-time dimension.
  ratio_limit=$(echo "$info" | jq -r '.[0].ratio_limit')
  size_gb=$(python3 -c "print(${size_bytes} / 1e9)")
  hours=$(required_hours "$size_gb")
  minutes=$(python3 -c "import math; print(math.ceil(${hours} * 60))")

  status=$(curl -s -o /dev/null -w '%{http_code}' -b "$cookie_jar" \
    --data-urlencode "hashes=${hash}" \
    --data-urlencode "ratioLimit=${ratio_limit}" \
    --data-urlencode "seedingTimeLimit=${minutes}" \
    --data-urlencode "inactiveSeedingTimeLimit=-2" \
    --data-urlencode "shareLimitAction=Default" \
    "${QBT_URL}/api/v2/torrents/setShareLimits")

  if ! is_success_status "$status"; then
    err "setShareLimits failed for ${hash} (${name}), HTTP ${status}"
    return 1
  fi

  log "hash=${hash} name=\"${name}\" size_gb=$(printf '%.1f' "$size_gb") required_hours=$(printf '%.1f' "$hours") seeding_time_limit_min=${minutes} ratio_limit=${ratio_limit} shareLimitAction=Default http_status=${status}"
}

main() {
  : "${QBT_USERNAME:?QBT_USERNAME is required}"
  : "${QBT_PASSWORD:?QBT_PASSWORD is required}"

  cookie_jar=$(mktemp)
  trap 'rm -f "$cookie_jar"' EXIT

  login
  if [ "${1:-}" = "--all" ]; then
    local hashes failures=0
    hashes=$(curl -s -b "$cookie_jar" "${QBT_URL}/api/v2/torrents/info" | jq -r '.[].hash')
    while IFS= read -r hash; do
      [ -z "$hash" ] && continue
      apply_limit "$hash" || failures=$((failures + 1))
    done <<<"$hashes"
    if [ "$failures" -gt 0 ]; then
      err "${failures} torrent(s) failed to update"
      exit 1
    fi
  else
    local hash="${1:?usage: hitandrun-share-limit.sh <hash>|--all}"
    apply_limit "$hash"
  fi
}

# Only run main when executed directly — sourcing the file (as the test suite
# does, to exercise required_hours() in isolation) must not require
# QBT_USERNAME/QBT_PASSWORD or make any network calls.
if [ "${BASH_SOURCE[0]}" = "${0}" ]; then
  main "$@"
fi
