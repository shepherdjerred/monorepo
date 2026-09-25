#!/bin/bash
# Image entrypoint: mirror the repository-owned content roots into /data, then
# hand off to the stock itzg start script.
#
# Repository-owned files reach /data through itzg's /plugins sync (image
# /plugins/<path> -> /data/plugins/<path>, overwritten whenever they differ,
# never deleted). That sync cannot remove a file the repository stopped
# shipping, so each line of /bundle/owned.roots names a directory under
# plugins/ (relative to /data) that the repository owns completely: files there
# that the image does not ship are deleted before the server starts.
#
# Never list a directory a plugin writes runtime data into. plugins/TheStorm
# itself holds the-storm.db, so only content subdirectories below it may be
# roots.
set -euo pipefail
umask 0002 # match itzg's default so the fsGroup can write what we create

while IFS= read -r root; do
  [[ -z $root || $root == \#* ]] && continue
  if [[ $root != plugins/?* || $root == *..* ]]; then
    echo "[storm-entrypoint] owned root '$root' must be a path below plugins/" >&2
    exit 1
  fi
  source=/plugins/${root#plugins/}
  if [[ ! -d $source ]]; then
    echo "[storm-entrypoint] owned root '$root' is not a directory in the image ($source)" >&2
    exit 1
  fi
  mkdir -p "/data/$root"
  # --checksum: image layer mtimes are not a reliable change signal.
  rsync -r --checksum --delete --perms --chmod=D2775,F664 --omit-dir-times \
    --itemize-changes "$source/" "/data/$root/" |
    sed "s|^|[storm-entrypoint] $root: |"
done </bundle/owned.roots

exec /image/scripts/start "$@"
