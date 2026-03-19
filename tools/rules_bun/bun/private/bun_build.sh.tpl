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

# Copy the prepared tree to a clean short path.
# Vite/Rollup resolve HTML entry points via realpath and reject paths that
# escape the project root. The TreeArtifact lives deep in Bazel's execroot
# (20+ dir levels), causing relative path computation to produce invalid
# "../" chains.
#
# Strategy: cp -R preserves symlinks (keeping node_modules small), then we
# re-copy just the package source directory with -L to dereference hardlinks
# so that realpath() on source/HTML files resolves within this overlay.
# This avoids dereferencing the entire node_modules tree (which can be 600MB+).
cp -R "$TREE_ABS" "$WORK/tree"

# Dereference hardlinks in the package source directory only.
# This makes realpath() on HTML entries and source files resolve within
# the overlay instead of back to the deep TreeArtifact.
PKG_SRC="$WORK/tree/$PKG_DIR"
if [ -d "$PKG_SRC" ]; then
    TMP_PKG="$WORK/_pkg_deref"
    # Copy package dir with -RL to dereference, excluding node_modules
    mkdir -p "$TMP_PKG"
    # Use rsync-like approach: copy everything except node_modules
    find "$PKG_SRC" -maxdepth 1 ! -name node_modules ! -path "$PKG_SRC" -exec cp -RL {} "$TMP_PKG/" \;
    # Replace originals with dereferenced copies
    find "$TMP_PKG" -maxdepth 1 ! -path "$TMP_PKG" -exec sh -c 'rm -rf "$1/$(basename "$2")" && mv "$2" "$1/"' _ "$PKG_SRC" {} \;
    rm -rf "$TMP_PKG"
fi

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
