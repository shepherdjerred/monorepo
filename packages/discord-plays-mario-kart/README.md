# Discord Plays Mario Kart 64

A cooperative, [Twitch Plays Pokémon](https://en.wikipedia.org/wiki/Twitch_Plays_Pok%C3%A9mon)–style
bot for [Mario Kart 64](https://en.wikipedia.org/wiki/Mario_Kart_64): up to four
people drive karts in real time from a web UI, and the game is streamed live
into a Discord voice channel.

## How it works

Fully headless — no browser, no game UI, no desktop:

- **Game** — [SpaghettiKart](https://github.com/HarbourMasters/SpaghettiKart),
  the native PC port of the Mario Kart 64 decompilation, runs as a child process
  with a hidden window and our host-bridge patches. It renders with OpenGL
  through Mesa (the iGPU when present, llvmpipe otherwise) and hands every frame,
  its audio, and its race state to the backend over a Unix socket. A steer shows
  in the very frame that read it.
- **Streaming** — frames are encoded with ffmpeg and pushed to a Discord voice
  channel (Go-Live) via `@shepherdjerred/discord-video-stream` (our in-repo fork
  of
  [`@dank074/discord-video-stream`](https://github.com/dank074/Discord-video-stream))
  using a self-bot, so viewers watch in the voice channel.
- **Driver feed** — how the people driving watch the game. The same frames are
  encoded a second time and pushed over a WebSocket straight into the controller
  page, where the browser decodes them with WebCodecs onto a canvas. That skips
  Discord's voice pipeline and its client-side de-jitter buffer, which was the
  single largest chunk of the input-to-picture delay. The Go-Live stream is for
  spectators and does not depend on the feed. Production enables the feed in its
  GitOps-managed environment; the code default is off, so enable `[driver_feed]`
  in `config.toml` for other deployments.
- **Input** — the web UI exposes up to **four virtual controllers** (seats
  P1–P4). Players claim a seat and drive with WASD/arrows in real time; inputs
  are sent over Socket.IO and applied per-player each frame. Players navigate the
  in-game menus themselves (character/track/mode select, including 4-player VS).

The tracing/metrics wiring, loopback audio transport, Go-Live streamer base
class, web server, and bot entrypoint are shared with discord-plays-pokemon via
[`@shepherdjerred/discord-plays-core`](../discord-plays-core) (source-only,
subpath imports). This backend supplies the MK64-specific pieces: the game
engine, the game driver, seats/leaderboard/name overlay, the richer
ffmpeg/send-path metrics, and the socket dispatch.

See [AGENTS.md](AGENTS.md) for contributor/agent workflow notes.

> **Stay in the voice channel while you play.** The session ends 30 seconds after
> the last human leaves voice — the bot counts voice membership, not stream
> viewers, so watching the driver feed instead of the Discord stream is fine but
> disconnecting from voice is not.

### Controls

Claim a seat in the web UI, then:

- **Steer** — `A` / `D` (or ←/→), analog
- **Accelerate** — `W` (A button) · **Brake/Reverse** — `S` (B button)
- **Hop/Drift** — `Shift` (R) · **Item** — `E` (Z) · **Start** — `Enter`
- **Camera** — `I` / `J` / `K` / `L` (C-buttons)

## The game: SpaghettiKart

[SpaghettiKart](https://github.com/HarbourMasters/SpaghettiKart) is a native PC
port of the Mario Kart 64 decompilation. It replaced a WebAssembly N64 emulator
(N64Wasm) in October 2026. Measured from a key press to the painted frame in the
driver feed, press-to-paint dropped from about 128 ms to about 40 ms.

Only the upstream pin ([`spaghetti-src/upstream.json`](./spaghetti-src/upstream.json))
and our patch series ([`spaghetti-src/patches/`](./spaghetti-src/patches)) are
committed. The patches add a host bridge: the backend owns all four controller
ports over a Unix socket and receives every drawn frame (BGRA, 640×480 square
pixels), the mixed audio (s16 stereo, 26 800 Hz), and a per-frame game-state
record for the leaderboard. [`spaghetti-src/PATCHES.md`](./spaghetti-src/PATCHES.md)
documents the protocol and how to regenerate the patches.

### How a session runs it

`packages/backend/src/engine/` holds the `GameEngine` interface and its
`SpaghettiEngine`. The engine declares a `FrameFormat` (frame size, frame rate,
audio rate); the Go-Live stream, the driver feed, and the overlays size
themselves from it. The HUD clock and name labels are laid out in a 640×240
space, which the browser's HUD decoder reads, and are drawn with every row
doubled on the 640×480 frame.

- **Process.** `SpaghettiEngine` spawns the game per session with a hidden
  window. On Linux it uses SDL's `offscreen` driver: an EGL context with no
  window system, on the iGPU's render node when the pod has one, otherwise
  llvmpipe. Bridge parsing runs on the main thread. Rendering, audio mixing, and
  game logic stay in the game's process.
- **Saves.** The game's home (`SHIP_HOME`) is `saves/<guildId>/spaghettikart/`.
  It writes its EEPROM save (`default.sav`), config, and logs there itself, so
  saves stay per guild.
- **Assets.** `mk64.o2r` is the port's asset archive, extracted from the ROM.
  It follows the ROM's rules: never committed, logged, or baked into an image.
  At startup the backend checks the ROM's SHA-1 against the pin, then extracts
  the archive with the install's Torch into `saves/spaghettikart-assets/`. A
  stamp keyed on the ROM and the pin means later boots reuse it. An unsupported
  ROM or a missing install fails startup, not `/play`.
- **Install.** `[spaghettikart] install_dir` points at the build output, which
  `install.json` describes: the game, its engine archive, Torch and its inputs,
  and the name-label font (Montserrat, SIL OFL, from the port's assets). The
  image ships it at the default `packages/backend/assets/spaghettikart`, built
  by the Dockerfile's `spaghetti-builder` stage from the same pin and patches.

```toml
[spaghettikart]
install_dir = "packages/backend/assets/spaghettikart" # image default
output_fps = 30                                       # 30 or 60 (interpolated)
```

### Building locally

```bash
bun run build:spaghetti        # clone the pin, patch, build; writes .cache/spaghetti/dist/install.json
```

Point `install_dir` at `.cache/spaghetti/dist` to run the backend against a
local build. The ROM-gated harnesses extract `mk64.o2r` into the gitignored
`.cache/spaghetti/assets/`. On macOS, dependencies come from vcpkg as in
upstream CI. On Linux, they come from system packages.

## Testing

The input path — **browser keypress → Socket.IO → backend → engine → game** —
is covered at three levels:

| Level            | What it proves                                                                                                                                                                             | Where                                                                                         | CI?       |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------- | --------- |
| Frontend mapping | `KeyboardEvent.code` → the `PlayerInputState` the browser ships (KEYMAP / `computeState`, schema-valid)                                                                                    | [`frontend/src/input-map.test.ts`](./packages/frontend/src/input-map.test.ts)                 | ✅        |
| Server plumbing  | a real Socket.IO client → `createSocket` (schema parse) → `handleRequest` → `emulator.setPlayerInput` with the right state; seat gating, schema rejection, release/disconnect clears input | [`backend/src/webserver/dispatch.test.ts`](./packages/backend/src/webserver/dispatch.test.ts) | ✅        |
| Engine           | the bridge protocol, the engine's pacing, input-to-frame attribution, snapshots and screenshots against a fake game; process paths and dead-game handling against a fake binary            | [`backend/src/engine/spaghetti/`](./packages/backend/src/engine/spaghetti/)                   | ✅        |
| Game effect      | input actually moves the running game (boots the real port + ROM; a steer shows in the latching frame, a hop shows on the browser canvas)                                                  | `e2e:native-latency`, `e2e:press-to-paint`                                                    | ⛔ manual |

Run the automated tests from the repo root:

```bash
bunx turbo run test --filter='@discord-plays-mario-kart/*'
```

(Don't use `bun run --filter '*' test` from this directory — the package root
is itself the `discord-plays-mario-kart-scripts` workspace, so `'*'` pulls in
that and other monorepo workspaces, not just backend/common/frontend.)

### Manual harness (needs a ROM + a local build)

These run the real game and need local assets: the ROM is copyrighted and not
committed, and the port is built with `bun run --cwd ../.. build:spaghetti`.
The **ROM is resolved** from, in order: an explicit `--rom`/positional arg →
`MK64_ROM` env → `~/syncthing/Sync/roms/mariokart64.z64` →
`~/Sync/Sync/roms/mariokart64.z64` (both Syncthing spellings are checked because
the root differs by machine; the canonical copy lives in Syncthing — see
[Deployment](#one-time-provisioning)). All four failing prints where to put it.

```bash
cd packages/backend
bun run smoke:spaghetti-install ../../.cache/spaghetti/dist  # ROM-free install check
bun run e2e:stream-latency    # synthetic flash/chirp through H.264 + Opus + NUT

# The game's own response to input: lockstep differential + paced wall clock.
bun run e2e:native-latency --seats 4 --fps 30
# Driver feed: real encode + HUD decode, or a real browser tab.
bun run e2e:driver-feed --live --fps 60
bun run e2e:driver-feed:glass
# Key press to painted frame in a real browser (hop on a parked kart).
bun run e2e:press-to-paint --fps 30

# Media / deployment harnesses:
bun run e2e:audio             # Go-Live audio: synthetic sine by default; --rom for real end-to-end
bun run e2e:driver-feed       # driver-feed chain vs real ffmpeg (synthetic frames; --live for real)
bun run e2e:viewer-stats      # receive-side WebRTC stats from a PinchTab Discord viewer tab
bun run smoke                 # run the real container entrypoint (CI image smoke)
```

The shared harness pieces live in [`backend/scripts/lib/`](./packages/backend/scripts/lib/):
ROM resolution, the local build, the lockstep driver and its state-keyed menu
policy, and the browser bench. **Menu-nav gotcha:** multiplayer character
select blocks until _every_ seat presses A, so the policies press A on all N
controllers.

`e2e:stream-latency` isolates the media pipeline owned by this service; it does
not include Discord ingest or playback. It writes a NUT recording and JSON
report to `/tmp` by default, then decodes the recording and compares each
synchronized video flash with its audio chirp. Positive A/V offset means audio
lags video. Use `--audio-delay-ms 100` or `--video-delay-frames 3` to verify
that the analyzer recovers a known delay and sign.

Ordinary sessions expose the same server-side boundaries continuously:
`stream_packet_ready_delay_ms` and `stream_send_complete_delay_ms` measure raw
media availability to encoded packet readiness and RTP completion;
`stream_input_to_packet_ready_ms` and `stream_input_to_send_complete_ms` measure
controller receipt to the first correlated video packet; and
`stream_av_content_offset_ms` measures signed source-content skew. Correlation
failures are explicit in `stream_latency_correlation_failures_total`.

The driver feed has its own boundaries. `driver_feed_frame_to_unit_ms` measures
a composited frame entering the feed to its access unit being ready, and
`driver_feed_input_to_unit_ms` measures controller receipt to the first access
unit reflecting it. `driver_feed_glass_ms` is the browser's own HUD-clock
capture-to-paint reading, corrected by a clock offset estimated from the
controller's ping. `driver_feed_client_decoder_resets_total` counts browser
decoder resets, each of which blanks the picture until the next keyframe.

`e2e:native-latency` measures the part no transport change can touch: how many
frames MK64 takes to show an input. The port has no save states, so it runs two
lockstep instances with identical input, checks
that their pictures stay byte-identical, then steers one. The first draw whose
picture differs is the game's response. A second, paced instance measures wall
time from sending an input to the first frame that latched it.

## Deployment

Runs on the homelab Kubernetes cluster via ArgoCD
(`packages/homelab/src/cdk8s/src/resources/mario-kart.ts`). Image builds and
smokes run in Buildkite; main builds push the deployable image. Configuration
is a mounted `config.toml` — see
[`config.example.toml`](./config.example.toml). The web UI is reachable at
`mariokart.sjer.red` (and via Tailscale as `mariokart`); the Go-Live stream is
outbound-only.

The pod requests the node's Intel iGPU for VAAPI encoding; the game's OpenGL
rendering uses the same render node through Mesa.

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
