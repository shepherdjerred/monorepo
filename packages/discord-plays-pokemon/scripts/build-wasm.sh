#!/usr/bin/env bash
# Build pokeemerald.wasm from ottohg/pokeemerald-wasm at a pinned commit and
# stage it at packages/backend/assets/pokeemerald.wasm. This is the LOCAL-dev
# path; CI builds the identical wasm from source in the Dagger image build
# (`buildPokeemeraldWasm` in .dagger/src/image.ts). Keep the two in sync — both
# read the pin from POKEEMERALD_SOURCE_REF and apply the same patch series.
#
# ottohg's fork adds a full C reimplementation of the m4a audio engine
# (`src/m4a_wasm.c`) plus extra exports so the host can read mixed PCM
# without having to write its own track interpreter or mixer. tripplyons's
# upstream wasm stubs all of this out, which is why we can't use it.
#
# We carry a small patch on top to add the four extra exports our
# game-state reader needs (`gSaveBlock2Ptr`, `gPlayerParty`,
# `gPlayerPartyCount`, `gBattleResults`) — ottohg's link line is a curated
# list, not `--export-all`, so without this our `symbols.ts` resolver
# returns null for everything except `gSaveBlock1Ptr`. The patch lives at
# `wasm-src/patches/` (see wasm-src/PATCHES.md).
#
# Prerequisites:
#   - `clang` with `wasm32-unknown-unknown` target (homebrew LLVM works:
#     `brew install llvm`)
#   - `wasm-ld` (ships with homebrew LLVM under /opt/homebrew/bin)
#   - `libpng` + `zlib` (for the gbagfx asset converter:
#     `brew install libpng`)
#   - `uv` (Python runner: `mise install python` or `brew install uv`)
#
# Usage:
#   ./packages/discord-plays-pokemon/scripts/build-wasm.sh

set -euo pipefail

# Pin the upstream SHA. The source of truth is POKEEMERALD_SOURCE_REF in
# .dagger/src/constants.ts (advanced by Renovate's git-refs manager); keep this
# in lockstep when bumping. See wasm-src/PATCHES.md for the upgrade workflow.
OTTOHG_REPO="https://github.com/ottohg/pokeemerald-wasm.git"
OTTOHG_SHA="ee8b9644375640fdb947b48a0d682adc35e0c297"

WORKDIR="${WORKDIR:-${TMPDIR:-/tmp}/pokeemerald-wasm-build}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ASSETS_DIR="$SCRIPT_DIR/../packages/backend/assets"
PATCHES_DIR="$SCRIPT_DIR/../wasm-src/patches"
WASM_OUT="$ASSETS_DIR/pokeemerald.wasm"

WASM_CC="${WASM_CC:-$(command -v /opt/homebrew/opt/llvm/bin/clang || command -v /usr/local/opt/llvm/bin/clang || command -v clang)}"
WASM_LD="${WASM_LD:-$(command -v wasm-ld || command -v /opt/homebrew/opt/llvm/bin/wasm-ld)}"
if [[ -z "$WASM_CC" ]] || [[ -z "$WASM_LD" ]]; then
  echo "error: install homebrew LLVM (brew install llvm) — need wasm32 clang + wasm-ld" >&2
  exit 1
fi
if ! command -v uv >/dev/null; then
  echo "error: uv not found — install via mise/brew (needed for wasm asset tooling)" >&2
  exit 1
fi

echo "[build-wasm] toolchain:"
echo "  WASM_CC=$WASM_CC"
echo "  WASM_LD=$WASM_LD"
echo "  WORKDIR=$WORKDIR"

# Clone (or refresh) the pinned fork. Use `clone -b` against the default
# branch on a fresh checkout, then fetch the exact SHA into an existing
# clone. The `git -C` form avoids cd-ing.
if [[ ! -d "$WORKDIR/.git" ]]; then
  mkdir -p "$(dirname "$WORKDIR")"
  git clone --no-checkout "$OTTOHG_REPO" "$WORKDIR"
fi
# Make sure the pinned SHA is locally available; fetch only when missing.
# `git rev-parse --verify` exits 0/1 cleanly and prints the resolved SHA on
# stdout (which we don't need, hence redirecting to /dev/null).
if ! git -C "$WORKDIR" rev-parse --verify --quiet "${OTTOHG_SHA}^{commit}" >/dev/null; then
  git -C "$WORKDIR" fetch --depth=1 origin "$OTTOHG_SHA"
fi
git -C "$WORKDIR" checkout --detach "$OTTOHG_SHA"

# Apply our patch series (currently just the extra game-state exports — see
# wasm-src/PATCHES.md). Idempotent: skip if already applied so re-runs against an
# existing WORKDIR don't fail on an already-patched tree.
if ! grep -q "export=gSaveBlock2Ptr" "$WORKDIR/Makefile"; then
  for p in "$PATCHES_DIR"/*.patch; do
    echo "[build-wasm] applying $(basename "$p")"
    patch -p1 --no-backup-if-mismatch -d "$WORKDIR" < "$p"
  done
fi

# Generate map headers / layouts / groups. The Makefile only builds these as
# a side-effect of the GBA `maps.o` recipe (which we don't run), so we drive
# the mapjson tool ourselves. Build mapjson first if it isn't already there.
if [[ ! -x "$WORKDIR/tools/mapjson/mapjson" ]]; then
  make -C "$WORKDIR" tools
fi
"$WORKDIR/tools/mapjson/mapjson" groups emerald \
  "$WORKDIR/data/maps/map_groups.json" "$WORKDIR/data/maps" "$WORKDIR/include" >/dev/null
"$WORKDIR/tools/mapjson/mapjson" layouts emerald \
  "$WORKDIR/data/layouts/layouts.json" "$WORKDIR/data/layouts" "$WORKDIR/include" >/dev/null
for d in "$WORKDIR/data/maps/"*/; do
  name=$(basename "$d")
  # `_unused` and any directory without a map.json aren't real maps; skip.
  if [[ "$name" == "_unused" ]] || [[ ! -f "$d/map.json" ]]; then
    continue
  fi
  "$WORKDIR/tools/mapjson/mapjson" map emerald \
    "$d/map.json" "$WORKDIR/data/layouts/layouts.json" "$d" >/dev/null
done

# The actual wasm compile. libpng + libz live in /opt/homebrew on Apple
# Silicon and need to be on the search path so the gbagfx tool builds.
echo "[build-wasm] compiling…"
CPATH="${CPATH:-/opt/homebrew/include}" \
LIBRARY_PATH="${LIBRARY_PATH:-/opt/homebrew/lib}" \
WASM_CC="$WASM_CC" \
WASM_LD="$WASM_LD" \
make -C "$WORKDIR" wasm

mkdir -p "$ASSETS_DIR"
cp "$WORKDIR/build/wasm/pokeemerald.wasm" "$WASM_OUT"
BYTES=$(wc -c < "$WASM_OUT" | tr -d ' ')
echo "[build-wasm] wrote $WASM_OUT (${BYTES} bytes)"
