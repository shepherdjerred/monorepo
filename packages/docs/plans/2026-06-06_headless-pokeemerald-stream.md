# Headless pokeemerald-wasm streaming for discord-plays-pokemon

## Status

Complete (pending live Discord smoke test + Docker build). All code landed on
`claude/headless-pokeemerald` ([PR #1042](https://github.com/shepherdjerred/monorepo/pull/1042)),
typecheck/test/lint green, emulator render + stream encode verified locally.

## Context

`discord-plays-pokemon` ran Pokémon via **EmulatorJS in a Selenium-driven
Firefox**, captured frames with `driver.takeScreenshot()`, and streamed to
Discord with a **userbot screen-sharing the browser** — forcing a
GPU-accelerated container with a desktop and Firefox.
[tripplyons/pokeemerald-wasm](https://github.com/tripplyons/pokeemerald-wasm)
is Pokémon Emerald recompiled to WASM with a **pure-JS software renderer** that
reads VRAM out of wasm memory into a 240×160 RGBA buffer — no canvas/GPU. This
runs **headless in Bun**: render frames → ffmpeg → Discord voice UDP via
`@dank074/discord-video-stream`, deleting Selenium, Firefox, GPU, and the
screen-share.

Feasibility proven: `WasmRunFrame` 0.011 ms + ported `render()` ~1.4 ms ≈
1.4 ms/frame (~11× headroom over the 16.7 ms GBA budget). The encode path
produces valid H.264 from emulator frames; a live Go-Live stream to a real
voice channel was demonstrated during exploration.

## What changed

| Concern        | Before                    | After                                                 |
| -------------- | ------------------------- | ----------------------------------------------------- |
| Emulation      | EmulatorJS in Firefox     | pokeemerald-wasm in Bun (`src/emulator/`)             |
| Render/capture | Selenium screenshot       | ported software renderer → RGBA buffer                |
| Input          | Selenium keystrokes       | timed button masks → `KEYINPUT` (serial queue)        |
| Video out      | userbot screen-share      | ffmpeg → discord-video-stream Go-Live (`src/stream/`) |
| ROM            | `liquid_crystal.gba`      | built `pokeemerald.wasm` (no copyrighted ROM)         |
| Saves          | EmulatorJS + localStorage | 128 KiB flash region → file                           |
| Container      | GPU + desktop + Firefox   | standard headless Bun + ffmpeg (`Dockerfile`)         |

## Key files

- `packages/backend/src/emulator/` — `emulator.ts` (boot + 60 fps loop + input queue + flash saves), `renderer.ts` (ported PPU), `bios.ts` (BIOS calls), `buttons.ts`, `command-sink.ts`, `png.ts`, `constants.ts`
- `packages/backend/src/stream/game-streamer.ts` — selfbot login + joinVoice + prepareStream(rawvideo) + playStream
- `packages/backend/src/index.ts` — orchestration (emulator + streamer + commands + web socket)
- `packages/backend/src/config/schema.ts` — dropped `browser`/`emulator_url`; userbot `username/password`→`token`; added `stream.video`, `game.wasm_path`/`save_path`
- `scripts/fetch-wasm.ts` — vendors the wasm (gitignored)
- `patches/@dank074%2Fdiscord-video-stream@6.0.0.patch` — lazy-loads sharp
- `Dockerfile` — headless image (Bun + ffmpeg + libvips)

## The sharp gotcha (resolved)

`@dank074/discord-video-stream` hard-imports `sharp` (only used by the unused
`streamPreview`). On bun, sharp eagerly dlopens a native binary that fails when
loaded from bun's global cache (broken `@rpath` to libvips). Fix: a committed
`bun patch` rewrites the eager `import sharp` to a lazy `createRequire` wrapper,
so sharp is never loaded when streamPreview is off. Verified: `prepareStream`
runs through the full encode with sharp never loading. In a clean worktree
install the app imports cleanly; the Linux Docker image also installs system
`libvips42` as belt-and-suspenders.

## Caveats / follow-ups

- **Selfbot token required** — Discord blocks video from bot tokens; the
  streaming account stays (only the browser it drove is gone). Same ToS exposure.
- **Audio:** stream is video-only (the JS port has no sound path).
- **wasm provisioning:** `scripts/fetch-wasm.ts` pulls the published artifact
  from pokeemerald.com (a moving target). Pin a hash or build from source in CI.
- **Not yet run:** the live Discord send (needs a user token) and the Docker
  build on a non-GPU host.

## Verification

- Emulator: boots, renders the Emerald title/overworld pixel-correct, ~1.4 ms/frame.
- Stream: RGBA → ffmpeg → valid H.264 480×320@30 (ffprobe); sharp never loads.
- `bun run typecheck` / `test` (11 pass) / `lint` green across common/backend/frontend.
- Pending: live voice send (user token) and `docker build` + run on a non-GPU host.

## Session Log — 2026-06-06

### Done

- Built the headless emulator (`src/emulator/`) and Go-Live streamer
  (`src/stream/game-streamer.ts`); wired `index.ts`, `/screenshot`, config.
- Deleted the Selenium/EmulatorJS/browser stack and the ROM/ frontend assets;
  removed `selenium-webdriver`; added streaming deps + `trustedDependencies`.
- Resolved the bun+sharp native-load blocker via a committed `bun patch`.
- Added `scripts/fetch-wasm.ts`, `Dockerfile`, `.dockerignore`.
- Landed on `claude/headless-pokeemerald` in phased commits ([PR #1042](https://github.com/shepherdjerred/monorepo/pull/1042));
  typecheck/test/lint green; render + encode verified.

### Remaining

- Run the live Discord send with a fresh user token; confirm command→video loop.
- `docker build` + run on a non-GPU host to validate the Linux native-dep path.
- Optional: audio path; pin/build the wasm reproducibly.

### Caveats

- A real user token was shared in chat during the first (lost) build — it must
  be rotated.
- The first build's work was lost (uncommitted in a deleted worktree); v2 commits
  after every phase to avoid recurrence.
