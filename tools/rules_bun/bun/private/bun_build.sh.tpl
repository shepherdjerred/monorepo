#!/usr/bin/env bash
set -euo pipefail

EXECROOT="$PWD"
BUN="{{BUN_PATH}}"
TREE="{{TREE_PATH}}"
PKG_DIR="{{PKG_DIR}}"
OUT_DIR="$EXECROOT/{{OUT_DIR}}"
OUTPUT_MODE="{{OUTPUT_MODE}}"
OUTPUT_SUBDIR="{{OUTPUT_SUBDIR}}"

WORK="${TMPDIR:-/tmp}/bun_build_$$"
mkdir -p "$WORK"
trap 'rm -rf "$WORK"' EXIT

# Hermetic build environment
export HOME="$WORK/.home"
export XDG_CACHE_HOME="$WORK/.cache"
mkdir -p "$HOME" "$XDG_CACHE_HOME"
export CI=true
export ASTRO_TELEMETRY_DISABLED=1
export DO_NOT_TRACK=1
export NEXT_TELEMETRY_DISABLED=1

{{ENV_VARS}}

# Resolve paths to absolute
BUN="$(cd "$(dirname "$BUN")" && echo "$PWD/$(basename "$BUN")")"
TREE_ABS="$(cd "$TREE" && pwd)"

# Copy the full prepared tree to a clean short path.
# This is necessary because Vite/Rollup resolve HTML entry points via
# realpath and reject paths that look like they escape the project root.
# The TreeArtifact lives deep in Bazel's execroot (20+ dir levels), causing
# relative path computation to produce invalid "../" chains.
# cp -a preserves symlinks and is fast enough (~5-10s for typical trees).
cp -a "$TREE_ABS" "$WORK/tree"

cd "$WORK/tree/$PKG_DIR"
export PATH="$(pwd)/node_modules/.bin:$(dirname "$BUN"):/usr/bin:/bin"

# Run the framework build
{{BUILD_CMD}}

# Collect outputs
if [ "$OUTPUT_MODE" = "directory" ]; then
    if [ -d "$OUTPUT_SUBDIR" ]; then
        mkdir -p "$OUT_DIR"
        cp -R "$OUTPUT_SUBDIR/." "$OUT_DIR/"
    else
        echo "ERROR: Expected output directory '$OUTPUT_SUBDIR' not found after build" >&2
        ls -la >&2
        exit 1
    fi
else
    touch "$OUT_DIR"
fi
