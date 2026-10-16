#!/bin/sh
# One-time migration from the known unprotected configuration. Run while qBittorrent
# is stopped, before the ordinary drift check. Unexpected policy changes fail closed.
set -eu
seed=${1:?seed configuration required}
live=${2:?live configuration required}
temporary="${live}.media-safety-migration"
trap 'rm -f "$temporary"' EXIT
umask 077
awk '
  /^\[/ { section=$0 }
  FILENAME==ARGV[1] && section=="[BitTorrent]" {
    if (index($0,"Session\\ExcludedFileNames=")==1) desired=substr($0,index($0,"=")+1)
    next
  }
  FILENAME==ARGV[1] { next }
  section=="[BitTorrent]" && index($0,"Session\\ExcludedFileNames=")==1 {
    current=substr($0,index($0,"=")+1)
    if (current!="" && current!=desired) { print "Unexpected qBittorrent exclusion policy" > "/dev/stderr"; exit 3 }
    print "Session\\ExcludedFileNames=" desired
    next
  }
  section=="[BitTorrent]" && index($0,"ExcludedFileNamesEnabled=")==1 {
    value=substr($0,index($0,"=")+1)
    if (value!="false" && value!="true") { print "Unexpected qBittorrent exclusion enable value" > "/dev/stderr"; exit 3 }
    next
  }
  $0=="[BitTorrent]" { print; print "ExcludedFileNamesEnabled=true"; next }
  { print }
' "$seed" "$live" > "$temporary"
mv "$temporary" "$live"
