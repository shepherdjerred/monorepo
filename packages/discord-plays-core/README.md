# @shepherdjerred/discord-plays-core

Shared engine for the two Discord Plays game backends,
[discord-plays-pokemon](../discord-plays-pokemon/) and
[discord-plays-mario-kart](../discord-plays-mario-kart/). Both implement the
same "headless emulator → ffmpeg → Discord Go-Live" architecture; the parts
that were identical in both games live here so a fix lands once.

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
- `src/webserver/` — the shared Express app and web server with the `/metrics`
  scrape endpoint and static assets; each game injects its own registry,
  logger, and socket dispatch.
- `src/entry.ts` — `bootGameBot()`: Sentry init, tracing, bot wiring, and
  SIGTERM/SIGINT handlers in one entrypoint.

## Consumption

Source-only package: `package.json#exports` maps `.` and `./*` directly at
`src/`, so there is no build step and consumers import subpaths (for example
`@shepherdjerred/discord-plays-core/observability/tracing.ts`). Both game
backends depend on it as a `workspace:*` dependency, and this package owns the
`discord-stream-lifecycle` / `discord-video-stream` streaming-stack
dependencies on their behalf. Emulators, lifecycle drivers, game-specific
metrics, and socket handlers stay in the games.

## Commands

Run from `packages/discord-plays-core`:

```bash
bun run test         # bun test test/
bun run typecheck    # tsc --noEmit
bun run lint         # eslint
```

Changes here are behavior-preserving for the games, so also run both backends'
`typecheck` and `test` tasks. See [AGENTS.md](AGENTS.md) for contributor/agent
workflow notes.
