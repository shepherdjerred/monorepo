---
id: reference-completed-2026-06-06-mk64-headless-render-spike
type: reference
status: complete
board: false
---

# MK64 headless software-render spike (discord-plays, N64)

## Question

Can we run **Mario Kart 64** with a **pure-software RDP** (no GPU, no X, no desktop),
read the rendered framebuffer **in-process**, and pipe it to Discord — mirroring the
[headless-pokeemerald](2026-06-06_headless-pokeemerald-stream.md) architecture? GBA was
trivial (simple PPU, hand-ported renderer). N64 has no cheap "read VRAM" path: pixels
come from the RDP rasterizing display lists, so "software rendering" = running a
software RDP (angrylion).

## Verdict

- **Native path: GREEN.** parallel-n64 libretro core + bundled **angrylion** software
  RDP. angrylion presents via a plain memcpy into the libretro `retro_video_refresh`
  callback — **zero OpenGL at runtime**. Confirmed in source (`vdac_write` →
  `retro_return` → `video_cb(prescale, …)`). libretro's own announcement: MK64 runs
  **fullspeed in software on a 2012 Core i5**.
- **WASM path: YELLOW (render-green).** `nbarkhina/N64Wasm` already ships angrylion
  compiled to wasm, single-threaded, with the `prescale` XRGB8888 framebuffer readable
  from JS (same trick pokeemerald uses for VRAM; N64Wasm already does it for audio). A
  deployed browser MK64 build exists. Missing piece: headless/no-canvas frame-export
  packaging for Bun (~days, not invention).

**Recommendation:** ship the **native child-process** path first (lowest risk, mature
renderer, best perf), feeding the _unchanged_ `stream/game-streamer.ts`. Keep WASM as a
later "pure-Bun single-process" optimization.

## What was built (spike/)

- `src/capture.c` — ~230-line headless libretro frontend: `dlopen`s a core, forces
  angrylion + cxd4 LLE RSP via core options, refuses HW render (to surface GPU-only
  cores), captures `video_refresh` frames, times `retro_run`, dumps a PPM.
- `Dockerfile` — builds parallel-n64 from source (arm64 + x86) + the harness. No GPU/X.
- Benchmark ROM: **Driving Strikers 64** (Unlicense, libdragon/Tiny3D, 480i true-color
  — heavier 3D than MK64 single-player; a conservative proxy). MK64 itself is
  copyrighted and not used.

## Empirically confirmed on this machine (Apple-Silicon Docker)

1. Core + angrylion **build natively** for arm64; runtime needs **no GL/X/GPU**.
2. ROM boots headless; the core **never requests a HW render context** with angrylion.
3. Negotiates `XRGB8888` @ `320×240` (MK64's native resolution).
4. angrylion (LLE RDP) + cxd4 (LLE RSP) selected via core options
   (`parallel-n64-gfxplugin=angrylion`, `parallel-n64-rspplugin=cxd4` — note the exact,
   un-hyphenated key; angrylion REQUIRES an LLE RSP or it emits no VI frames).

## Blocked on this machine only (environment, not feasibility)

A live captured frame could **not** be produced on Apple-Silicon Docker:

- arm64 N64 dynarec → **SIGTRAP** on JIT pages (Apple VM W^X / icache under nested virt).
- x86 dynarec under qemu → **SIGSEGV** (self-modifying code).
- Interpreter fallback boots but **does not slice frames per `retro_run`** in this
  parallel-n64 build (the de-libco frame_break path is dynarec-oriented); `video_cb`
  never fires, so no pixels.

On a **real Linux host the dynarec runs**, the frame slice fires `video_cb` every frame
(exactly as RetroArch drives this core daily). The homelab (Linux) is the correct place
to capture real frames — and is the deployment target anyway.

## Reuse from headless-pokeemerald (the whole Discord half)

`stream/game-streamer.ts` (RGBA → ffmpeg rawvideo → `@dank074/discord-video-stream`
Go-Live), `index.ts` orchestration, config schema, headless Bun+ffmpeg Dockerfile, and
the sharp `bun patch`. Only `WIDTH/HEIGHT/fps` constants change (320×240@30). New work:
the emulator/frame-source module + N64 button **and analog-stick** input mapping
(MK64 steering needs the stick, unlike Pokémon's digital pad).

## Next steps

1. Run the existing `spike/` harness on a Linux host (homelab) with
   `M64_CPUCORE=dynamic_recompiler` → capture a real frame + true ms/frame for MK64.
2. If GREEN holds, build `packages/discord-plays-mario-kart` (or a shared core): native
   parallel-n64 child process → shm/pipe RGBA bridge → reused `GameStreamer`.
3. Map N64 controls (incl. analog) to Discord chat commands.

## Session Log — 2026-06-06

### Done

- Resolved native (GREEN) vs WASM (YELLOW) feasibility with 3 research threads + a
  working headless build that confirms the no-GPU software-RDP path and frame plumbing.
- Built reusable capture harness + Dockerfile; identified exact core/options/keys.

### Remaining

- Capture a real frame + perf number on Linux (dynarec); then implement the package.
