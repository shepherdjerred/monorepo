---
id: reference-completed-2026-06-14-streambot-nowplaying-chapter
type: reference
status: complete
board: false
---

# streambot: `/nowplaying` returns position + current chapter

## Context

`/nowplaying` currently prints title, requester, loop, and volume — nothing about where in the track we are. The user wants it to surface playback position and the current chapter.

Good news: chapters are **already captured** end-to-end (yt-dlp web sources and ffprobe local files both populate `Chapter[]`) and elapsed position is **already tracked** in `Streamer.getPosition()` for resume checkpointing. They just never reach the command handler — the view projection drops `getPosition()` because elapsed time is wall-clock, not XState context. This is a small plumbing change.

## What exists today

| Piece                       | Location                                                    | State                                        |
| --------------------------- | ----------------------------------------------------------- | -------------------------------------------- |
| `/nowplaying` handler       | `packages/streambot/src/discord/command-handler.ts:435-441` | Prints title/requester/loop/volume only      |
| `PlaybackView` type         | `command-handler.ts:97-103`                                 | No position field                            |
| View projection             | `packages/streambot/src/machine/view.ts:13-37`              | Has `chapters`, no `position`                |
| `IDLE_VIEW` fallback        | `session-manager.ts:125`                                    | Needs the new field                          |
| `SessionHandle.view` wiring | `session-manager.ts:422`                                    | Passes only snapshot to `buildPlaybackView`  |
| Live position               | `Streamer.getPosition()` in `streamer/streamer.ts:169-178`  | Already null-safe, segment-aware, seek-aware |
| `Chapter` type              | `sources/chapters.ts:11-17`                                 | `{index, title, startSeconds, endSeconds}`   |
| Timecode formatter          | `discord/timecode.ts:31-39` (`formatTimecode`)              | Reuse — handles `m:ss` and `h:mm:ss`         |

## Changes

### 1. `sources/chapters.ts` — add lookup helper

Add a pure `findChapterAt(chapters, seconds): Chapter | null` next to `toChapters`. Linear scan is fine (chapter counts are tiny). Returns the chapter whose `[startSeconds, nextStart)` window contains `seconds`; null if none match (covers empty `chapters[]` and seconds before the first chapter).

### 2. `command-handler.ts` — extend `PlaybackView`

```ts
export type PlaybackView = {
  readonly state: string;
  readonly current: QueueItemView | null;
  readonly queue: readonly QueueItemView[];
  readonly loop: string;
  readonly volume: number;
  readonly positionSeconds: number | null; // NEW
};
```

### 3. `machine/view.ts` — accept position arg

```ts
export function buildPlaybackView(
  snapshot: PlaybackSnapshot,
  positionSeconds: number | null,
): PlaybackView { … positionSeconds … }
```

### 4. `session/session-manager.ts` — thread `getPosition()`

- `IDLE_VIEW` (line 125): add `positionSeconds: null`.
- `handleFor` (line 422): `view: () => buildPlaybackView(session.actor.getSnapshot(), session.entry.streamer.getPosition())`.

### 5. `command-handler.ts` — render in `nowPlayingText()`

```
**Now playing:** <title> (requested by @user)
**Position:** 4:32 — Chapter 3: <chapter title>     ← only the parts we know
**Loop:** off · **Volume:** 100%
```

Build the position line conditionally:

- `positionSeconds === null` → omit the line entirely.
- Position known, chapter unknown → `**Position:** 4:32`.
- Both known → `**Position:** 4:32 — Chapter <n>: <title>`.

Reuse `formatTimecode` from `discord/timecode.ts`. Do NOT show total duration — we don't reliably have it (last chapter's `endSeconds` is often null on yt-dlp sources and absent for live streams).

### 6. Tests

- Unit test `findChapterAt` in `sources/chapters.test.ts` (empty list, before first chapter, between chapters, in last chapter with null `endSeconds`).
- Update `view.test.ts` (if present) for the new arg + field; assert `IDLE_VIEW.positionSeconds === null`.
- Update command-handler test for `/nowplaying` covering: nothing playing, no chapters, with chapters mid-track, position null (briefly between segments).

## Files touched

- `packages/streambot/src/sources/chapters.ts` (+helper)
- `packages/streambot/src/discord/command-handler.ts` (view type + nowPlayingText)
- `packages/streambot/src/machine/view.ts` (signature)
- `packages/streambot/src/session/session-manager.ts` (IDLE_VIEW + handleFor)
- Matching `.test.ts` files

Search for any other call sites of `buildPlaybackView` (e2e harness uses it per the AGENTS notes) and pass `null` for position there unless the test explicitly exercises a streamer.

## Verification

```bash
# from a worktree
cd .claude/worktrees/streambot-nowplaying-chapter
bun run scripts/setup.ts                              # required in a fresh worktree

cd packages/streambot
bun test                                              # unit suite, incl. new findChapterAt + nowplaying
bun run typecheck
bunx eslint . --fix

# e2e (per memory: project_streambot_e2e_test_server)
# Run `e-2-e-streambot` Dagger job — play a YouTube video with known chapters, invoke /nowplaying
# mid-playback, confirm "Position: m:ss — Chapter N: …" appears.
```

Manual smoke against a real server is the high-confidence check: chapters from yt-dlp can be surprising (some videos have one giant 0-second chapter; some live streams have none).

## Worktree

Multi-file change → create a worktree before editing per `feedback_worktree_path_discipline`:

```bash
git worktree add .claude/worktrees/streambot-nowplaying-chapter \
  -b feature/streambot-nowplaying-chapter origin/main
cd .claude/worktrees/streambot-nowplaying-chapter
bun run scripts/setup.ts
```

## Out of scope

- Total-duration display (would need a separate `durationSeconds` plumbed from `ResolvedSource` — useful but a separate change).
- Progress bar / Discord embed (current output is plain markdown to match siblings like `/queue`, `/chapters`).
- Pausing — there is no pause feature; elapsed = wall-clock, which is why the position arithmetic stays simple.

## Session Log — 2026-06-14

### Done

- `findChapterAt(chapters, seconds)` added to `packages/streambot/src/sources/chapters.ts` (pure, null for empty list / before-first-chapter, last chapter extends to ∞).
- `PlaybackView.positionSeconds: number | null` added in `packages/streambot/src/discord/command-handler.ts`.
- `buildPlaybackView(snapshot, positionSeconds)` in `packages/streambot/src/machine/view.ts` now takes the live position as an explicit arg (it lives outside XState context).
- `packages/streambot/src/session/session-manager.ts`: `IDLE_VIEW` gets `positionSeconds: null`; `handleFor` passes `session.entry.streamer.getPosition()` into `buildPlaybackView`.
- `nowPlayingText()` in `command-handler.ts` now emits a conditional `**Position:** m:ss[ — Chapter n: title]` line — position null → omit; chapter null → time only; both → time + chapter clause.
- Tests added: `test/chapters.test.ts` covers `findChapterAt` (empty / before-first / window / last-extends-to-∞). `test/command-handler.test.ts` covers `/nowplaying` (idle, position-null, position-only, position+chapter, position-before-first-chapter).
- Unit tests pass (49/49 across the two changed files; 266/266 across non-integration tests).
- Type-check clean, ESLint clean.

### Remaining

- Manual Discord e2e against the `e-2-e-streambot` test server (per `project_streambot_e2e_test_server` memory) to confirm the rendered text reads naturally on a real YouTube video with chapters and on a chapter-less video — not run in this session.

### Caveats

- 4 pre-existing integration-test failures in `integration/subtitles.integration.test.ts` and `integration/video-graph.integration.test.ts` are unrelated: host ffmpeg (homebrew 8.1.1) lacks the `subtitles` filter (no libass), so any test that builds a libass filter graph fails with `No such filter: 'subtitles'`. These tests don't touch any code in this change.
- `QueueItemView.chapters` is still only populated for the _currently-playing_ item (per existing comment) — queue items render no chapters. The position display follows the same rule (`/nowplaying` only).
- The chapter window is **inclusive on the start**, **exclusive on the next start** (`[start, next)`). The last chapter extends to infinity even if its `endSeconds` is set — yt-dlp routinely sets the final chapter's `end_time` short of the actual runtime.
