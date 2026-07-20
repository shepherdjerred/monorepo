---
id: log-2026-06-06-discord-plays-mario-kart
type: log
status: complete
board: false
---

# Discord Plays Mario Kart 64 — headless build-out

## Status Notes (Historical)

Code complete; not yet deployed. New package `packages/discord-plays-mario-kart`
plus full Dagger → ghcr → cdk8s/Helm/ArgoCD wiring. Lands the same headless,
GPU-free, software-rendered pattern as Discord Plays Pokémon — for N64.

Two manual provisioning steps remain before first deploy (both by design — see
**Provisioning**): create the 1Password config item, and `kubectl cp` the ROM.

## Context

The headless Discord-Plays-Pokémon rewrite **landed on `main`** as
[PR #1042](https://github.com/shepherdjerred/monorepo/pull/1042) (`ce89bf8ee`):
`discord-plays-pokemon` is now a plain headless Bun service — `pokeemerald-wasm`
renders frames in software, an `emulator/` wasm-host reads them straight out of
linear memory, `stream/game-streamer.ts` pipes them through ffmpeg into a Discord
Go-Live selfbot, and it deploys via Dagger + cdk8s. That stack is the template
for this package.

A spike proved MK64 runs the same way: a patched **N64Wasm** core (parallel-n64

- angrylion software RDP) compiled to WebAssembly, booted under Bun with the ROM
  injected into wasm memory, stepping `_runMainLoop` per frame and reading the
  RGBA framebuffer out of `HEAPU8` — **no GPU, browser, or desktop**. Measured
  ~120 fps headless on the MacBook; the productionized host booted MK64 at ~160
  fps. N64 has no simple PPU like the GBA, so angrylion's software RDP is the only
  GPU-free render path.

## What shipped

### Package `packages/discord-plays-mario-kart`

Mirrors the discord-plays-pokemon workspace (`packages/{common,backend,frontend}`,
scope `@discord-plays-mario-kart/*`), reusing the game-agnostic pieces (config
loader, webserver, `stream/game-streamer.ts`, selfbot Go-Live wiring, the React
shell + `socket.ts`). Game-specific work:

- **`packages/backend/src/emulator/`** — `N64Emulator` host productionized from
  the spike: `wasm-host.ts` (Node browser/WebGL stubs; **never defines `window`**
  — emscripten must stay `ENVIRONMENT_IS_NODE`-only or `fseek` null-traps),
  `config-txt.ts` (`forceAngry=1`), `constants.ts` (640×240, 14-button order),
  `n64-emulator.ts` (ROM inject via `_malloc`+`HEAPU8.set`+`_neilSetRom`, fixed-
  step loop, per-player input, framebuffer copy-out via `_neilGetVideoBuffer`).
- **Real-time 4-player input** — `common/src/model/input.ts` (`PlayerInputState`,
  seat claim/release + input requests, seat/seats responses); backend
  `input/seat-manager.ts` (socket-id ↔ seat, lowest-free assignment, clears held
  input on disconnect). Each tick serializes all four seats'
  latched state into `neil_send_mobile_controls_player` **immediately before**
  `_runMainLoop` (the core zeroes `neilbuttons[*]` at frame start).
- **Frontend** — self-contained seat selector (P1–P4) + hold-based WASD/arrows
  controller (W=accel/A, S=brake/B, A·D=analog steer, Shift=hop/R, E=item/Z,
  Enter=Start, IJKL=C-buttons). The page is the controller; video is watched in
  the Discord Go-Live stream, exactly like DPP.
- **`wasm-src/`** — the patched N64Wasm source (vendored, full tree). `PATCHES.md`
  records upstream + our diffs: `neilSetRom`, `neilGetVideoBuffer/Height`, the
  ROM-inject branch with `volatile` globals (defeats LTO constant-folding), and
  the new `neil_send_mobile_controls_player(player, controls, axis0, axis1)`
  export (bounds-checked vs `NEILNUMCONTROLLERS`=4). No binaries committed — the
  core is built from source.

### Build + deploy wiring

- **Dagger** (`.dagger/src/image.ts`) — `buildDiscordPlaysMarioKartImageHelper`
  is two-stage: an `emscripten/emsdk:2.0.7` stage runs `make clean && make` in
  `wasm-src/code` (reproducible from source), then a Bun stage (mirrors pokemon:
  ffmpeg + libvips, workspace install, frontend build) copies the compiled
  `n64wasm.{js,wasm}` + MEMFS assets (shaders, overlay, font) into the backend's
  `assets/n64wasm`. `@func` wrappers + `pushDiscordPlaysMarioKartImage` in
  `index.ts`; a `smoke-test-discord-plays-mario-kart` (`.dagger/src/misc.ts`)
  builds the image and boots with a dummy selfbot token expecting `TokenInvalid`.
- **CI catalog** (`scripts/ci/src/catalog.ts`) — added to `IMAGE_PUSH_TARGETS`
  (custom build/push fns), `ALL_PACKAGES`, `PACKAGE_RESOURCES` (MEDIUM),
  `HELM_CHARTS` (`mario-kart`), `DEPLOY_TARGETS`; smoke-fn maps in
  `steps/images.ts`; `WORKSPACE_DEPS` (`["eslint-config"]`) in `.dagger/src/deps.ts`.
- **versions.ts** — `shepherdjerred/discord-plays-mario-kart` placeholder digest
  (CI version-commit-back fills the real one after the first push).
- **cdk8s** — `resources/mario-kart.ts` (`createMarioKartDeployment`): headless
  Deployment, `replicas:1`, `Recreate`, uid/gid 1000, `NODE_ENV=production`,
  **CPU-sized for software render, no GPU** (requests cpu 3 / mem 2Gi, limits
  cpu 8 / mem 4Gi). Volumes: `mario-kart-volume` ZFS 8Gi → `saves/`;
  `mario-kart-rom-volume` ZFS 1Gi → `roms/`; config Secret (`OnePasswordItem`)
  → `config.toml`. `Service`(8081) + `TailscaleIngress`(host `mariokart`) +
  Cloudflare tunnel (`mariokart.sjer.red`). Go-Live is outbound-only (no
  ingress). Registered the chart (`cdk8s-charts/mario-kart.ts` + `setup-charts.ts`)
  and Argo app (`argo-applications/mario-kart.ts` + `cdk8s-charts/apps.ts`); helm
  chart under `helm/mario-kart/`. Cloudflare DNS record for `mariokart` added to
  the tofu module (the tunnel-dns-coverage guard requires it).

## Provisioning (manual, before first deploy)

1. **1Password** — create an item in vault `v64ocnykdqju4ui6j6pua56xw4` with a
   `config.toml` field (server id, `[stream.userbot]` selfbot token + ids,
   `[stream.video]`, `[emulator] rom_path="roms/mariokart64.z64"`, `[web]
port=8081`), then replace the placeholder item id in
   `resources/mario-kart.ts` (`mariokartconfigreplaceme`).
2. **ROM** — `kubectl cp mariokart64.z64
<pod>:/workspace/packages/discord-plays-mario-kart/roms/mariokart64.z64`
   once into the ROM PVC. The ROM is copyrighted — never in the image, git, or a
   Secret.

## Risks / notes

- **Selfbot ToS** — Discord blocks video from bot tokens, so Go-Live needs a
  _user_ token. This violates Discord ToS and the token invalidates on password
  change. Use a dedicated throwaway account; rotate via 1Password +
  `kubectl rollout restart`.
- **Players navigate menus themselves** (by design) — four virtual controllers,
  no savestate/macro. Document the controls.
- **Per-frame input reset ordering** and **heap-view lifetime** — setters must
  run immediately before `_runMainLoop`; copy the framebuffer before any async
  use; never define `window`.
- **No audio in v1** — frames only. Piping
  `_neilGetSoundBufferResampledAddress` → ffmpeg is a stretch goal.

## Future work

- **TODO: rewrite the whole stack in Rust.** Replace the Bun/TypeScript backend
  (emulator host, seat/input model, streaming, web server) with a Rust service.
  Likely shape: run the N64 core natively (an mupen64plus/parallel-n64 binding or
  a Rust N64 core) instead of the emscripten/wasm build, read the software
  framebuffer directly, encode via an ffmpeg binding, and stream over the Discord
  voice path. Goal: lower CPU/memory for the software renderer and a single
  statically-linked binary. Large effort — tracked as a follow-up, not part of
  this PR.
