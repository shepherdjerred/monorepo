# pokeemerald.wasm — build-from-source + patch series

`pokeemerald.wasm` is **built from source**, not committed. The source is
[ottohg/pokeemerald-wasm](https://github.com/ottohg/pokeemerald-wasm) (a fork of
tripplyons/pokeemerald-wasm that adds a full C reimplementation of the GBA m4a
audio engine — `src/m4a_wasm.c` — plus host-PCM exports), cloned at a pinned
commit and patched at build time.

Unlike `discord-plays-mario-kart` (which vendors its upstream C tree under
`wasm-src/code`), pokeemerald's decomp source is far too large to vendor, so we
clone it at build time via Dagger's content-addressed native git source
(`dag.git().commit().tree()`). Only the patch series lives here.

```
wasm-src/
  patches/   our changes, applied at build time
  PATCHES.md this file
```

## Pin

- **Upstream:** https://github.com/ottohg/pokeemerald-wasm (default branch `master`)
- **Pinned commit:** `POKEEMERALD_SOURCE_REF` in `.dagger/src/constants.ts` — the
  single source of truth. The local `scripts/build-wasm.sh` reads this value
  directly (no separate pin to keep in sync), and the CI build
  (`buildPokeemeraldWasm` in `.dagger/src/image.ts`) imports the same constant.
- Renovate's `git-refs` custom manager (`renovate.json`) advances the pin as
  `master` moves and opens a review PR; the in-image verification gate (below)
  re-runs on each bump. Because both build paths derive from the one constant, a
  Renovate bump can never leave the local script building a stale emulator.

## Patches (`patches/`)

Applied in order with `patch -p1` (paths are `a/… b/…`):

| Patch                      | Touches    | What it does                                                                                                                                                                                                                                                                                                                 |
| -------------------------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `0001-extra-exports.patch` | `Makefile` | Adds `--export=gSaveBlock2Ptr --export=gPlayerParty --export=gPlayerPartyCount --export=gBattleResults` to the `wasm-ld` link line. ottohg's link line is a curated list (not `--export-all`), so without this `packages/backend/src/emulator/symbols.ts` resolves null for every game-state global except `gSaveBlock1Ptr`. |

## Build

- **Local:** `scripts/build-wasm.sh` (needs homebrew LLVM — clang w/ wasm32
  target + `wasm-ld` — plus `libpng`/`zlib` and `uv`). Clones the pin, applies
  `patches/`, drives mapjson, runs `make wasm`, and stages the binary at
  `packages/backend/assets/pokeemerald.wasm` (gitignored).
- **CI:** `buildPokeemeraldWasm` in `.dagger/src/image.ts` does the same in a
  `debian:trixie-slim` (clang-19) Dagger stage and copies the result into the
  backend image. The build uses clang `wasm32-unknown-unknown` + `wasm-ld`, **not
  emscripten**; bookworm's clang-14 links a wasm Bun/JSC rejects, so the
  toolchain image is pinned to trixie.

## Verification gate

The image build boots the freshly-built wasm and runs two tests against it:

- `packages/backend/src/emulator/emulator-symbols.integration.test.ts` — every
  `GAME_SYMBOL_NAMES` global resolves and snapshot reads don't throw.
- `packages/backend/src/emulator/audio/audio-fingerprint.test.ts` — captured PCM
  matches the committed mel/chroma/onset baseline.

Both auto-skip when the wasm is absent (plain `bun run test` on a clean
checkout); they run for real in the image build and locally after
`scripts/build-wasm.sh`.

## Updating upstream

A Renovate PR will normally bump the pin for you. To do it by hand:

1. Set `POKEEMERALD_SOURCE_REF` (`.dagger/src/constants.ts`) to the new commit.
   `scripts/build-wasm.sh` reads that constant automatically, so there is no
   second pin to touch.
2. `scripts/build-wasm.sh` — if a patch no longer applies, `patch` stops and
   names it; re-base that `.patch` against the new source.
3. Run the verification tests (or let the image build / Renovate PR run them):
   `cd packages/backend && bun test src/emulator/emulator-symbols.integration.test.ts src/emulator/audio/audio-fingerprint.test.ts`.
4. If the audio intentionally changed, regenerate the baseline with
   `bun run scripts/audio-e2e.ts --update-baseline` and commit the WAV.
