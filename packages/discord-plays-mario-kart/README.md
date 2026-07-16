# Discord Plays Mario Kart 64

A cooperative, [Twitch Plays Pokémon](https://en.wikipedia.org/wiki/Twitch_Plays_Pok%C3%A9mon)–style
bot for [Mario Kart 64](https://en.wikipedia.org/wiki/Mario_Kart_64): up to four
people drive karts in real time from a web UI, and the game is streamed live
into a Discord voice channel.

## How it works

Fully headless — no browser, no emulator UI, no GPU, no desktop:

- **Game** — a patched [N64Wasm](https://github.com/nbarkhina/N64Wasm) core
  (parallel-n64 + the **angrylion** software RDP) is compiled to WebAssembly and
  run in Bun. The ROM is injected straight into wasm linear memory, the core is
  stepped one frame at a time, and the software-rendered RGBA framebuffer is read
  back out of memory — no GPU and no canvas. N64 has no simple PPU like the GBA,
  so a software RDP is the only GPU-free render path.
- **Streaming** — frames are encoded with ffmpeg and pushed to a Discord voice
  channel (Go-Live) via `@shepherdjerred/discord-video-stream` (our in-repo fork
  of
  [`@dank074/discord-video-stream`](https://github.com/dank074/Discord-video-stream))
  using a self-bot, so viewers watch in the voice channel.
- **Input** — the web UI exposes up to **four virtual controllers** (seats
  P1–P4). Players claim a seat and drive with WASD/arrows in real time; inputs
  are sent over Socket.IO and applied per-player each frame. Players navigate the
  in-game menus themselves (character/track/mode select, including 4-player VS).

### Controls

Claim a seat in the web UI, then:

- **Steer** — `A` / `D` (or ←/→), analog
- **Accelerate** — `W` (A button) · **Brake/Reverse** — `S` (B button)
- **Hop/Drift** — `Shift` (R) · **Item** — `E` (Z) · **Start** — `Enter`
- **Camera** — `I` / `J` / `K` / `L` (C-buttons)

## The N64Wasm core

The core is built **from source** in CI — no binaries are committed. The source is
vendored **byte-pristine** under [`wasm-src/code`](./wasm-src) at a pinned upstream
commit; our changes live as a patch series in [`wasm-src/patches/`](./wasm-src/patches)
and are applied **at build time**. [`wasm-src/PATCHES.md`](./wasm-src/PATCHES.md)
records the pinned baseline, the patches, and the update procedure. Our changes:

- `neilSetRom` + a ROM-inject branch (with `volatile` globals so LTO can't fold
  it away) — bypasses the Node `fseek` null-trap by loading the ROM from memory.
- `neilGetVideoBuffer` / `neilGetVideoHeight` — expose the software framebuffer.
- `neil_send_mobile_controls_player(player, controls, axis0, axis1)` + a per-frame
  `applyHostControls()` — per-player input (bounds-checked against
  `NEILNUMCONTROLLERS` = 4). The host call only **latches** input; the core's
  `mainLoopInner()` zeroes `neilbuttons[*]` every frame, so `applyHostControls()`
  re-applies the latch after that reset, right before `retro_run()` polls it.
  Without this, all input is silently dropped (frames still render). See
  [`PATCHES.md`](./wasm-src/PATCHES.md).

[`scripts/build-wasm.sh`](./scripts/build-wasm.sh) compiles
the core into `packages/backend/assets/n64wasm/` using the pinned
`emscripten/emsdk:2.0.7` image — the only build path since the Dagger CI stage was removed 2026-07.

> **Do not define `window`.** The emscripten glue must detect
> `ENVIRONMENT_IS_NODE` only; if it also detects a web environment its FS path
> null-traps `fseek`. See `packages/backend/src/emulator/wasm-host.ts`.

## Testing

The input path — **browser keypress → Socket.IO → backend → emulator → game** —
is covered at three levels:

| Level            | What it proves                                                                                                                                                                             | Where                                                                                         | CI?       |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------- | --------- |
| Frontend mapping | `KeyboardEvent.code` → the `PlayerInputState` the browser ships (KEYMAP / `computeState`, schema-valid)                                                                                    | [`frontend/src/input-map.test.ts`](./packages/frontend/src/input-map.test.ts)                 | ✅        |
| Server plumbing  | a real Socket.IO client → `createSocket` (schema parse) → `handleRequest` → `emulator.setPlayerInput` with the right state; seat gating, schema rejection, release/disconnect clears input | [`backend/src/webserver/dispatch.test.ts`](./packages/backend/src/webserver/dispatch.test.ts) | ✅        |
| Game effect      | input actually advances the running game (boots the real emulator + ROM; holding START moves the title screen → GAME SELECT menu)                                                          | [`backend/scripts/e2e-input.ts`](./packages/backend/scripts/e2e-input.ts)                     | ⛔ manual |

Run the automated tests:

```bash
bun run --filter '*' test    # from packages/discord-plays-mario-kart
```

### Manual harness (needs a ROM + a built core)

These boot the real emulator and need local assets (the ROM is copyright and
not committed; build the core with `scripts/build-wasm.sh`). The **ROM is
resolved** from, in order: an explicit `--rom`/positional arg → `MK64_ROM` env →
`~/syncthing/Sync/roms/mariokart64.z64` (the canonical Syncthing copy — see
[Deployment](#one-time-provisioning)). All three failing prints where to put it.

```bash
cd packages/backend
bun run build:wasm            # compile the core into assets/n64wasm (once)

# Scenario harness — drive the game to a known state and screenshot it.
bun run e2e:scenario                       # list scenarios (menu, 1p, 2p, 3p, 4p)
bun run e2e:scenario 4p --shot /tmp/4p.png # 4-player race; names burned into each quadrant
bun run e2e:scenario 2p --watch            # log state transitions (menu → staging → racing)
bun run e2e:scenario 1p --names Me,Bot     # override the burned-in names

# Lower-level scripts:
bun run e2e:input:check       # baseline vs START, asserts the frame changes (frame-hash)
bun run e2e:race "" 6000 start-mash  # stream raw RDRAM globals (validate the address map)
```

The reusable primitives live in [`backend/scripts/lib/`](./packages/backend/scripts/lib/)
(`resolveRom`, `bootEmulator`, `driveUntil`, `captureScreenshot`); scenarios are
data in [`scenarios.ts`](./packages/backend/scripts/lib/scenarios.ts). Add a
scenario by adding an entry there. **Menu-nav gotcha:** multiplayer character
select blocks until _every_ seat presses A, so the schedules mirror A onto all
N controllers.

## Deployment

Runs on the homelab Kubernetes cluster via ArgoCD
(`packages/homelab/src/cdk8s/src/resources/mario-kart.ts`). Image builds and
pushes are manual (the CI pipeline was removed 2026-07); configuration is a mounted `config.toml` — see
[`config.example.toml`](./config.example.toml). The web UI is reachable at
`mariokart.sjer.red` (and via Tailscale as `mariokart`); the Go-Live stream is
outbound-only.

Software rendering is CPU-heavy and there is no GPU on the node, so the pod
requests 3 CPUs (limit 8) and 2Gi memory (limit 4Gi).

### One-time provisioning

Two things are provisioned out-of-band (by design):

1. **Config secret** — create a 1Password item (vault
   `v64ocnykdqju4ui6j6pua56xw4`) with a `config.toml` field, then replace the
   placeholder item id in `resources/mario-kart.ts`.
2. **ROM** — the canonical copy lives in Syncthing at
   `~/syncthing/Sync/roms/mariokart64.z64` (replicated across your machines; the
   manual harness reads it from there by default). Copy it into the ROM PVC once:

   ```sh
   kubectl cp ~/syncthing/Sync/roms/mariokart64.z64 \
     <pod>:/workspace/packages/discord-plays-mario-kart/roms/mariokart64.z64
   ```

   The ROM is **copyrighted** — it is never baked into the image, committed to
   git (the repo is public + has a 5 MB file limit), or stored in a Secret. You
   must supply your own copy; Syncthing is just where this project keeps it.

> **Self-bot caveat.** Discord blocks video from bot tokens, so Go-Live requires
> a _user_ token. This violates Discord's ToS and the token invalidates on a
> password change — use a dedicated throwaway account and rotate via 1Password +
> `kubectl rollout restart`.

## Disclaimer

A fan project, unaffiliated with Nintendo, Mario Kart, or Twitch Plays Pokémon.
