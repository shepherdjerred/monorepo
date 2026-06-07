# Discord Plays Mario Kart 64 — build-out plan

## Context

We proved (spike) that MK64 runs **headless, GPU-free, software-rendered (angrylion) in WebAssembly under Node**, with frames read straight out of wasm linear memory at **121 fps / 8.3 ms-per-frame** on the MacBook — the same "pokemon-wasm" model, for N64. The pokemon headless rewrite **landed on `main`** (PR #1042, `ce89bf8ee`): `discord-plays-pokemon` is now a headless Bun app — `stream/game-streamer.ts` (ffmpeg → `@dank074/discord-video-stream` Go-Live selfbot), an `emulator/` wasm-host module, a Bun+ffmpeg `Dockerfile`, a Dagger build, and a cdk8s deploy. That stack is our template.

Goal: ship `discord-plays-mario-kart` — a new headless app that streams MK64 to Discord via a user (self) bot and is controlled by up to **4 real-time "virtual web controllers"** (WASD web UI, like Discord-Plays-Pokémon). Players themselves drive the in-game menus into whatever mode they want (incl. 4-player VS) — we just expose 4 controllers. Built + deployed via the existing Dagger → ghcr → cdk8s/Helm/ArgoCD pipeline onto the `torvalds` homelab node (CPU-only; no GPU).

Decisions (confirmed): **4 web seats, players do their own menu nav** (no savestate/macro); **ROM via a dedicated ZFS PVC** populated once with `kubectl cp`; **wasm built from our patched N64Wasm source in Dagger CI** (no committed binaries).

## Step 0 — Base the work on updated main

- In the worktree `~/git/monorepo/.claude/worktrees/mk64-discord-stream`: `git fetch && git rebase origin/main` (or pull) so the headless `discord-plays-pokemon` template is present locally. (Verified merged; this is just syncing the worktree.)
- The N64Wasm spike currently lives at `spike/n64wasm/` in this worktree — it becomes the source for the package's emulator host + vendored core (Step 2).

## Step 1 — Scaffold `packages/discord-plays-mario-kart`

Mirror `packages/discord-plays-pokemon` layout: root workspace + inner `packages/{common,backend,frontend}`, scope `@discord-plays-mario-kart/*`. Copy and rename `pokemon`→`mario-kart`: `package.json`, `bun.lock`, `tsconfig*`, `eslint.config.ts`, `mise.toml`, `.gitignore`, `.dockerignore`, `config.example.toml`, `compose.yml`. Carry over from root `package.json`: `trustedDependencies`, `overrides`, and the **`patchedDependencies` sharp `bun patch`** (`patches/@dank074%2Fdiscord-video-stream@6.0.0.patch`) — `@dank074/discord-video-stream` needs it under Bun.

**Reuse near-verbatim** (game-agnostic) from `discord-plays-pokemon`:

- `packages/common/src/**` — socket request/response model + player/status/login types (extend, see Step 4).
- `packages/backend/src/config/{index.ts}` (TOML loader), `logger.ts`, `util.ts`.
- `packages/backend/src/webserver/**` (express + socket.io + RxJS).
- `packages/backend/src/stream/game-streamer.ts` — **the streamer is reusable as-is**; only the `WIDTH/HEIGHT/SRC_FPS` it imports change (Step 3).
- `packages/backend/src/discord/**` — selfbot Go-Live wiring + optional bot/slash (`/screenshot`, `/help`); drop the chord/discrete-command-input handlers (racing uses real-time hold state).
- `packages/frontend/**` — vite/react shell, container/card/notifications, `socket.ts`, ping loop (extend, Step 5).

## Step 2 — N64Wasm core: per-player input export + Dagger emscripten build

The core is a from-source emscripten build of our patched N64Wasm (parallel-n64 + angrylion). Vendor the **patched source** into the package at `wasm-src/` (the `spike/n64wasm/code/` tree + `PATCHES.md` recording upstream commit + our diffs: `neilSetRom`, `neilGetVideoBuffer/Height`, ROM-inject branch, `volatile` globals).

**Add the per-player input export** in `wasm-src/code/mymain.cpp` (beside `neil_send_mobile_controls`, ~line 1898): `neil_send_mobile_controls_player(int player, char* controls, char* axis0, char* axis1)` writing `neilbuttons[player]` (`player` bounds-checked vs `NEILNUMCONTROLLERS`=4). 14-char button order must match the existing P1 setter: `[up,down,left,right,a,b,start,z,l,r,cUp,cDown,cLeft,cRight]`; analog `axis0=±32000*x`, `axis1=-32000*y`. Add `'_neil_send_mobile_controls_player'` to `EXPORTED_FUNCTIONS` in `code/Makefile`.

- Ordering contract: the core zeroes `neilbuttons[*]` each frame _before_ the input poll — call the setters **immediately before** `_runMainLoop()` each tick (matches the established P1 mobile path).

**Build in Dagger CI** (per decision): a dedicated emscripten stage (`emscripten/emsdk` pinned tag, the same image the spike used) runs `make` in `wasm-src/code/`, producing `n64wasm.js` + `n64wasm.wasm`; copy them (and the FS-staged assets `shader_vert.hlsl`, `shader_frag.hlsl`, `overlay.png`, `res/arial.ttf`) into the app image under the backend's assets dir. No binaries committed.

## Step 3 — Backend: `N64Emulator` host (replaces the GBA `emulator/` module)

Productionize `spike/n64wasm/run.mjs` into `packages/backend/src/emulator/`:

- `wasm-host.ts` — the Node browser/WebGL stubs from run.mjs: CommonJS shims (`require/__filename/__dirname`), `makeGLStub()` (incl. the `getProgramParameter`→0-uniforms and `getActiveUniform` fixes), `fakeCanvas`, `el()`, `screen/document/AudioContext`. **Do NOT define `window`** (must stay `ENVIRONMENT_IS_NODE`-only, or `fseek` null-traps).
- `config-txt.ts` — `buildConfig()` (positional config, `disableAudioSync=0`, `forceAngry=1`).
- `constants.ts` — `FRAME_WIDTH=640`, dynamic height (`_neilGetVideoHeight()` ≈240), `CONTROL_CHARS=14`, target fps.
- `n64-emulator.ts` — `class N64Emulator` with `init()` (load wasm via `Module.wasmBinary`, eval glue, await `onRuntimeInitialized`, write `config.txt` + stage shader/assets into MEMFS, `_malloc`+`HEAPU8.set`+`_neilSetRom`, `callMain(["custom.v64"])`), `start()`/`stop()` (fixed-step accumulator loop at target fps), `onFrame(cb)`, `setPlayerInput(player, state)`. Each tick: for players 0-3 serialize stored input → `_neil_send_mobile_controls_player` (reuse pre-`_malloc`'d scratch buffers), then `_runMainLoop()`, then read `_neilGetVideoBuffer()` → `HEAPU8.subarray(640*h*4)` → **copy** → `onFrame`.

Wire in `index.ts` (forked from pokemon's): create `N64Emulator` + `GameStreamer`, `emu.onFrame(f => streamer.pushFrame(f))`, `streamer.login()/start()`, start the web server, route socket input → `emu.setPlayerInput`.

## Step 4 — Real-time 4-player input model

- `packages/common/src/model/input.ts` (new): `PlayerInputState { buttons{14 bools}, analogX, analogY }`; requests `InputState{seat,state}`, `SeatClaim{seat?}`, `SeatRelease`; responses `Seat{seat|null}`, and `Status.occupiedSeats[4]`. Add to the `common` discriminated unions (replacing the pokemon `command` request).
- `packages/backend/src/input/seat-manager.ts` — socket-id ↔ seat (0-3); lowest-free assignment; on `disconnect` free seat **and zero that player's input** (so a held key doesn't stick). Holds `inputs[4]`.
- `packages/backend/src/input/keymap.ts` — web keys → N64: `W/↑`=A (accel), `S/↓`=B (brake), `A/← D/→`=analogX∓1 (steer), `Shift`=R (hop/drift), `E`=Z (item), `Enter`=Start, `IJKL`=C-buttons (camera).
- `index.ts`: on `InputState` validate socket owns the seat → `seatManager.set` → `emu.setPlayerInput`; on claim/release broadcast seats status.

## Step 5 — Frontend: seats + WASD controls

Reuse the react shell. Add `seat-selector` (P1-P4 free/occupied from status; claim/release; "You are P{n}") and replace the control grid with a **hold-based** MK64 layout (keydown **and** keyup edges via `keyboardjs` + pointer down/up). On any edge, recompute the local `PlayerInputState` and emit one `InputState` (coalesced to ~fps). Video is viewed via the Discord Go-Live stream (page is the controller, like DPP).

## Step 6 — Config schema

`config/schema.ts`: keep `server_id`, `stream` (incl. `userbot{id,token}` selfbot + `dynamic_streaming`), `web`. Replace pokemon's `game` with `emulator{ enabled, rom_path, fps(=30), software_render(=true) }` (wasm assets bundled in image). Update `config.example.toml`.

## Step 7 — Build + homelab deploy (existing conventions)

- **Dagger** (`.dagger/src/image.ts`): `buildDiscordPlaysMarioKartImageHelper` mirroring `buildDiscordPlaysPokemonImageHelper` (Bun base + `apt-get ffmpeg libvips42`, root+backend `bun install`, frontend `bun run build`, entrypoint `bun packages/backend/src/index.ts`) **plus the emscripten wasm stage** (Step 2) copying `n64wasm.{js,wasm}`+assets in. Add `push…` helper; expose both via `@func` in `.dagger/src/index.ts`; add a smoke test in `misc.ts` (dummy config → expect selfbot `TokenInvalid`).
- **CI catalog** (`scripts/ci/src/catalog.ts`): add to `IMAGE_PUSH_TARGETS` (`name: discord-plays-mario-kart`, build/push fns), `ALL_PACKAGES`, `PACKAGE_RESOURCES` (MEDIUM), `HELM_CHARTS` (`mario-kart`), `DEPLOY_TARGETS` (mirror pokemon); `WORKSPACE_DEPS` (`["eslint-config"]`) in `.dagger/src/deps.ts`.
- **versions.ts**: add `"shepherdjerred/discord-plays-mario-kart"` with a placeholder `0.0.0-placeholder@sha256:000…` (CI-managed; version-commit-back fills the real digest after first build).
- **cdk8s** — new `src/resources/mario-kart.ts` `createMarioKartDeployment` (copy post-headless `pokemon.ts`): headless Deployment, `replicas:1`, `Recreate`, non-root uid/gid 1000, `NODE_ENV=production`, **sized resources** `requests{cpu:3,mem:2Gi} limits{cpu:8,mem:4Gi}` (software render is CPU-heavy; no GPU). Volumes: `mario-kart-volume` ZFS 8Gi → `saves/`; **`mario-kart-rom-volume` ZFS 1Gi → `roms/`** (ROM provided via `kubectl cp` once); config Secret (`OnePasswordItem`) → `config.toml`. One `Service`(8081) + `TailscaleIngress`(host `mariokart`) + `createCloudflareTunnelBinding`(`mariokart.sjer.red`) for the web UI; Go-Live is outbound-only (no ingress). New `cdk8s-charts/mario-kart.ts` chart, `helm/mario-kart/{Chart.yaml,values.yaml}`, `argo-applications/mario-kart.ts` (`chart: mario-kart`, `~2.0.0-0`, automated, `CreateNamespace=true`); register both in `cdk8s-charts/apps.ts` / `setup-charts.ts`.
- **Secrets**: new 1Password item (same vault) with a `config.toml` field (server id, `[stream.userbot]` selfbot token + ids, `[stream.video]`, `[emulator] rom_path="roms/mariokart64.z64"`, `[web] port=8081`). **Selfbot caveat (flag to user):** user-token Go-Live violates Discord ToS and tokens invalidate on password change — use a dedicated throwaway account; rotate by updating the 1Password item + `kubectl rollout restart`.

## Step 8 — Docs

Add `packages/docs/logs/2026-06-06_discord-plays-mario-kart.md` (or plan) recording the build-out and noting the pokemon headless update landed (PR #1042). Move the spike's design notes into the package README.

## Verification

1. **Local backend**: `bun packages/backend/src/index.ts` with a local `config.toml` + a ROM path → confirm boot logs `forceAngry: 1`, `Goodname: MARIOKART64`, frame loop runs; `/screenshot` (or a debug dump) yields a real MK64 PNG.
2. **4 controllers**: connect 4 browser tabs, claim P1-P4, verify each seat's WASD drives its kart (steer = analog) — e.g. all 4 visibly moving in a VS race a human set up.
3. **Stream**: with a test selfbot token + voice channel, confirm Go-Live shows live MK64 (reuse `game-streamer.ts`).
4. **Image**: `dagger call build-discord-plays-mario-kart-image` builds (incl. wasm stage) + smoke test passes.
5. **Deploy**: merge → CI pushes image + version-commit-back → ArgoCD syncs `mario-kart`; `kubectl cp` the ROM into the PVC once; web UI reachable at `mariokart.sjer.red`; stream live in Discord.

## Risks

- **Selfbot ToS / token rotation** (above) — dedicated account.
- **Players must navigate menus** themselves into multiplayer (by design) — document the controls.
- **Per-frame input reset ordering** — setters must run immediately before `_runMainLoop`.
- **Heap-view lifetime** — copy framebuffer before async use; never define `window`.
- **No audio** in v1 (frames only); piping `_neilGetSoundBufferResampledAddress` → ffmpeg is a stretch goal.
