#!/usr/bin/env bash
set -euo pipefail

# Transitional: the version-pinned config extension still generates
# `--filter '@shepherdjerred/macos-cross-site'` until it rebuilds and
# redeploys from main. Retarget the retired filter at the renamed workspace
# so stale loops install a buildable closure (the stale filter alone matches
# nothing, which would starve the aliased deploy entry's build). Remove with
# the deploy-site `macos-cross-site` alias once the extension is reconciled.
if (($# > 0)); then
  for arg in "$@"; do
    case "$arg" in
    "@shepherdjerred/macos-cross-site")
      set -- "$@" --filter '@shepherdjerred/cross-compilers-site'
      ;;
    esac
  done
fi

LOCK_MODE=${BUN_INSTALL_LOCK_MODE:?BUN_INSTALL_LOCK_MODE must be shared or local}
CI_INSTALL_STARTED=$SECONDS
INSTALL_XDG_CACHE_HOME=
report_install() {
  local status=$?
  if [[ -n $INSTALL_XDG_CACHE_HOME ]]; then
    rm -rf -- "${INSTALL_XDG_CACHE_HOME:?}"
  fi
  printf 'CI_INSTALL_DIAGNOSTIC {"schemaVersion":1,"elapsedSeconds":%d,"exitCode":%d}\n' "$((SECONDS - CI_INSTALL_STARTED))" "$status"
  exit "$status"
}
trap report_install EXIT

# ffmpeg-static's postinstall downloads its ~30 MB binary through a file cache
# at $XDG_CACHE_HOME/ffmpeg-static-nodejs, keyed by request URL. GitHub
# redirects every download to a freshly signed release-assets URL, so no later
# install can hit an entry; on the shared CI tool cache they filled its 10Gi
# quota in about a day and a half and failed every step with EDQUOT (AI-277).
# Each install gets a private XDG cache that is removed on exit. Bun falls back
# to $XDG_CACHE_HOME/.bun/install/cache when neither BUN_INSTALL_CACHE_DIR nor
# BUN_INSTALL is set, so that location is pinned before XDG_CACHE_HOME moves.
INSTALL_XDG_CACHE_HOME=$(mktemp -d)
bun_install() {
  local -a install_env=(XDG_CACHE_HOME="$INSTALL_XDG_CACHE_HOME")
  if [[ -z ${BUN_INSTALL_CACHE_DIR:-} && -z ${BUN_INSTALL:-} && -n ${XDG_CACHE_HOME:-} ]]; then
    install_env+=(BUN_INSTALL_CACHE_DIR="$XDG_CACHE_HOME/.bun/install/cache")
  fi
  env "${install_env[@]}" bun install "$@"
}

case "${CI_BUN_INSTALL_BACKEND:-}" in
  '') ;;
  copyfile) set -- "$@" --backend=copyfile ;;
  *) echo 'Unsupported CI Bun install backend' >&2; exit 1 ;;
esac

case "$LOCK_MODE" in
  shared)
    CACHE_LOCK_FILE=${BUN_CACHE_LOCK_FILE:?BUN_CACHE_LOCK_FILE must point to the shared Bun cache lock}
    CACHE_DIR=${BUN_INSTALL_CACHE_DIR:?BUN_INSTALL_CACHE_DIR must point to the shared Bun cache data directory}
    # Bun extracts each package into a temporary directory and renames it into
    # the cache. Its default temporary directory is under ~/.bun on the
    # container's writable layer, which turned every extraction into a write
    # to the CI node's OS disk plus a cross-filesystem copy. Extract into a
    # sibling of the data directory instead, on the same cache volume. Scoped
    # to the install so other Bun temporary files stay out of the shared cache;
    # bun-cache-gc.sh clears this directory under its exclusive lock.
    TMP_DIR="$(dirname "$CACHE_DIR")/tmp"
    # Bun has no bounded cache GC. Every in-cluster install takes a shared lock
    # so maintenance can take the exclusive lock before clearing the cache.
    (
      flock --shared 9
      mkdir -p "$TMP_DIR"
      BUN_TMPDIR="$TMP_DIR" bun_install "$@"
    ) 9>"$CACHE_LOCK_FILE"
    ;;
  local)
    if [[ -n "${BUN_CACHE_LOCK_FILE:-}" ]]; then
      echo "error: local Bun installs must not inherit BUN_CACHE_LOCK_FILE" >&2
      exit 1
    fi
    bun_install "$@"
    ;;
  *)
    echo "error: BUN_INSTALL_LOCK_MODE must be shared or local, got $LOCK_MODE" >&2
    exit 1
    ;;
esac
