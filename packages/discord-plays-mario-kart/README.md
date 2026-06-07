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
  channel (Go-Live) via
  [`@dank074/discord-video-stream`](https://github.com/dank074/Discord-video-stream)
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

The core is built **from source** in CI — no binaries are committed. The patched
source is vendored under [`wasm-src/`](./wasm-src); [`wasm-src/PATCHES.md`](./wasm-src/PATCHES.md)
records the upstream baseline and our diffs:

- `neilSetRom` + a ROM-inject branch (with `volatile` globals so LTO can't fold
  it away) — bypasses the Node `fseek` null-trap by loading the ROM from memory.
- `neilGetVideoBuffer` / `neilGetVideoHeight` — expose the software framebuffer.
- `neil_send_mobile_controls_player(player, controls, axis0, axis1)` — per-player
  input (bounds-checked against `NEILNUMCONTROLLERS` = 4).

For local development, [`scripts/build-wasm.sh`](./scripts/build-wasm.sh) compiles
the core into `packages/backend/assets/n64wasm/` using the pinned
`emscripten/emsdk:2.0.7` image. CI does the same in a Dagger emscripten stage.

> **Do not define `window`.** The emscripten glue must detect
> `ENVIRONMENT_IS_NODE` only; if it also detects a web environment its FS path
> null-traps `fseek`. See `packages/backend/src/emulator/wasm-host.ts`.

## Deployment

Runs on the homelab Kubernetes cluster via ArgoCD
(`packages/homelab/src/cdk8s/src/resources/mario-kart.ts`). The image is built in
CI (Dagger); configuration is a mounted `config.toml` — see
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
2. **ROM** — copy your own MK64 ROM into the ROM PVC once:

   ```sh
   kubectl cp mariokart64.z64 \
     <pod>:/workspace/packages/discord-plays-mario-kart/roms/mariokart64.z64
   ```

   The ROM is **copyrighted** — it is never baked into the image, committed to
   git, or stored in a Secret. You must supply your own copy.

> **Self-bot caveat.** Discord blocks video from bot tokens, so Go-Live requires
> a _user_ token. This violates Discord's ToS and the token invalidates on a
> password change — use a dedicated throwaway account and rotate via 1Password +
> `kubectl rollout restart`.

## Disclaimer

A fan project, unaffiliated with Nintendo, Mario Kart, or Twitch Plays Pokémon.
