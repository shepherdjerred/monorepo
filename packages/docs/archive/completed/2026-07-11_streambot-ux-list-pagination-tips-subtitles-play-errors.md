---
id: plan-2026-07-11-streambot-ux-list-pagination-tips-subtitles-play-errors
type: reference
status: complete
board: true
verification: agent
disposition: active
---

# Streambot: List Pagination, Play Tips, Live Subtitle Change, Play Error Fix

## Context

Four separate quality-of-life issues came up while using `/stream` in Discord (streambot lives in `packages/streambot`):

1. `/stream list` dumps a single truncated text block ("...and 2123 more") instead of letting users page through results — `/stream sources` already has Prev/Next/First/Last buttons, and that pattern should be reused for `list`.
2. `/stream play` with bad input (unsupported site, dead video, garbage text) makes the bot join voice and do nothing, with no error shown — the failure is set on internal machine state but never surfaces to Discord because it happens during `resolving → failed → skipped`, a path the status reporter's active→idle-edge announcer never sees.
3. Users want a rotating pool of usage tips (seek, chapters, list, subtitles, sources, etc.) surfaced on `/stream play`.
4. There's no way to toggle subtitles on/off or change language once a video is already playing — only at the moment of `/stream play`.

This plan covers all four, in one PR since they're small, related touches to the same package.

## Feature 1 — `/stream list` pagination

Generalize the existing `/stream sources` pagination instead of duplicating it (2 near-identical consumers is the trigger to share the code).

- `src/discord/pagination.ts`: rename `SourcesPages` → shared `PaginatedPages` type (`{ header, pages }`); collector/button logic (`sendPaginatedReply`, button ids, 5-min timeout, per-user auth check) is already payload-agnostic — no behavior changes needed there.
- `src/discord/help-text.ts`: add `listPages(entries, query): PaginatedPages`, mirroring `sourcesPages()`. List entries are one-per-line (unlike sources' inline `·`-joined names), so add a `paginateLines()` variant alongside the existing `paginate()`. Page size ~20 entries (matches today's `MAX_LIST` constant), comfortably under Discord's 2000-char limit.
- `src/discord/command-handler.ts`: replace the `"list"` case's `interaction.reply(listText(...))` with `interaction.defer()` + `interaction.replyPaginated(listPages(...))`, matching `handleSources`. Retire `listText()` in favor of `listPagesFor()` to avoid two renderers for the same data.
- Judgment call: also route `/stream search` through the same paginated helper for consistency (currently shares `listText`) — small win, minimal risk, do it in the same pass.

## Feature 2 — Tips footer on `/stream play`

- New file `src/discord/tips.ts`: `export const TIPS: readonly string[]` (~15 entries covering seek, chapters, list/search, playnext, subtitles options, sources, queue management — move/remove/shuffle/loop, nowplaying, volume) and `export function randomTip(): string` using `Math.random()` (consistent with existing `shuffleQueue()` precedent in `queue-ops.ts`). Kept separate from `help-text.ts`, which is scoped to static reference text under a length budget.
- `src/discord/command-handler.ts` `handlePlay()`: append `\n\nTip: ${randomTip()}` to both the playlist-expansion reply and the single-item "Queued/Up next" reply. Only on `play`/`playnext` — no other subcommand gets it.

## Feature 3 — Live subtitle change: `/stream subtitles`

Restart the current source in place rather than reusing the heavier voice-reconnect/session-teardown machinery (that path is for connection loss, not a healthy live change).

- `src/discord/commands.ts`: new `subtitles` subcommand with optional `mode` (on/off) and `language` string options.
- `src/machine/types.ts`: add `CHANGE_SUBTITLES: { type; subtitles: SubtitlePref; positionSeconds: number }` to `PlaybackEvent`.
- `src/machine/playback-machine.ts`: handle `CHANGE_SUBTITLES` only from `streaming`. Actions: rebuild the current `Source` with the new `SubtitlePref` (reuse `withSubtitles()`, moved from `command-handler.ts` to `sources/source.ts` so both layers can import it without a layering violation), set `resumeSeekSeconds = event.positionSeconds` (already-existing one-shot-seek field used for reconnect resume), push the rebuilt source to `queue[0]`, transition to the existing `skipped` state (drops current, dequeues into `resolving`). No new state needed — this exactly reuses the resume/seek pipeline, so the "brief restart glitch" is the same class of interruption a voice reconnect already causes.
- `src/discord/command-handler.ts`: new `handleSubtitles()` — reject if nothing playing or if both options omitted; build `SubtitlePref` via the existing `buildSubtitlePref()` (already generic over enabled/lang strings); permission check like `handleSeek`/`handleChapter`; read live position from `deps.view().positionSeconds`; dispatch `CHANGE_SUBTITLES`; reply immediately ("🔄 Restarting with subtitles updated...").
- `src/discord/command-bot.ts`: no routing change — `subtitles` naturally falls into the existing "requires an active session in the caller's voice channel" branch (not `PLAY_SUBCOMMANDS`, not `STATELESS_SUBCOMMANDS`).
- `src/discord/help-text.ts`: document the new command under the Subtitles section.

## Feature 4 — `/stream play` synchronous pre-validation

Resolve the query before acking, so bad input gets an immediate specific error instead of a silent "Queued".

- `src/discord/command-handler.ts` `handlePlay()`: for the non-playlist path, call `resolvePlayQuery()` first.
  - `file` (library exact match) source: no change — already known-good, keep the instant reply.
  - `url`/`search` source: `defer()`, then run the same yt-dlp resolution (`resolveWithYtdlp`) the machine would have run later. On failure, `editReply` with a specific message and **queue nothing**. On success, dispatch and `editReply` the normal "Queued" message (+ tip footer).
  - Keep the existing `isBlockedSource` check before the yt-dlp call (cheap, no need to shell out for obviously-blocked input).
- **Avoid double-resolving** (critical): thread the pre-resolved result through the queue so the machine's `resolving` state reuses it instead of re-fetching:
  - `src/machine/types.ts`: add optional `preResolved?: ResolvedSource` to `QueuedSource`, `ADD`, `ADD_NEXT`, and `ResolveSourceInput`.
  - `src/machine/playback-machine.ts`: `ADD`/`ADD_NEXT` handlers carry `preResolved` through into the queued item.
  - `src/sources/resolve.ts` `resolveSource()`: if `input.preResolved` is present, skip the yt-dlp/subtitle fetch and return it directly (keep the cheap local `probeAndRecordSourceMetadata` for observability parity).
  - **Required correctness fix**: `requeueCurrent` (used for `loop: track` replay) must strip `preResolved` when putting the current item back on the queue — otherwise a track-loop replay would reuse a possibly-stale/expired resolved URL (e.g. a signed yt-dlp direct-media link) instead of re-resolving.
- Error taxonomy (string-matching yt-dlp's stderr, with a generic fallback bucket so nothing is unhandled):
  - `"Unsupported URL"` → "That site isn't supported. Try `/stream sources` to check, or use a different link."
  - `"Video unavailable"` / `"Private video"` → "That video is unavailable, private, or has been removed."
  - Search with no hits → "No results found for that search."
  - Fallback → "Couldn't queue that: [trimmed stderr, ~200 chars]."
- Apply a bounded timeout (new `PLAY_RESOLVE_TIMEOUT_MS`, ~20-30s) on the pre-validation call so a hanging yt-dlp process doesn't leave the interaction deferred indefinitely.
- Net latency effect: library matches unchanged (zero added latency); URL/search matches move the yt-dlp call earlier (into the ack) rather than adding a second call — first-frame latency is unchanged, only ack timing shifts and becomes conditioned on success.

## Files touched

- `src/discord/command-handler.ts` — list pagination wiring, `handleSubtitles()`, subcommand dispatch split into `runPlaybackCommand`/`runDiscoveryCommand` (complexity/max-lines)
- `src/discord/play-command.ts` — new; `runPlayCommand()` extracted from `command-handler.ts` (tips footer, synchronous pre-validation, error classification)
- `src/discord/queue-text.ts` — new; `chaptersText`/`nowPlayingText`/`queueText` + `PlaybackView`/`QueueItemView` types extracted from `command-handler.ts`
- `src/discord/subtitle-options.ts` — new; `buildSubtitlePref`/`subtitlesSuffix` extracted from `command-handler.ts`
- `src/discord/pagination.ts` — generalized payload type, command-agnostic button ids/messages
- `src/discord/help-text.ts` — `listPages()`, `paginateLines()`, subtitles doc line
- `src/discord/tips.ts` — new
- `src/discord/commands.ts` — new `subtitles` subcommand
- `src/discord/resolve.ts` — new `classifyPlayError()`
- `src/discord/command-bot.ts`, `src/index.ts`, `e2e/run.ts` — wire new `resolvePlaySource` dep
- `src/machine/types.ts` — `CHANGE_SUBTITLES` event, `preResolved` fields
- `src/machine/playback-machine.ts` — `CHANGE_SUBTITLES` handling, `preResolved` threading, cleared after first use in `resolving`'s `onDone` (covers track-loop/queue-loop replay, not just explicit requeue)
- `src/sources/resolve.ts` — `preResolved` short-circuit in `resolveSource()`
- `src/sources/source.ts` — `withSubtitles()` moved here from `command-handler.ts`
- `src/machine/view.ts`, `src/session/session-types.ts` — updated to import `PlaybackView` from `queue-text.ts` (its new home) instead of `command-handler.ts`, to satisfy the repo's no-re-exports lint rule

## Deviation from the original plan

- The `preResolved` staleness fix was moved from `requeueCurrent` (as originally planned) to `resolving`'s `onDone` action instead: `requeueCurrent` only runs for `loop: queue` replays, but `loop: track` replays go through `advance`'s `isTrackReplay` guard directly to `resolving` without touching `requeueCurrent` at all, so the original fix location would have missed that path. Clearing `preResolved` off `current` right after it's consumed in `resolving.onDone` covers every replay path uniformly.
- `command-handler.ts` needed additional extraction beyond the plan (`play-command.ts`, `queue-text.ts`, `subtitle-options.ts`) to stay under the repo's 500-line-per-file and complexity-20 ESLint caps once the `subtitles` subcommand and `run()` dispatch grew.

## Verification

- `cd packages/streambot && bun run typecheck` — clean.
- `cd packages/streambot && bun run test` — 322/322 pass (added tests: list pagination, tips pool, `CHANGE_SUBTITLES` machine transitions + command handler, synchronous pre-validation error taxonomy + `preResolved` short-circuit/staleness).
- `cd packages/streambot && bunx eslint . --fix` — 0 errors.
- Manual Discord verification (buttons, live subtitle restart glitch, actual yt-dlp error text) was **not** performed in this session — no live Discord/bot credentials available in this environment. See Caveats below.

## Session Log — 2026-07-11

### Done

- Implemented all 4 features in `.claude/worktrees/streambot-ux` (branch `feature/streambot-ux`):
  1. `/stream list` pagination (generalized `pagination.ts`, added `listPages()`/`paginateLines()`)
  2. Tips footer on `/stream play`/`playnext` (`src/discord/tips.ts`, 15 tips)
  3. `/stream subtitles` live change (new `CHANGE_SUBTITLES` machine event/transition, reuses resume-seek plumbing)
  4. Synchronous pre-validation for `/stream play` (yt-dlp resolves before acking; `preResolved` threaded through the queue to avoid a double yt-dlp call; specific error messages for unsupported sites/unavailable videos/no search results)
- Refactored `command-handler.ts` (extracted `play-command.ts`, `queue-text.ts`, `subtitle-options.ts`) to stay under the repo's max-lines/complexity ESLint rules after the new subcommand and dispatch logic pushed it over.
- Also had to build `packages/discord-stream-lifecycle`'s `dist/` (missing in this fresh worktree) and manually symlink it into `node_modules` to get `bun run typecheck` working at all — pre-existing environment issue, unrelated to this PR's diff (confirmed via `git stash`).
- All verification green: typecheck clean, 322/322 tests pass, 0 lint errors.

### Remaining

- Manual Discord verification per the plan's Verification section (button clicks, live subtitle restart glitch, real yt-dlp error text for a few real bad URLs/searches) — not done, no live bot access in this session.
- Open a PR for branch `feature/streambot-ux` (not done — awaiting user go-ahead).

### Caveats

- The `discord-stream-lifecycle` `dist/` build + symlink fix I applied only exists in my local `node_modules` for this worktree session — a fresh `bun run scripts/setup.ts` run should reproduce it automatically since it invokes each producer's `build` script; if a future session in a _new_ worktree hits the same `Cannot find module '@shepherdjerred/discord-stream-lifecycle/...'` error, rebuild that package (`cd packages/discord-stream-lifecycle && bun run build`) rather than assuming it's broken.
- The error-message classifier in `classifyPlayError()` (`src/discord/resolve.ts`) is string-matching yt-dlp's stderr, which is inherently version-fragile — flagged in the plan as best-effort, with a generic fallback bucket so no case is left unhandled. If yt-dlp's phrasing drifts, the specific-error buckets may stop matching and fall through to the generic "Couldn't queue that: ..." message (still correct, just less specific).
- `/stream search` now also gets pagination (previously plain truncated text) — a small scope extension beyond the literal ask, justified in the plan as low-risk/high-consistency; flag if this wasn't wanted.
