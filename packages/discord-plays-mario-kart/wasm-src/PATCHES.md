# Vendored N64Wasm (patched)

This is a from-source build of **N64Wasm** (nbarkhina/N64Wasm — parallel-n64 +
angrylion software RDP compiled to WebAssembly), patched so it runs **headless
in Node/Bun** with no browser, no GPU, no canvas: the angrylion software
framebuffer is read straight out of wasm linear memory, the ROM is injected via
memory, and up to 4 controllers can be driven per-frame.

Upstream: https://github.com/nbarkhina/N64Wasm (depth-1 clone of `master`).

## Patches (all in `code/`)

`mymain.cpp` (extern "C" exports + main):

- `neilGetVideoBuffer()` / `neilGetVideoHeight()` — return the address + height
  of the angrylion `get_video_buffer()` frame (640 × H, RGBA) so the host reads
  it from `HEAPU8` (the pokeemerald-VRAM trick).
- `neilSetRom(int ptr, int size)` + `volatile g_injectedRom/g_injectedRomSize`
  — inject the ROM bytes from JS; `main()` uses them instead of `fopen`/`fseek`
  (musl stdio `fseek` null-traps under Node). `volatile` defeats an LTO
  constant-fold that would otherwise drop the inject branch.
- `neil_send_mobile_controls_player(int player, controls, axis0, axis1)` —
  per-player variant of the stock `neil_send_mobile_controls` (which only wrote
  `neilbuttons[0]`); writes `neilbuttons[player]` for player 0..3. The 14-char
  `controls` order is `[up,down,left,right,a,b,start,z,l,r,cUp,cDown,cLeft,cRight]`.
  Must be called immediately before `_runMainLoop()` (the core zeroes
  `neilbuttons[*]` at frame start, then polls).

`Makefile`:

- The four exports above added to `EXPORTED_FUNCTIONS`.
- `ASSERTIONS=1 --profiling-funcs` (named wasm frames; drop for a smaller prod build).

## Removed vendored source

- `src/mupen64plus-video-paraLLEl/` and `src/mupen64plus-rsp-paraLLEl/` — the
  Vulkan parallel-RDP/RSP renderer (incl. a 14 MB generated `slangmosh.hpp`
  shader header). Dead code in this build: it's only referenced behind
  `#if defined(HAVE_PARALLEL)`, which the Makefile never defines (we use the
  angrylion software RDP). Removed to keep the vendored tree lean and under the
  repo's 5 MB per-file limit.

## Build

`make` inside `code/` under `emscripten/emsdk` (any recent tag; the spike used
2.0.7). Outputs `n64wasm.js` + `n64wasm.wasm` to `../dist/`. The package's image
build runs this in an emscripten stage and copies the outputs (plus the FS
assets `shader_vert.hlsl`, `shader_frag.hlsl`, `overlay.png`, `res/arial.ttf`)
into the backend's `assets/n64wasm/`. See `scripts/build-wasm.sh`.

## Runtime host contract (see `backend/src/emulator/`)

Do **not** define `globalThis.window` — emscripten must run as
`ENVIRONMENT_IS_NODE` only, or the dual WEB+NODE path null-traps `fseek`. The GL
calls go to a stub (no real GPU); the frame is read via `neilGetVideoBuffer`.
