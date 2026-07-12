# Streambot subtitle-picker stale-guard fix (PR #1463 greptile P1)

## Status

Complete

## Context

PR #1463 (`feature/streambot-ux`) had one unresolved greptile **P1** thread on
`packages/streambot/src/discord/command-handler.ts:473` ("Stale Same-Title
Picks"), which held the aggregate `buildkite/monorepo/pr` and
`buildkite/monorepo/pr/mag-greptile-review` checks red.

## The bug

`/stream subtitles` opens a track picker built from the currently-playing item's
subtitle candidates, waits up to ~2 minutes for a pick, then dispatches
`CHANGE_SUBTITLES`. The stale-pick guard re-checked, before dispatch, only:

- `nowView.current?.title !== current.title` (display title), and
- source **kind** via `currentSourceKind()` + `trackRefMatchesKind`.

Two distinct items can share a display title (two files with the same name, or a
file→url swap that happens to share a title). The `CHANGE_SUBTITLES` handler
applies to `mustCurrent(context)` — whatever is current when the event is
handled — so a stale sidecar/embedded/ytdlp `trackRef` built from the _old_ item
could pass the title+kind guard and be applied to a _different_ same-title item,
burning the wrong subtitle track or throwing in the exact subtitle resolver.
Object-reference identity is not usable because the machine rebuilds the
`current` object in `resolving.onDone` (playback-machine.ts:416-419).

## The fix (commit 46810ef71)

- Added `sourceIdentity(source)` in `src/sources/source.ts` →
  `file:<path>` / `url:<url>` / `search:<query>`. Semantic identity of the
  underlying item; ignores the per-request subtitle pref; the `kind:` prefix
  makes cross-kind collision impossible (so it also subsumes the old kind check).
- Replaced the `SessionHandle`/`CommandHandlerDeps` dep `currentSourceKind()`
  with `currentSourceId(): string | null` (session-manager, session-types,
  command-bot, EMPTY_HANDLE).
- In `handleSubtitles`: capture `currentSourceId()` when the picker opens, then
  reject the pick if `currentSourceId() !== pickedFromSourceId` at dispatch.
  Removed the now-dead `trackRefMatchesKind` helper and the `SubtitleTrackRef`
  import.
- Tests: rewrote the kind-change guard test to use the id array, added
  same-title-different-file and playback-stopped cases in
  `command-handler.test.ts`; added `sourceIdentity` unit tests in
  `source.test.ts`. The test harness's `currentSourceId` mock accepts an array so
  consecutive reads (open vs. dispatch) can differ.

## Verification

- `bun run typecheck` — clean.
- `bun test test/command-handler.test.ts test/source.test.ts` — 73 pass.
- `bun test test/session-manager.test.ts` — 14 pass.
- `bunx eslint` on all 7 changed files — clean.
- Pre-commit lefthook (gitleaks, check-todos, quality-ratchet, prettier) passed.

## Session Log — 2026-07-11

### Done

- Fixed greptile P1 "Stale Same-Title Picks" (commit 46810ef71), pushed to
  `origin/feature/streambot-ux`.
- Replied on + resolved greptile thread `PRRT_kwDOHf4r4c6QKnFu`.
- Files: `src/sources/source.ts`, `src/discord/command-handler.ts`,
  `src/discord/command-bot.ts`, `src/session/session-types.ts`,
  `src/session/session-manager.ts`, `test/command-handler.test.ts`,
  `test/source.test.ts`.

### Remaining

- Buildkite `buildkite/monorepo/pr` is PENDING (re-triggered by the push); the
  greptile step re-runs inside it. Confirm it (and the greptile re-review) goes
  green.

### Caveats

- The three other P1 threads on this PR (subtitle-menu overflow, stale picker
  changes current item, auto-caption exactness) were already `isResolved:true`
  before this session; only the same-title P1 was open.
