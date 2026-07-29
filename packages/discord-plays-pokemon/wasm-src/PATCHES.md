# pokeemerald.wasm — build-from-source + patch series

`pokeemerald.wasm` is **built from source**, not committed. The source is
[ottohg/pokeemerald-wasm](https://github.com/ottohg/pokeemerald-wasm) (a fork of
tripplyons/pokeemerald-wasm that adds a full C reimplementation of the GBA m4a
audio engine — `src/m4a_wasm.c` — plus host-PCM exports), cloned at a pinned
commit and patched at build time.

Unlike `discord-plays-mario-kart` (which vendors its upstream C tree under
`wasm-src/code`), pokeemerald's decomp source is far too large to vendor, so we
clone it at build time — locally by `scripts/build-wasm.ts`, in the image build
by the `wasm-builder` stage of `packages/discord-plays-pokemon/Dockerfile`.
Only the patch series lives here.

```
wasm-src/
  patches/   our changes, applied at build time
  PATCHES.md this file
```

## Pin

- **Upstream:** https://github.com/ottohg/pokeemerald-wasm (default branch `master`)
- **Pinned commit:** `commit` in `wasm-src/upstream.json` — the source of
  truth. The Dockerfile `wasm-builder` stage carries a second copy
  (`ENV OTTOHG_SHA=…`); Renovate's `git-refs` custom manager (`renovate.json`)
  matches BOTH forms and advances them together, so the two can't drift.
- The committed species/map data tables
  (`packages/backend/src/game/events/generated/species.ts`,
  `packages/backend/src/game/spatial/generated/map-names.ts`) are generated
  from the same pin: the generators read the manifest via
  `scripts/lib/pokeemerald-pin.ts`, and `build-wasm.ts` re-runs them after
  every wasm build. A Renovate pin bump therefore needs a follow-up regen of
  those tables (hosted Renovate can't run the generators itself) — the
  `--check`-style drift is caught the next morning by the daily Temporal
  refresh once that schedule ships, or immediately by running `build-wasm.ts`.
- Renovate opens a review PR as `master` moves; the in-image verification gate
  (below) re-runs on each bump.

## Patches (`patches/`)

Applied in order with `patch -p1` (paths are `a/… b/…`):

| Patch                      | Touches                              | What it does                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| -------------------------- | ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `0001-extra-exports.patch` | `Makefile`, `src/wasm_observation.c` | Adds the game-state global exports, `WasmReadObservation`, `WasmReadMapTile`, and `WasmCheckpointSave`. The versioned observation bridge reports authoritative phase and input readiness; live map, position, facing, movement, and collision state; exact battle-menu state; and up to four battle participants. The tile bridge exposes collision, elevation, and metatile behavior for bounded current-map navigation. Both read bridges reject stale world state outside the live overworld callback. The checkpoint bridge invokes Emerald's own save serializer so benchmark teardown can reboot and verify the achieved state instead of merely copying stale flash bytes. |

## Build

- **Local:** `scripts/build-wasm.ts` (needs homebrew LLVM — clang w/ wasm32
  target + `wasm-ld` — plus `libpng`/`zlib` and `uv`). Clones the pin, applies
  `patches/`, drives mapjson, runs `make wasm`, stages the binary at
  `packages/backend/assets/pokeemerald.wasm` (gitignored), and regenerates the
  committed species/map data tables from the same pin.
- **Image build:** the `wasm-builder` stage in
  `packages/discord-plays-pokemon/Dockerfile` does the same in a
  `debian:trixie-slim` (clang-19) stage and copies the result into the backend
  image. The build uses clang `wasm32-unknown-unknown` + `wasm-ld`, **not
  emscripten**; bookworm's clang-14 links a wasm Bun/JSC rejects, so the
  toolchain image is pinned to trixie. A dedicated `wasm-abi-test` stage then
  boots that exact artifact and must pass the real-WASM ABI integration test
  before the runtime image can be assembled.

## Verification gate

The image build boots the freshly-built wasm and runs the ABI test against it
before creating the runtime image. The wider package verification also runs:

- `packages/backend/src/emulator/emulator-symbols.integration.test.ts` — every
  required global/function resolves, the observation ABI validates, and
  snapshot reads don't throw.
- `packages/backend/src/emulator/audio/audio-fingerprint.test.ts` — captured PCM
  matches the committed mel/chroma/onset baseline.

Both auto-skip when the wasm is absent (plain `bun run test` on a clean
checkout); they run for real in the image build and locally after
`scripts/build-wasm.ts`.

## Updating upstream

A Renovate PR will normally bump the pin for you (both `upstream.json` and the
Dockerfile copy). To do it by hand:

1. Set `commit` in `wasm-src/upstream.json` AND the matching
   `ENV OTTOHG_SHA=` in `packages/discord-plays-pokemon/Dockerfile` to the new
   commit (Renovate manages both; hand edits must keep them equal).
2. `scripts/build-wasm.ts` — if a patch no longer applies, `patch` stops and
   names it; re-base that `.patch` against the new source. The script ends by
   regenerating the committed species/map data tables from the new pin —
   commit those alongside the pin bump.
3. Run the verification tests (or let the image build / Renovate PR run them):
   `cd packages/backend && bun test src/emulator/emulator-symbols.integration.test.ts src/emulator/audio/audio-fingerprint.test.ts`.
4. If the audio intentionally changed, regenerate the baseline with
   `bun run scripts/audio-e2e.ts --update-baseline` and commit the WAV.
