# Vendored N64Wasm (pristine + patch series)

This is a from-source vendor of **N64Wasm** (nbarkhina/N64Wasm — parallel-n64 +
angrylion software RDP), patched so it runs **headless in Node/Bun** with no
browser, no GPU, no canvas: the angrylion software framebuffer is read straight
out of wasm linear memory, the ROM is injected via memory, and up to 4
controllers can be driven per-frame.

## Vendoring model

`code/` is **byte-for-byte pristine upstream** at the pinned commit below (minus
the dead-code trees in `vendor-excludes.txt`). **Our changes are NOT in the tree** —
they live as a patch series in `patches/` and are applied **at build time** into a
throwaway copy. This keeps "what we changed" vs "what upstream ships" unambiguous:
the tree is theirs, `patches/` is ours.

```
wasm-src/
  code/                 pristine upstream @ pinned SHA (minus excludes)
  patches/              our changes, applied at build (see below)
  vendor-excludes.txt   upstream paths removed when vendoring
  PATCHES.md            this file
  run.reference.mjs     headless host reference / smoke test
```

- **Upstream:** https://github.com/nbarkhina/N64Wasm
- **Pinned baseline:** `bfac222f8a27287022844b47000328531834e9c1` (master)

> [!WARNING]
> Because `code/` is pristine, a bare `make` inside `code/` compiles **without**
> our exports and produces a wasm the host can't drive. **Always build via
> `scripts/build-wasm.sh`** (or the Dagger image build), which applies `patches/`
> first.

## Patches (`patches/`)

Applied in order with `patch -p1` (paths are `a/code/… b/code/…`):

| Patch | Touches | What it does |
| --- | --- | --- |
| `0001-mymain-neil-host-exports.patch` | `code/mymain.cpp` | Adds the `extern "C"` host contract (below) and the ROM-from-memory `main()` path. |
| `0002-makefile-exported-functions.patch` | `code/Makefile` | Adds the four exports to `EXPORTED_FUNCTIONS`, and keeps the build outputs in `code/` (drops upstream's `mv … ../dist/`) so the build scripts collect them. Leaves the upstream optimization flags untouched (`ASSERTIONS=0`, no profiling) for a lean prod build. |

The `mymain.cpp` patch adds:

- `neilGetVideoBuffer()` / `neilGetVideoHeight()` — return the address + height of
  the angrylion `get_video_buffer()` frame (640 × H) so the host reads it from
  `HEAPU8` (the pokeemerald-VRAM trick). Two gotchas for consumers:
  - **The 4th byte is not a real alpha.** angrylion's `struct rgba` is `b,g,r,a`
    where `a` is XRGB8888 padding, never initialised (`memset(0)`). Drop it when
    encoding PNGs (emit colour type 2 / RGB) — otherwise it leaks through as
    transparency.
  - **`get_video_buffer()` is not idempotent.** It performs an in-place `b`↔`r`
    swap on the live `prescale` buffer (a fresh copy only in interlaced mode), so
    the channel order the host observes depends on how many times it was called
    since the last full repaint. In practice the two consumers see *different*
    orders, and each is told the truth at its own boundary:
    - **Stream** (read every tick via `onFrame`): the bytes reaching ffmpeg are
      **BGRA** — declaring `-pix_fmt rgba` swaps red/blue in the broadcast (no
      other channel transform exists in the pipeline), so the streamer uses
      `-pix_fmt bgra`.
    - **Screenshot** (`renderFrame`, called on demand): the bytes are **RGBA** —
      colours are already correct, so the PNG encoder writes bytes 0-2 as R,G,B
      verbatim and only drops the dead `a` byte.

    Do not "unify" these by routing both through one cached read without first
    confirming the resulting order on real hardware — the swap count, not the
    naming, is what determines the channel order.
- `neilSetRom(int ptr, int size)` + `volatile g_injectedRom/g_injectedRomSize` —
  inject the ROM bytes from JS; `main()` uses them instead of `fopen`/`fseek`
  (musl stdio `fseek` null-traps under Node). `volatile` defeats an LTO
  constant-fold that would otherwise drop the inject branch.
- `neil_send_mobile_controls_player(int player, controls, axis0, axis1)` +
  `applyHostControls()` — per-player input for headless multi-controller play
  (the stock `neil_send_mobile_controls` only wrote `neilbuttons[0]`). The
  14-char `controls` order is
  `[up,down,left,right,a,b,start,z,l,r,cUp,cDown,cLeft,cRight]`.

  **Why two functions (and a latch):** `mainLoopInner()` calls
  `resetNeilButtons()` near its top *every frame*, then the upstream input path
  re-fills `neilbuttons[*]` from the keyboard/SDL/gamepad — and from JS only
  when `mobileMode` is on (it calls back into JS via `processMobileControls()`
  *after* the reset). Headless runs with `mobileMode = 0` and no physical
  devices, and the host injects input *before* `_runMainLoop()`, so a direct
  write to `neilbuttons[player]` is **wiped by `resetNeilButtons()` before
  `retro_run()` ever polls it** (this silently dropped *all* input — frames
  still rendered, but no button/steer reached the game). So
  `neil_send_mobile_controls_player()` now only **latches** the state into a
  persistent `g_neilHostPads[4]`, and `applyHostControls()` — inserted into
  `mainLoopInner()` *after* every reset and *immediately before* `retro_run()` —
  copies the latch into `neilbuttons[*]`. The host still calls
  `neil_send_mobile_controls_player()` once per tick before `_runMainLoop()`;
  ordering within the frame is handled in C.

## Excludes (`vendor-excludes.txt`)

`code/src/mupen64plus-video-paraLLEl/` and `code/src/mupen64plus-rsp-paraLLEl/` —
the Vulkan parallel-RDP/RSP renderer (incl. a 14 MB generated `slangmosh.hpp`).
Dead code in this build: only referenced behind `#if defined(HAVE_PARALLEL)`,
which the Makefile never defines (we use the angrylion software RDP). Removed to
keep the tree lean and under the repo's 5 MB per-file limit.

## Updating upstream

1. Edit `UPSTREAM_SHA` in `scripts/vendor-n64wasm.sh` to the new commit.
2. Run `scripts/vendor-n64wasm.sh` — it re-clones, applies excludes, refreshes the
   pristine `code/` tree, and verifies the patch series still applies. If a patch
   no longer applies, it stops and names the offending patch; re-base that
   `.patch` against the new source.
3. Rebuild: `scripts/build-wasm.sh`.
4. Smoke-test: `bun wasm-src/run.reference.mjs` (MK64 boots, frames render,
   4-controller input works).

No automated updates — upstream is dormant and this core is frozen; re-vendor
on demand when you want a specific upstream fix.

## Build

`scripts/build-wasm.sh` stages pristine `code/`, applies `patches/`, and runs
`make` inside `emscripten/emsdk` (pinned 2.0.7), emitting `n64wasm.js` +
`n64wasm.wasm` and copying them (plus the MEMFS assets `shader_vert.hlsl`,
`shader_frag.hlsl`, `overlay.png`, `res/arial.ttf`) into the backend's
`assets/n64wasm/`. The CI image build (Dagger, `.dagger/src/image.ts`) does the
same in its emscripten stage.

## Runtime host contract (see `backend/src/emulator/`)

Do **not** define `globalThis.window` — emscripten must run as
`ENVIRONMENT_IS_NODE` only, or the dual WEB+NODE path null-traps `fseek`. The GL
calls go to a stub (no real GPU); the frame is read via `neilGetVideoBuffer`.
