#!/usr/bin/env bash
set -euo pipefail

# Locate runfiles (test rules use runfiles, not execroot)
if [[ -n "${RUNFILES_DIR:-}" ]]; then
    RUNFILES="$RUNFILES_DIR"
elif [[ -d "${BASH_SOURCE[0]}.runfiles" ]]; then
    RUNFILES="${BASH_SOURCE[0]}.runfiles"
elif [[ -d "$0.runfiles" ]]; then
    RUNFILES="$0.runfiles"
else
    echo "ERROR: Cannot find runfiles directory" >&2
    exit 1
fi

BUN="$RUNFILES/{{BUN_PATH}}"
TREE="$RUNFILES/{{TREE_PATH}}"
PKG_DIR="{{PKG_DIR}}"

# Create writable overlay
WORK="${TMPDIR:-/tmp}/bun_build_test_$$"
mkdir -p "$WORK"
trap 'rm -rf "$WORK"' EXIT

cp -a "$TREE" "$WORK/overlay"
OVERLAY="$WORK/overlay"

# Hermetic environment
export HOME="$WORK/.home"
export XDG_CACHE_HOME="$WORK/.cache"
mkdir -p "$HOME" "$XDG_CACHE_HOME"
export CI=true
export ASTRO_TELEMETRY_DISABLED=1
export DO_NOT_TRACK=1
export NEXT_TELEMETRY_DISABLED=1

{{ENV_VARS}}

# Run framework check
cd "$OVERLAY/$PKG_DIR"
export PATH="$(dirname "$BUN"):/usr/bin:/bin"
exec {{BUILD_CMD}}
