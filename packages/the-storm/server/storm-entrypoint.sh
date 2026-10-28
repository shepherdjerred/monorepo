#!/bin/bash
# Image entrypoint: remove stale files once, mirror the repository-owned
# content roots into /data, then hand off to the stock itzg start script.
#
# Repository-owned files reach /data through itzg's /plugins sync (image
# /plugins/<path> -> /data/plugins/<path>, overwritten whenever they differ,
# never deleted). That sync cannot remove anything, so:
#
# - /bundle/remove.list names files (relative to /data) to delete. Each entry
#   runs once: after deleting the file (or finding it absent) the entry is
#   appended to the ledger /data/.the-storm-removed, and ledgered entries are
#   skipped on later boots, so a file a plugin or admin recreates is kept.
#   Adding a line to the list processes only that line.
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
  local list=/bundle/remove.list ledger=/data/.the-storm-removed
  local path target dir
  touch "$ledger"
  while IFS= read -r path; do
    [[ -z $path || $path == \#* ]] && continue
    if [[ $path == /* || $path == *..* || $path == *[*?[]* || $path == */ ]]; then
      fail "remove.list entry '$path' must be a plain file path relative to /data"
    fi
    # Each entry runs once, ever: a file recreated later (by a plugin,
    # /setspawn, an admin) is runtime state and is left alone.
    grep -qxF -- "$path" "$ledger" && continue
    target=/data/$path
    [[ -d $target && ! -L $target ]] && fail "remove.list entry '$path' is a directory"
    if [[ -e $target || -L $target ]]; then
      rm -f -- "$target"
      echo "[storm-entrypoint] removed stale $path"
      dir=$(dirname "$target")
      while [[ $dir != /data && -z $(find "$dir" -mindepth 1 -print -quit) ]]; do
        rmdir -- "$dir"
        echo "[storm-entrypoint] removed empty ${dir#/data/}/"
        dir=$(dirname "$dir")
      done
    fi
    echo "$path" >>"$ledger"
  done <"$list"
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

install_livemap_directory() {
  local directory=$1 owner=$2 group=$3
  # A separate PVC root can belong to root with fsGroup write access. A
  # non-root process can use it, but cannot chown or chmod that mount root.
  if [[ -d $directory && $(id -u) != 0 && $(stat -c '%u' "$directory") != "$(id -u)" ]]; then
    [[ -w $directory && -x $directory ]] || fail "LiveMap directory is not writable: $directory"
  else
    install -d -m 2775 -o "$owner" -g "$group" "$directory"
  fi
}

install_livemap() {
  # Only copy bundled static files. Never prune this webroot: BlueMap owns
  # settings.json, maps, and live data, and open tabs may still use old assets.
  # Installing index.html before BlueMap starts also prevents default frontend
  # extraction from replacing the branded viewer on first boot.
  local source=$1 target=$2 data_owner=$3 data_group=$4 runtime_owner file destination directory
  [[ -f $source/index.html ]] || fail "LiveMap frontend is missing from the image"
  # fsGroup can leave the volume root owned by root even when Minecraft runs
  # unprivileged. Install as the runtime user and retain the shared volume group.
  runtime_owner=$(id -u)
  # Root-started images hand off to itzg, which chowns only when /data has the
  # wrong owner. Preserve an already-correct volume owner in that case.
  if [[ $runtime_owner != 0 ]]; then
    data_owner=$runtime_owner
  fi
  install_livemap_directory "$(dirname "$target")" "$data_owner" "$data_group"
  install_livemap_directory "$target" "$data_owner" "$data_group"
  while IFS= read -r -d '' file; do
    destination=$target/${file#"$source/"}
    directory=$(dirname "$destination")
    install_livemap_directory "$directory" "$data_owner" "$data_group"
    install -m 0664 -o "$data_owner" -g "$data_group" "$file" "$destination"
  done < <(find "$source" -type f -print0)
}

install_world_protection() {
  local definition target dimension
  for definition in /bundle/world-protection/*.json; do
    target=$(jq -er '.file' "$definition")
    case "$target" in
      /data/world/dimensions/minecraft/*/paper-world.yml) ;;
      *) fail "unexpected world protection target: $target" ;;
    esac
    [[ $target != *..* ]] || fail "invalid world protection target"
    dimension=$(dirname "$target")
    # Paper 26.3 treats a pre-created dimension directory as an existing world and
    # requires its native world_gen_settings.dat. Let Paper initialize new worlds.
    if [[ ! -d $dimension ]]; then
      echo "[storm-entrypoint] deferred protection profile for uninitialized ${dimension##*/}; restart after provisioning"
      continue
    fi
    [[ -f $dimension/data/minecraft/world_gen_settings.dat ]] ||
      fail "dimension ${dimension##*/} lacks native world-gen settings; finish provisioning before startup"
    if [[ ! -e $target ]]; then printf '{}\n' >"$target"; fi
    mc-image-helper patch "$definition"
  done
}

main() {
  python3 /opt/the-storm/world-retirement.py --data /data
  python3 /opt/the-storm/skylands-startup.py --data /data --config /plugins/TheStorm/skylands.json
  install -m 0664 /opt/the-storm/server-icon.png /data/server-icon.png
  remove_stale_files
  mirror_owned_roots
  install_world_protection
  install_livemap /opt/the-storm/livemap /data/bluemap/web "$(stat -c '%u' /data)" "$(stat -c '%g' /data)"
  exec /image/scripts/start "$@"
}

main "$@"
