# Fork `@dank074/discord-video-stream` → `@shepherdjerred/discord-video-stream` and add seamless seek

## Status

Complete (implementation shipped to branch `claude/stoic-almeida-8b7ddf`; pending PR/merge and a
live manual e2e of seamless seek)

## Context

streambot needs a `/stream seek <position>` command, but `@dank074/discord-video-stream@6.0.0`
exposes only `setVolume` + `stopStream` at runtime — **no live seek** (see `packages/streambot/FORK.md`).
The streaming pipeline is `prepareStream` (ffmpeg → PassThrough) → `playStream` (`demux` →
`VideoStream`/`AudioStream` → Go-Live WebRTC `conn`). Seek inherently means restarting ffmpeg with an
`-ss` offset; doing it _without_ dropping the Discord Go-Live stream requires logic inside the library.

So we vendor the library into the monorepo as `packages/discord-video-stream`
(`@shepherdjerred/discord-video-stream`), add a **seekable player** that swaps the ffmpeg source onto
the same Go-Live connection (no visible stream blip), and migrate all three streaming bots
(streambot, discord-plays-pokemon, discord-plays-mario-kart) onto the fork — folding in the existing
`sharp` lazy-load bun patch and deleting the patch files. One owned source of truth.

**Confirmed decisions:** seamless seek (keep Go-Live alive) · rename to `@shepherdjerred/…` ·
migrate all three + drop patches.

## Part 1 — Vendor the library: `packages/discord-video-stream`

Source lives in the installed package (`~/.bun/install/cache/@dank074/discord-video-stream@6.0.0/src`
or `node_modules/...`). Copy `src/` verbatim into `packages/discord-video-stream/src/`.

- **`package.json`**: `name: "@shepherdjerred/discord-video-stream"`, `private: true`, `type: module`,
  `version` (track upstream `6.0.0` + a `-fork.N` suffix). Keep upstream runtime deps verbatim
  (`@lng2004/node-datachannel`, `@snazzah/davey`, `debug-level`, `fluent-ffmpeg`, `node-av`,
  `p-debounce`, `sharp`, `zeromq`), `peerDependencies: discord.js-selfbot-v13`. Dev dep
  `@shepherdjerred/eslint-config: file:../eslint-config`.
  - `exports`: `{ ".": { "types": "./dist/index.d.ts", "default": "./src/index.ts" }, "./*": ... }`
    — bun runs the `.ts` source directly; `tsc` consumers read the generated `.d.ts` (the
    `eslint-config` pattern). Keep the upstream barrel exports (`./client`, `./media`, `Utils`).
  - `scripts`: `build: "tsc -p tsconfig.build.json --emitDeclarationOnly"`, `typecheck`,
    `test: "bun test"`, `lint: "true"` (vendored third-party — not held to our strict rules).
- **License/attribution**: fetch upstream `LICENSE` (ISC) from `dank074/Discord-video-stream`, vendor
  it as `LICENSE`, and add a short `README.md`/`NOTICE` documenting the fork divergence (seekable
  player, `sharp` lazy-load) and original copyright. ISC requires the notice be retained.
- **tsconfig**: `tsconfig.json` extends `../../tsconfig.base.json`; `tsconfig.build.json` for d.ts emit
  to `dist/` (suited to the lib's `.js`-specifier ESM imports). The vendored code uses `as` etc., so
  it must NOT be linted by our config — `lint: true` + ensure it's outside other packages' lint globs.
- **Bake in the sharp fix** in `src/media/newApi.ts`: replace `import sharp from "sharp"` with the
  runtime lazy-`require` shim currently carried by the bun patch
  (`packages/discord-plays-pokemon/patches/@dank074%2Fdiscord-video-stream@6.0.0.patch`). This removes
  any need for a bun patch going forward.

## Part 2 — Add seamless seek to the fork

Refactor + new file `src/media/player.ts`:

- Add first-class `startTime?: number` (seconds) to `PrepareStreamOptions`; when set, inject
  `command.inputOptions(["-ss", String(startTime)])` (fast input-seek, before `-i`). Replaces callers
  hand-rolling `customInputOptions`.
- Extract the "demux `output` → build `VideoStream`/`AudioStream` on `conn` → pipe → done promise"
  block out of `playStream` (lines ~503-636 of `newApi.ts`) into an internal
  `attachPipeline(conn, output, opts)`. **`playStream`/`prepareStream` keep their exact public
  behavior** (pokemon/mario-kart depend on them).
- New `createSeekablePlayer(streamer, input, prepareOpts, playOpts)` → `Player`:
  - `createStream()` **once** → `conn` (Go-Live); first segment via `attachPipeline`.
  - `seek(seconds)`: set a `seeking` guard (so the segment's finish/abort handlers don't resolve
    `finished` or tear down `conn`) → kill current ffmpeg (`command.kill`/abort) → drop the current
    per-segment `VideoStream`/`AudioStream` → `prepareStream(input, {...prepareOpts, startTime: seconds})`
    → `attachPipeline` fresh streams on the **same `conn`**. RTP clock + packetizer live on `conn`, so
    timestamps stay monotonic; new `BaseMediaStream` instances start timing compensation clean.
  - `setVolume(n)` (delegates to the current segment's controller), `stop()` (abort + `stopStream()`),
    `finished` promise (resolves only on natural EOF, rejects on abort).
  - Same-source seek ⇒ identical dimensions/codec, so `setVideoAttributes`/packetizer stay valid.
- Export `createSeekablePlayer` + `Player` from `src/media/index.ts`.
- **Tests** (`bun test`, mock `Streamer`/`conn`): `startTime` → correct `-ss` ffmpeg args; `seek`
  state transitions (kills old segment, builds new, keeps `conn`, doesn't resolve `finished`); natural
  EOF resolves `finished`. The live WebRTC continuity is **manual-only** (needs a real voice session).

## Part 3 — streambot integration (`packages/streambot`)

- `package.json`: `"@dank074/discord-video-stream": "6.0.0"` → `"@shepherdjerred/discord-video-stream":
"file:../discord-video-stream"`.
- `src/streamer/streamer.ts`: import from the new name; drive playback through `createSeekablePlayer`
  instead of separate `prepareStream`/`playStream`. Preserve the existing HW→SW encoder fallback
  (`streamOnce` retry, lines 94-177) by restarting the player with the software encoder on first-attempt
  failure. Add `seek(seconds): Promise<boolean>` (false when nothing is playing) delegating to the live
  player — mirrors the existing `setVolume` side-channel.
- **Seek is a live side-channel, not a machine event** (no persistent state to model — unlike volume,
  which also persists via `SET_VOLUME`). So **no `src/machine/` changes**. Wire like `setVolume`:
  - `src/discord/command-handler.ts`: add `readonly seek: (seconds: number) => Promise<boolean>` to
    `CommandHandlerDeps`; add `case "seek"` + `handleSeek` — gate on `view().current` + `canControlItem`
    (same as `handleSkip`), `parseTimecode(getStringRequired("position"))`, call `deps.seek`, ack
    `⏩ Seeked to <fmt>` / `Nothing is playing.` / `Invalid timestamp…`.
  - `src/discord/commands.ts`: add a `seek` subcommand with a required **string** `position`
    (`90`, `1:30`, `1:02:03`).
  - `src/discord/command-bot.ts` + `src/index.ts`: pass the new `seek` dep through to `streamer.seek`.
- New `src/discord/timecode.ts` (+ `test/timecode.test.ts`): pure `parseTimecode(raw): number | null`
  and `formatTimecode(seconds): string`.
- Handler tests in `test/command-handler.test.ts`: seek denied/allowed (permissions), invalid
  timestamp, nothing-playing.
- Docs: update `FORK.md` (seek now supported via the seamless player) and `AGENTS.md` command surface.

## Part 4 — Migrate pokemon + mario-kart (rename only; no seek)

Both use `Streamer`/`prepareStream`/`playStream` for a continuous rawvideo feed
(`packages/discord-plays-*/packages/backend/src/stream/game-streamer.ts`). For each:

- backend `package.json`: dep → `"@shepherdjerred/discord-video-stream":
"file:../../../discord-video-stream"`; import specifier rename in `game-streamer.ts`.
- nested-root `package.json`: delete the `patchedDependencies` block (lines ~33-35).
- delete `patches/@dank074%2Fdiscord-video-stream@6.0.0.patch`.
- `Dockerfile`/`README.md`: update lib name references (keep `libvips`/`ffmpeg` system deps — sharp
  still transitive).
- Re-run their `bun install` to refresh `bun.lock`.

## Part 5 — Repo / CI wiring

- **Package discovery**: `scripts/run-package-script.ts` auto-walks `packages/`, so the fork is picked
  up for build/test/typecheck/lint once its `package.json` scripts exist (no registration needed).
- **`scripts/setup.ts`**: add a `DAG_TASKS` entry (`bun run build` in `packages/discord-video-stream`,
  `warnOnly: false`) and a verify artifact (`packages/discord-video-stream/dist/index.d.ts`) so d.ts
  exists before dependents typecheck.
- **`.dagger/src/deps.ts`**: add `"discord-video-stream"` to `WORKSPACE_DEPS` for `streambot`,
  `discord-plays-pokemon`, `discord-plays-mario-kart` (so the dep dir is mounted in their image
  builds), and add `"discord-video-stream"` to `BUILD_TIME_DEPS` (it exports types via `dist/`).
- **`knip.json`**: add `packages/discord-video-stream` as a vendored workspace ignore (or minimal
  entry) so knip doesn't flag third-party code.
- Confirm `scripts/guard-no-package-exclusions.ts` / `check-*` don't trip on the vendored package; if
  they do, document the exception rather than weakening the guard.

## Verification

1. `bun run scripts/setup.ts` (builds the fork d.ts, resolves all `file:` deps, refreshes lockfiles).
2. Per-package `bun run typecheck` / `bun run test` / `bun run lint` for: discord-video-stream,
   streambot, discord-plays-pokemon, discord-plays-mario-kart.
3. streambot unit suites: `test/timecode.test.ts`, seek cases in `test/command-handler.test.ts`,
   plus the fork's `player` tests.
4. **Manual e2e (seek is only verifiable live)** — streambot e2e test server (per the documented
   e2e harness/IDs): `/stream play <video>` then `/stream seek 1:30` → playback jumps to 1:30 and the
   Go-Live stream stays up (no restart blip). Smoke pokemon + mario-kart: stream still renders.
5. Dagger: `smoke-test-streambot` + the pokemon/mario-kart image builds (deps mount + no patch).

## Risks / notes

- Seamless seek's WebRTC continuity can't be unit-tested — relies on manual/e2e validation. If RTP
  continuity proves glitchy in practice, the fallback is the lower-risk "restart Go-Live with `-ss`"
  variant (still a real `seek()` API).
- Migrating the two nested monorepos (pokemon/mario-kart) is rename-only but touches their independent
  installs/lockfiles — verify each builds in isolation.
- Keep `prepareStream`/`playStream` byte-for-byte behavior-compatible so the rawvideo bots are
  unaffected by the refactor.

## Out of scope

- Relative seek (`+30`/`-15`), nowplaying position readout, pause — no elapsed-position tracking today.

## Session Log — 2026-06-07

### Done

- Vendored `@dank074/discord-video-stream` 6.0.0 → `packages/discord-video-stream`
  (`@shepherdjerred/discord-video-stream`, `file:` dep). Source-consumed via bun; declaration-only
  `dist` for tsc consumers; ISC `LICENSE` + fork `README`; lazy `sharp` baked into `src/media/newApi.ts`.
- Seek: added `prepareStream` `startTime` (`-ss`), extracted `attachPipeline` from `playStream`, added
  `createSeekablePlayer` (`src/media/player.ts`) — `seek()` restarts ffmpeg at a new offset on the same
  Go-Live connection (reuses conn/packetizer, no `setPacketizer` re-init → RTP continuity). 7 player
  unit tests (injected fakes).
- streambot: streamer now drives playback via the player (`runStream` + HW→SW fallback), added
  `streamer.seek`; `/stream seek` command (string `position`), `handleSeek` (perms mirror skip),
  `timecode.ts` parser/formatter; wired `seek` dep through command-handler/command-bot/index/e2e.
  Tests for seek handler + timecode. Docs: `FORK.md`, `AGENTS.md`.
- Migrated discord-plays-pokemon + discord-plays-mario-kart to the fork (`file:../../../discord-video-stream`),
  deleted both sharp-lazy-load bun patches + `patchedDependencies`, updated Dockerfiles/READMEs, refreshed
  lockfiles.
- Wiring: `.dagger/src/deps.ts` (`WORKSPACE_DEPS` for the 3 consumers + `BUILD_TIME_DEPS`), `setup.ts`
  shared build + verify artifact, and vendored-package exclusions in `knip.json`, `.prettierignore`,
  `.markdownlint-cli2.jsonc`, `scripts/quality-ratchet.ts`, `scripts/check-suppressions.ts`.
- Verified: typecheck/test/lint green for discord-video-stream, streambot, pokemon, mario-kart; all
  global guards pass; committed as `cc26eabb2` with full pre-commit hooks green.

### Remaining

- Open the PR (not yet pushed). Branch base is 3 commits behind `origin/main`.
- Live manual e2e of seamless seek (only verifiable against a real Discord voice session): `/stream
play <video>` then `/stream seek 1:30` — confirm playback jumps and Go-Live stays up (no blip).
  Smoke pokemon + mario-kart streams still render.

### Caveats

- Seamless seek's WebRTC continuity is not unit-testable; player tests cover state transitions only.
  If RTP continuity glitches in practice, fall back to the "restart Go-Live with `-ss`" variant.
- The raw `packages/discord-plays-*/Dockerfile`s can no longer `docker build` standalone (the fork is a
  `file:` dep outside their build context); the canonical build is the Dagger pipeline, which mounts the
  dep. Dockerfiles updated with a note + `COPY patches/` removed.
- Unrelated pre-existing `scripts/ci` typecheck error (`plainStep` in `quality.ts`) exists on the
  3-commits-behind base and is already fixed on `origin/main`; not touched here.
