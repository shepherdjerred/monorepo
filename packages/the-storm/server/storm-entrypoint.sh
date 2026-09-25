#!/bin/bash
# Image entrypoint: remove stale files once, mirror the repository-owned
# content roots into /data, then hand off to the stock itzg start script.
#
# Repository-owned files reach /data through itzg's /plugins sync (image
# /plugins/<path> -> /data/plugins/<path>, overwritten whenever they differ,
# never deleted). That sync cannot remove anything, so:
#
# - /bundle/remove.list names files (relative to /data) to delete. It runs
#   once per version of the list: its sha256 is recorded in
#   /data/.the-storm-remove.list.sha256 afterwards, so a file a plugin or
#   admin recreates later is left alone.
# - Each line of /bundle/owned.roots names a directory under plugins/
#   (relative to /data) that the repository owns completely: files there that
#   the image does not ship are deleted on every boot. Never list a directory a
#   plugin writes runtime data into. plugins/TheStorm itself holds
#   the-storm.db, so only content subdirectories below it may be roots.
set -euo pipefail
umask 0002 # match itzg's default so the fsGroup can write what we create

fail() {
  echo "[storm-entrypoint] $*" >&2
  exit 1
}

remove_stale_files() {
  local list=/bundle/remove.list marker=/data/.the-storm-remove.list.sha256
  local want path target dir
  want=$(sha256sum "$list" | cut -d' ' -f1)
  [[ -f $marker && $(<"$marker") == "$want" ]] && return 0
  while IFS= read -r path; do
    [[ -z $path || $path == \#* ]] && continue
    if [[ $path == /* || $path == *..* || $path == *[*?[]* ]]; then
      fail "remove.list entry '$path' must be a plain path relative to /data"
    fi
    target=/data/$path
    [[ -d $target && ! -L $target ]] && fail "remove.list entry '$path' is a directory"
    [[ -e $target || -L $target ]] || continue
    rm -f -- "$target"
    echo "[storm-entrypoint] removed stale $path"
    dir=$(dirname "$target")
    while [[ $dir != /data && -z $(find "$dir" -mindepth 1 -print -quit) ]]; do
      rmdir -- "$dir"
      echo "[storm-entrypoint] removed empty ${dir#/data/}/"
      dir=$(dirname "$dir")
    done
  done <"$list"
  echo "$want" >"$marker"
}

mirror_owned_roots() {
  local root source
  while IFS= read -r root; do
    [[ -z $root || $root == \#* ]] && continue
    if [[ $root != plugins/?* || $root == *..* ]]; then
      fail "owned root '$root' must be a path below plugins/"
    fi
    source=/plugins/${root#plugins/}
    [[ -d $source ]] || fail "owned root '$root' is not a directory in the image ($source)"
    mkdir -p "/data/$root"
    # --checksum: image layer mtimes are not a reliable change signal.
    rsync -r --checksum --delete --perms --chmod=D2775,F664 --omit-dir-times \
      --itemize-changes "$source/" "/data/$root/" |
      sed "s|^|[storm-entrypoint] $root: |"
  done </bundle/owned.roots
}

remove_stale_files
mirror_owned_roots
exec /image/scripts/start "$@"
