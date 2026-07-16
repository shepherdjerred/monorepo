#!/usr/bin/env bash
# Build the N64Wasm core into the backend's assets.
#
# The committed wasm-src/code tree is BYTE-PRISTINE upstream (see wasm-src/PATCHES.md).
# Our changes live in wasm-src/patches/ and are applied HERE, at build time, into a
# throwaway copy — the committed tree is never mutated. A bare `make` in wasm-src/code
# would compile WITHOUT our neil exports, so always build via this script, which
# applies the patch series into a throwaway copy.
#
# Reproducible: runs `make` inside the pinned emscripten image. No binaries are committed.
set -euo pipefail

PKG_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$PKG_ROOT/wasm-src"
OUT="$PKG_ROOT/packages/backend/assets/n64wasm"
EMSDK_IMAGE="${EMSDK_IMAGE:-emscripten/emsdk:2.0.7}"

build="$(mktemp -d)"
trap 'rm -rf "$build"' EXIT

echo "[build-wasm] staging pristine wasm-src + applying patch series"
cp -R "$SRC/code" "$build/code"
for p in "$SRC"/patches/*.patch; do
  echo "[build-wasm]   apply $(basename "$p")"
  # patch(1), not `git apply`: the staging dir is not a git work tree, and patch
  # is portable + non-interactive here (paths are a/code…, so -p1).
  ( cd "$build" && patch -p1 --no-backup-if-mismatch < "$p" )
done

echo "[build-wasm] compiling N64Wasm via $EMSDK_IMAGE (this takes a few minutes)"
docker run --rm -v "$build:/src" -w /src/code "$EMSDK_IMAGE" bash -c "make"

mkdir -p "$OUT/res"
cp "$build/code/n64wasm.js" "$build/code/n64wasm.wasm" "$OUT/"
# Files the host stages into MEMFS at runtime (loadFile reads these).
cp "$build/code/shader_vert.hlsl" "$build/code/shader_frag.hlsl" "$OUT/"
cp "$build/code/overlay.png" "$OUT/"
cp "$build/code/res/arial.ttf" "$OUT/res/"

echo "[build-wasm] wrote -> $OUT"
ls -lh "$OUT"
