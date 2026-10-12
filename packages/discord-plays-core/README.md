# @shepherdjerred/discord-plays-core

Shared engine for the two Discord Plays game backends,
[discord-plays-pokemon](../discord-plays-pokemon/) and
[discord-plays-mario-kart](../discord-plays-mario-kart/). Both implement the
same "headless emulator → ffmpeg → Discord Go-Live" architecture plus an
in-browser web UI; the parts that were identical in both games live here so a
fix lands once.

## Modules

- `src/observability/tracing.ts` — OTLP tracer initialization
  (`initializeTracing`), `getTracer`/`withSpan`/`shutdownTracing`, with an
  injectable span-processor wrapper hook.
- `src/observability/metrics.ts` — the shared prom-client registry plus the
  emulator/stream instruments both games record identically; games register
  their extra instruments against the exported registry.
- `src/stream/audio-transport.ts` — the loopback-TCP PCM transport ffmpeg
  reads its audio input from, parameterized on sample format, rate, and
  channels.
- `src/stream/game-streamer-base.ts` — `GameStreamerBase`, the abstract
  Go-Live streamer (XState desired-stream machine wiring, stream-active sync,
  audio teardown, start/stop/login); games implement `pushFrame` and
  `buildEncoder` and may override lifecycle hooks.
- `src/stream/latest-frame-sink.ts` — `LatestFrameSink`, the bounded rawvideo
  source that evicts the oldest frame rather than queueing stale video.
- `src/webserver/server.ts`, `express.ts` — the shared Express app and web
  server with the `/metrics` scrape endpoint and static assets; each game
  injects its own registry, logger, and socket setup.
- `src/webserver/socket.ts` — `createGameSocket()`, the Socket.IO channel both
  web UIs talk to: schema-validated requests, the ping ack with server time,
  and upgrade policing (`destroyUpgrade: false` plus an explicit list of
  upgrade paths other handlers own). Games subscribe to its `events` and own
  dispatch.
- `src/driver-feed/` — the low-latency in-browser video feed. A second ffmpeg
  process encodes the game's frames to H.264 (`encoder.ts`), `flv.ts` and
  `annex-b.ts` cut its output into access units, `hub.ts` fans them out to
  WebSocket clients with per-client keyframe resync and backpressure, and
  `service.ts` (`DriverFeedService`) mounts the route and owns the encoder per
  session. Games describe their frames (size, rate, `bgra`/`rgba`, display
  aspect) and install an admission policy (`setAdmission`); core never decides
  who may watch. `protocol.ts` is the browser-safe wire contract (zod only) the
  frontends import; `config.ts` is the `[driver_feed]` schema and its
  environment overrides; `metrics.ts` holds the shared feed instruments.
- `src/image/png.ts` — dependency-free RGBA→PNG encoder with nearest-neighbour
  scaling, for screenshots; `png-decode.ts` is the matching minimal decoder for
  tests.
- `src/config/load-toml.ts` — `loadTomlConfig()`, which reads and validates a
  game's `config.toml` against its zod schema and fails loudly.
- `src/logger.ts` — the `Logger` interface core logs through, the
  `createGameLogger()` stdout winston logger both games use, and `silentLogger`
  for tests.
- `src/entry.ts` — `bootGameBot()`: Sentry init, tracing, bot wiring, and
  SIGTERM/SIGINT handlers in one entrypoint.

## Consumption

Source-only package: `package.json#exports` maps `.` and `./*` directly at
`src/`, so there is no build step and consumers import subpaths (for example
`@shepherdjerred/discord-plays-core/observability/tracing.ts`). Both game
backends depend on it as a `workspace:*` dependency, and this package owns the
`discord-stream-lifecycle` / `discord-video-stream` streaming-stack
dependencies on their behalf. Emulators, lifecycle drivers, game-specific
metrics, socket dispatch, and admission policy stay in the games.

`src/driver-feed/protocol.ts` imports only `zod`, so the game frontends import
it directly; nothing else under `src/` is browser-safe.

## Commands

Run from `packages/discord-plays-core`:

```bash
bun run test         # bun run test test/
bun run typecheck    # tsc --noEmit
bun run lint         # eslint
```

Changes here are behavior-preserving for the games, so also run both backends'
`typecheck` and `test` tasks. See [AGENTS.md](AGENTS.md) for contributor/agent
workflow notes.
