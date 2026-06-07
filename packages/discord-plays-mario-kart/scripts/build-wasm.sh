#!/usr/bin/env bash
# Build the patched N64Wasm core (wasm-src/) into the backend's assets.
# Reproducible: runs `make` inside the pinned emscripten image. The CI image
# build (Dagger) does the same in an emscripten stage; this script is for local
# dev. No binaries are committed.
set -euo pipefail

PKG_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$PKG_ROOT/wasm-src"
OUT="$PKG_ROOT/packages/backend/assets/n64wasm"
EMSDK_IMAGE="${EMSDK_IMAGE:-emscripten/emsdk:2.0.7}"

echo "[build-wasm] compiling N64Wasm via $EMSDK_IMAGE (this takes a few minutes)"
docker run --rm -v "$SRC:/src" -w /src/code "$EMSDK_IMAGE" bash -c "make"

mkdir -p "$OUT/res"
cp "$SRC/code/n64wasm.js" "$SRC/code/n64wasm.wasm" "$OUT/"
# Files the host stages into MEMFS at runtime (loadFile reads these).
cp "$SRC/code/shader_vert.hlsl" "$SRC/code/shader_frag.hlsl" "$OUT/"
cp "$SRC/code/overlay.png" "$OUT/" 2>/dev/null || true
cp "$SRC/code/res/arial.ttf" "$OUT/res/" 2>/dev/null || true

echo "[build-wasm] wrote -> $OUT"
ls -lh "$OUT"
