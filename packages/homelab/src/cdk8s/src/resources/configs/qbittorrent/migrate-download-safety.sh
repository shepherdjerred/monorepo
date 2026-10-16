#!/bin/sh
# Run while qBittorrent is stopped, before the ordinary drift check. The receipt
# stores only the last managed exclusion list, so declared upgrades and rollbacks
# can replace it while unrelated or manually changed policy still fails closed.
set -eu
seed=${1:?seed configuration required}
live=${2:?live configuration required}
policy="${live}.managed-exclusions"
previous=/dev/null
has_previous=0
if [ -e "$policy" ] || [ -L "$policy" ]; then
  if [ ! -f "$policy" ] || [ -L "$policy" ]; then
    echo "Invalid qBittorrent managed exclusion receipt" >&2
    exit 3
  fi
  previous=$policy
  has_previous=1
fi
umask 077
temporary=$(mktemp "${live}.media-safety-migration.XXXXXX")
policy_temporary=
trap 'rm -f "$temporary"; if [ -n "$policy_temporary" ]; then rm -f "$policy_temporary"; fi' EXIT
policy_temporary=$(mktemp "${policy}.XXXXXX")
awk -v has_previous="$has_previous" -v policy_output="$policy_temporary" '
  function fail(message) { print message > "/dev/stderr"; invalid=1; exit 3 }
  /^\[/ { section=$0 }
  FILENAME==ARGV[1] && section=="[BitTorrent]" {
    if (index($0,"Session\\ExcludedFileNames=")==1) { desired=substr($0,index($0,"=")+1); desired_count++ }
    if (index($0,"ExcludedFileNamesEnabled=")==1) seed_enabled=substr($0,index($0,"=")+1)
    next
  }
  FILENAME==ARGV[1] { next }
  FILENAME==ARGV[2] { prior=$0; prior_count++; next }
  section=="[BitTorrent]" && index($0,"Session\\ExcludedFileNames=")==1 {
    live_count++
    current=substr($0,index($0,"=")+1)
    if (current!=desired && !(has_previous && current==prior) && !(!has_previous && current=="")) fail("Unexpected qBittorrent exclusion policy")
    print "Session\\ExcludedFileNames=" desired
    next
  }
  section=="[BitTorrent]" && index($0,"ExcludedFileNamesEnabled=")==1 {
    enabled_count++
    value=substr($0,index($0,"=")+1)
    if ((value!="false" && value!="true") || (has_previous && value!="true")) fail("Unexpected qBittorrent exclusion enable value")
    next
  }
  $0=="[BitTorrent]" { sections++; print; print "ExcludedFileNamesEnabled=true"; next }
  { print }
  END {
    if (invalid) exit 3
    if (desired_count!=1 || desired=="" || seed_enabled!="true") fail("Invalid declared qBittorrent exclusion policy")
    if (has_previous && (prior_count!=1 || prior=="")) fail("Invalid qBittorrent managed exclusion receipt")
    if (live_count!=1 || sections!=1 || enabled_count>1 || (has_previous && enabled_count!=1)) fail("Invalid live qBittorrent exclusion configuration")
    print desired > policy_output
  }
' "$seed" "$previous" "$live" > "$temporary"
# A crash between these renames is recoverable: live already equals desired,
# which is accepted even while the receipt still contains the prior value.
mv "$temporary" "$live"
mv "$policy_temporary" "$policy"
