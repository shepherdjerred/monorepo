# discord-plays-core — agent notes

Shared middle layer for the two discord-plays game backends
(`discord-plays-pokemon`, `discord-plays-mario-kart`). Both games implement the
same "headless emulator → ffmpeg → Discord Go-Live" architecture; the parts that
were parallel-evolved identically live here so a fix lands once. Consumed via
`file:` deps by both backends.

Source-only (like `discord-stream-lifecycle`): `package.json#exports` maps `.`
and `./*` straight at `src/`, so there is **no build step** — consumers import
subpaths directly, e.g.
`@shepherdjerred/discord-plays-core/observability/tracing.ts`. The barrel
`src/index.ts` is intentionally empty of re-exports (the repo's
`custom-rules/no-re-exports` rule bans them); it only documents the subpaths.

## Modules

- `observability/tracing.ts` — OTLP tracer init (`initializeTracing({ serviceName,
logger, wrapSpanProcessor? })`), `getTracer`/`withSpan`/`shutdownTracing`.
  Each game injects its winston `logger` and its service name. Pokémon passes
  `wrapSpanProcessor` to insert llm-observability's archive layer around the
  batch span processor — that dependency stays out of core via the hook.
- `observability/metrics.ts` — the shared prom-client `registry` +
  `collectDefaultMetrics` + the emu/stream instruments both games define
  identically (`emulateMs`, `lateMs`, `ticksTotal`, `loopResyncTotal`,
  `sinkBufferBytes`, `streamActive`, `FRAME_MS_BUCKETS`). Games register their own
  extra instruments against the exported `registry` in their own
  `observability/metrics.ts`, and define `copyMs` there too (its help text differs
  per game).
- `stream/audio-transport.ts` — the loopback-TCP PCM transport ffmpeg reads its
  second (audio) input from. Parameterized on `{ format: "s16le" | "f32le",
sampleRate, channels }`; each game wraps `createAudioTransport` with its
  constants.
- `stream/game-streamer-base.ts` — `GameStreamerBase`, the Go-Live streamer
  abstract base (XState desired-stream machine wiring, frameSink→`streamActive`
  sync, audio teardown, start/stop/login/pushAudio, the `deps()` skeleton). Each
  game subclasses it: `pushFrame` and `buildEncoder` are abstract; `afterLeaveVoice`
  (session summary / notify), `playOptions` (attach a StreamObserver),
  `beforeActorStop` (send SHUTDOWN), and `destroyClient` (guarded destroy) are
  overridable hooks (mario-kart uses all four; pokemon uses none).
- `webserver/{express,server}.ts` — `createExpressApp` + `createWebServer<TSocket>`.
  The `/metrics` scrape endpoint and static assets are shared; each game injects its
  own `registry`, `logger`, `assertPathExists`, and `createSocket` (the socket
  dispatch shape differs per game, so it stays game-side).
- `entry.ts` — `bootGameBot({ serviceName, sentryDsn, logger, wiring,
wrapSpanProcessor?, onShutdown? })`: Sentry.init (with `skipOpenTelemetrySetup`)
  → `initializeTracing` → `createGameBot` wiring → SIGTERM/SIGINT handlers. Returns
  the runtime; the game wires its message/socket dispatch and calls
  `runtime.start()`. Mario-kart passes `onShutdown` to disconnect Prisma.

## Stays per-game

Emulators, lifecycle drivers, the goal system (pokemon), seats/leaderboard/overlay
(mario-kart), game-specific metrics, socket dispatch handlers, `copyMs`, and extra
slash commands.

## Verify

`bun run typecheck && bun run test && bunx eslint .` here, plus both game
backends' `bun run typecheck` / `bun run test` (this package is behavior-preserving
for them).
