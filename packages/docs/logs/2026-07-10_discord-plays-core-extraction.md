# discord-plays-core extraction (PR6, quality wave 2)

## Status

Complete (uncommitted; staged in the `discord-plays-core` worktree).

## Goal

Extract the parallel-evolved middle layer shared by
`packages/discord-plays-pokemon` and `packages/discord-plays-mario-kart` into a
new source-only package `@shepherdjerred/discord-plays-core`
(`packages/discord-plays-core`), reproducing each game's behavior exactly via
parameters/hooks. Both backends implemented the same "headless emulator → ffmpeg
→ Discord Go-Live" architecture with zero shared lines.

## What moved (per module + parameterization)

- **`observability/tracing.ts`** (~169 LOC) — OTLP init / diag logger /
  BatchSpanProcessor / `getTracer` / `withSpan` / `shutdownTracing`. Params:
  `serviceName`, injected `logger`, optional `wrapSpanProcessor(processor)` hook.
  Reconciled the two init paths: kept DPP's **NodeSDK-managed contextManager**
  (its inline note says registering the AsyncLocalStorage manager manually _and_
  via `sdk.start()` caused a boot-time "duplicate registration of API: context"
  error). MK64's manual `contextManager.enable()` + `setGlobalContextManager()`
  was dropped in favor of the NodeSDK path — functionally equivalent, verified by
  MK64's full test suite. Pokemon's llm-observability archive wrap stays in
  pokemon, passed through `wrapSpanProcessor`; core does **not** depend on
  llm-observability.
- **`observability/metrics.ts`** (~67 LOC) — shared `registry` +
  `collectDefaultMetrics` + the emu/stream instruments both games defined
  byte-identically (`emulateMs`, `lateMs`, `ticksTotal`, `loopResyncTotal`,
  `sinkBufferBytes`, `streamActive`, `FRAME_MS_BUCKETS`). Each game keeps
  `copyMs` in its own metrics file because its **help text differs**
  ("render the frame" vs "copy the frame out of wasm memory") — unifying it would
  change one game's `/metrics` output, so it stays game-owned to preserve exact
  scrape output. Games register their extra instruments against the shared
  `registry`.
- **`stream/audio-transport.ts`** (~99 LOC) — the loopback-TCP PCM transport.
  Parameterized on `{ format: "s16le" | "f32le", sampleRate, channels }`; each
  game wraps `createAudioTransport` with its constants (pokemon f32le/13379,
  mario-kart s16le/44100).
- **`stream/game-streamer-base.ts`** (~249 LOC) — `GameStreamerBase`. Owns the
  XState desired-stream machine wiring, the snapshot subscription syncing
  frameSink → `streamActive` + audio teardown, `start`/`stop`/`login`/`pushAudio`,
  and the `deps()` skeleton (join/prepare/run/leave/onFailure). Hooks: `pushFrame`
  - `buildEncoder` abstract; `afterLeaveVoice` (default no-op; MK64 → reset
    metrics + session summary + `notifyStreamSessionEnded`), `playOptions` (default
    bare go-live; MK64 → attach StreamObserver), `beforeActorStop` (default no-op;
    MK64 → send `SHUTDOWN`), `destroyClient` (default bare destroy; MK64 → guarded
    try/catch for the null-connection throw). MK64's bounded-frame-queue
    (`MAX_SINK_BUFFER_BYTES` / `shouldDropFrame`) and hot-path metrics stay in its
    subclass's `pushFrame`. Pokemon's subclass overrides nothing beyond the two
    abstract methods.
- **`webserver/express.ts` + `webserver/server.ts`** (~54 + ~69 LOC) —
  `createExpressApp` + `createWebServer<TSocket>`. The `/metrics` endpoint and
  static-asset serving are shared; each game injects its own `registry`,
  `logger`, `assertPathExists`, and `createSocket` (the socket dispatch shape
  differs per game — DPP returns a bare Observable, MK64 returns `{ events, io }`
  — so `socket.ts` stays game-side). Explicit `Express` / `WebServerHandles<T>`
  return-type annotations avoid a TS "inferred type not portable" error in
  consumers.
- **`entry.ts`** (~131 LOC) — `bootGameBot({ serviceName, sentryDsn, logger,
wiring, wrapSpanProcessor?, onShutdown? })`: Sentry.init (with
  `skipOpenTelemetrySetup`) → `initializeTracing` → `readPeerUserbotIds` →
  `createGameBot` wiring (userbot factory, aloneGraceMs=30000, logger adapter) →
  SIGTERM/SIGINT handlers. Returns the runtime; each game wires its message/socket
  dispatch and calls `runtime.start()`. MK64 passes `onShutdown` to disconnect
  Prisma. Verified the Sentry-before-tracing ordering is preserved (both run
  inside `bootGameBot` in that order, before any traced network work).

Total new package: ~866 src LOC + ~192 test LOC across 9 src modules.

## Files deleted from the games

- `packages/discord-plays-pokemon/packages/backend/src/webserver/express.ts`
- `packages/discord-plays-mario-kart/packages/backend/src/webserver/express.ts`

The games' `observability/{tracing,metrics}.ts`, `stream/{audio-transport,game-streamer}.ts`,
`webserver/index.ts`, and `index.ts` shrank to thin subclass/wrapper/wiring files
(net −1169 lines across both games).

## Wiring

- `.dagger/src/deps.ts` — added `discord-plays-core` (deps: eslint-config,
  discord-video-stream, discord-stream-lifecycle); added it to both games' dep
  lists.
- `scripts/ci/src/catalog.ts` — added `discord-plays-core` to `ALL_PACKAGES`.
- `scripts/compliance-check.sh` — added `packages/discord-plays-core:build`
  exemption (source-only, mirrors discord-stream-lifecycle).
- `scripts/setup.ts` — added `packages/discord-plays-core` to
  `SHARED_PRODUCER_DIRS` so scoped `--group=pokemon/mk64` runs install it.
- `lefthook.yml` — added an `eslint-discord-plays-core` pre-commit job.
- `knip.json` — no change (auto-discovered, same as discord-stream-lifecycle,
  which is also unlisted).
- Both game backends' `package.json` — added
  `"@shepherdjerred/discord-plays-core": "file:../../../discord-plays-core"`.
- New `packages/discord-plays-core/AGENTS.md`; pointer paragraphs added to both
  games' `AGENTS.md`.

## Re-export lint gotcha

`custom-rules/no-re-exports` bans not just `export … from` but also
`export const x = importedIdentifier` and `export type X = ImportedType`. So the
game metrics/tracing/audio-transport files could **not** alias-and-re-export the
shared symbols. Fix: consumers import shared instruments/`registry` directly from
`@shepherdjerred/discord-plays-core/observability/metrics.ts`; the game metrics
files only _define_ game-specific instruments (+ `copyMs`). Tracing wrappers
re-declare `getTracer`/`withSpan`/`shutdownTracing` as thin local functions. The
core barrel `src/index.ts` has no re-exports (doc-only), same convention as dsl.

## Verification (all pass)

- core: `tsc` clean, `eslint` 0 errors, `bun test` 9 pass.
- discord-plays-pokemon backend: `tsc` clean, `bun test` 180 pass / 2 skip / 0 fail.
- discord-plays-mario-kart backend: `tsc` clean, `bun test` 120 pass / 0 fail.
- scripts/ci: `bun test` 313 pass / 0 fail (catalog validated: 36 packages).
- `scripts/compliance-check.sh`: all packages compliant.
- `bun scripts/check-dagger-hygiene.ts`: no violations.
- eslint across all three packages: **0 new errors** (DPP has 4 pre-existing
  errors in `emulator/audio/{analysis,audio-fingerprint}.test.ts` —
  `restrict-plus-operands` — identical to origin/main, untouched by this work).

## Session Log — 2026-07-10

### Done

- Created `packages/discord-plays-core` (`@shepherdjerred/discord-plays-core`):
  package.json/tsconfig/eslint.config, 9 src modules, AGENTS.md, 2 test files.
- Migrated both game backends to consume core (tracing, metrics, audio-transport,
  GameStreamer base class, web server, `bootGameBot` entrypoint); deleted both
  games' `webserver/express.ts`.
- Wired deps.ts, catalog.ts, compliance-check.sh, setup.ts, lefthook.yml, both
  games' package.json + AGENTS.md.
- Full verification green (numbers above). Nothing committed; 45 files staged in
  the worktree.

### Remaining

- Commit + PR (owner/team-lead handles the stack submit).

### Caveats

- The 4 pre-existing DPP audio-test lint errors are out of scope for this
  extraction (different subsystem, identical to main) and were left as-is.
- `.dagger` `tsc` reports "Cannot find type definition file for 'node'" — a
  pre-existing worktree env gap (`.dagger` deps aren't installed by `setup.ts`;
  the module builds in-container). The `deps.ts` edit itself is valid and loads
  with the expected values; `check-dagger-hygiene` passes.
- MK64 tracing lost the manual `context.setGlobalContextManager()` call in favor
  of DPP's NodeSDK-managed contextManager path. Behavior verified equivalent by
  the full MK64 test suite, but worth a glance at live Tempo traces post-deploy to
  confirm span context still propagates across awaits.
