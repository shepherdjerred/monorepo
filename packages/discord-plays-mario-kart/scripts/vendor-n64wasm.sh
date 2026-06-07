#!/usr/bin/env bash
# Re-vendor the N64Wasm core (wasm-src/code) from upstream at a pinned commit.
#
# This is the UPDATE mechanism for the vendored emulator. To bump upstream:
#   1. Edit UPSTREAM_SHA below to the new commit.
#   2. Run this script.
#   3. If the patch series no longer applies, the script stops and tells you which
#      patch failed — re-base wasm-src/patches/*.patch against the new source.
#   4. Rebuild (scripts/build-wasm.sh) and smoke-test (wasm-src/run.reference.mjs).
#
# The committed wasm-src/code tree stays BYTE-PRISTINE upstream (minus the excludes
# in vendor-excludes.txt). Our changes live only in wasm-src/patches/ and are applied
# at build time, never committed into the tree. See wasm-src/PATCHES.md.
set -euo pipefail

UPSTREAM_URL="https://github.com/nbarkhina/N64Wasm.git"
# Pinned upstream baseline. Recovered 2026-06-07 by hash-matching the vendored tree
# against upstream history: it is master @ this commit, minus vendor-excludes.txt.
UPSTREAM_SHA="bfac222f8a27287022844b47000328531834e9c1"

PKG_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WASM_SRC="$PKG_ROOT/wasm-src"
EXCLUDES_FILE="$WASM_SRC/vendor-excludes.txt"
PATCHES_DIR="$WASM_SRC/patches"

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
clone="$tmp/upstream"

echo "[vendor] fetching $UPSTREAM_URL @ $UPSTREAM_SHA"
# Shallow single-commit fetch: one self-contained pack (full blobs for just this
# commit), far more robust on flaky networks than a blobless lazy-fetch clone.
git init --quiet "$clone"
git -C "$clone" remote add origin "$UPSTREAM_URL"
attempt=1
until git -C "$clone" -c http.postBuffer=524288000 fetch --quiet --depth 1 origin "$UPSTREAM_SHA"; do
  if [ "$attempt" -ge 4 ]; then
    echo "[vendor] ERROR: fetch failed after $attempt attempts (network?)" >&2
    exit 1
  fi
  echo "[vendor] fetch attempt $attempt failed; retrying in 3s..." >&2
  attempt=$((attempt + 1))
  sleep 3
done
git -C "$clone" checkout --quiet FETCH_HEAD

echo "[vendor] applying excludes from $(basename "$EXCLUDES_FILE")"
while IFS= read -r line; do
  # strip trailing comment, then trim leading/trailing whitespace (pure bash)
  path="${line%%#*}"
  path="${path#"${path%%[![:space:]]*}"}"
  path="${path%"${path##*[![:space:]]}"}"
  [ -z "$path" ] && continue
  if [ ! -e "$clone/$path" ]; then
    echo "[vendor] ERROR: exclude path not found in upstream: $path" >&2
    echo "[vendor]        (upstream may have moved it — update vendor-excludes.txt)" >&2
    exit 1
  fi
  echo "[vendor]   rm $path"
  rm -rf "${clone:?}/$path"
done < "$EXCLUDES_FILE"

echo "[vendor] syncing pristine code/ into wasm-src/code"
rm -rf "$WASM_SRC/code"
cp -R "$clone/code" "$WASM_SRC/code"

echo "[vendor] validating patch series still applies cleanly"
for p in "$PATCHES_DIR"/*.patch; do
  if ! ( cd "$WASM_SRC" && git apply --check "$p" ); then
    echo "[vendor] ERROR: patch does not apply to the new upstream: $(basename "$p")" >&2
    echo "[vendor]        Re-base it against wasm-src/code and retry." >&2
    exit 1
  fi
  echo "[vendor]   OK $(basename "$p")"
done

echo "[vendor] done. Tree is pristine @ $UPSTREAM_SHA (minus excludes); patches verified."
echo "[vendor] next: scripts/build-wasm.sh  &&  bun wasm-src/run.reference.mjs"
