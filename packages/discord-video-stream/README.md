# @shepherdjerred/discord-video-stream

A vendored fork of [`@dank074/discord-video-stream`](https://github.com/dank074/Discord-video-stream)
`6.0.0`, maintained in this monorepo so the streaming bots (`streambot`,
`discord-plays-pokemon`, `discord-plays-mario-kart`) share one source of truth.

Upstream is licensed ISC (declared in its `package.json`; the repo ships no `LICENSE`
file). The ISC text and original copyright are retained in [`LICENSE`](./LICENSE).

## How this fork differs from upstream

1. **Seekable player** (`src/media/player.ts`) — `createSeekablePlayer()` wraps
   `prepareStream` + `playStream` and exposes `seek(seconds)`. Seek restarts ffmpeg with an
   input `-ss` offset and re-attaches the demux → `VideoStream`/`AudioStream` pipeline onto the
   **same** Go-Live connection, so the Discord stream is not torn down (no visible blip).
   `prepareStream` also gains a first-class `startTime` option for input seeking.
2. **Lazy `sharp` import** (`src/media/newApi.ts`) — `sharp` is loaded on first use via a runtime
   `require` instead of a top-level `import`, because eagerly loading its native binding crashes
   on some bun / global-cache layouts. Previously carried as a committed bun patch in the consumer
   packages; now baked into source. `sharp` is only used by the optional stream-preview path.
3. **`videoFilters` option** (`src/media/newApi.ts`) — `prepareStream` gains `videoFilters?: string[]`,
   appended (via the pure `buildVideoFilterChain`) to the transcoding `-vf` chain right after the
   built-in `scale`, so it composes with scale/encoder filters instead of clobbering them like a raw
   `-vf` in `customFfmpegFlags` would. streambot uses it to burn in subtitles (`subtitles='…'`).

`prepareStream` / `playStream` keep their upstream public behavior; the rawvideo bots
(`discord-plays-*`) use them unchanged.

## Consumption

Consumed as TypeScript source via bun (`exports.default` → `src/index.ts`); `tsc` consumers read
the generated `dist/*.d.ts` (run `bun run build` — declaration-only emit). It is a `file:` workspace
dependency, not published to npm.
