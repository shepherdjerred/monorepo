# Fix YouTube auto-caption "rolling" subtitle artifact in streambot

## Status

Complete (implemented; pending PR review/merge)

## Context

When streambot plays a YouTube video and burns in its captions, the on-screen text was garbled: each
spoken phrase appeared multiple times, a stale line lingered on top, and the two visible lines could
show out of order (reported transcript `hey` / `hello` / `hi` rendering as a doubled, scrambled
two-line scroll).

**Root cause.** streambot has no custom subtitle renderer — it downloads the caption file with `yt-dlp`
and hands the path to ffmpeg's `subtitles=` (libass) filter, which renders it verbatim
(`src/sources/subtitle-io.ts` → `resolveSubtitleForYtdlp`). YouTube **auto-generated** captions
(downloaded because `SUBTITLES_INCLUDE_AUTO_GENERATED` defaults to `true`) use a "rolling" format:
every phrase is emitted several times — built up word-by-word with inline `<…>` timing tags, then a
~10 ms "finalization" cue, then carried as the top line while the next phrase builds on the bottom.
`yt-dlp --convert-subs srt` (which runs ffmpeg's vtt→srt) strips the word tags but **keeps the
duplicated/overlapping cues**, so libass burns the doubled, stale, scrambled display. Manually-uploaded
captions are clean — only auto-captions roll.

Verified locally: `ffmpeg -i rolling.vtt out.srt` reproduces the doubling (and even leaks a stray VTT
timing line into a cue's text); a real manual caption (`Me at the zoo`, `en.vtt`) is clean.

## Approach

A pure, post-download SRT cleaner that detects the rolling signature and collapses it to clean
**single-line** cues (each phrase once, synced to when it's spoken), leaving already-clean files
untouched. It operates on the SRT yt-dlp already produces — no yt-dlp arg change.

- **New `src/sources/subtitle-clean.ts`** (pure, zero-I/O): `parseSrt` (timing-line-driven, tolerant of
  CRLF/BOM/whitespace-padding/index lines), `serializeSrt`, `looksLikeRollingCaptions`
  (carry-over-ratio ≥ 0.3 **or** short-cue-ratio ≥ 0.25, min 4 cues), `collapseRollingCaptions`
  (sliding window of the last 2 emitted lines → robust to new-on-top/bottom, preserves far-apart
  repeats), and `cleanRollingSrt` (returns cleaned SRT or `null` to leave the file alone).
- **Wire-in** `src/sources/subtitle-io.ts` → `resolveSubtitleForYtdlp`: best-effort `cleanRollingSubtitleFile`
  on the staged `.srt` (read → `cleanRollingSrt` → overwrite in place); any failure leaves the original
  (subtitles never abort playback).

## Files

| File                                                           | Change                                             |
| -------------------------------------------------------------- | -------------------------------------------------- |
| `packages/streambot/src/sources/subtitle-clean.ts`             | New pure cleaner                                   |
| `packages/streambot/src/sources/subtitle-io.ts`                | Call cleaner on the staged yt-dlp `.srt`           |
| `packages/streambot/test/subtitle-clean.test.ts`               | New unit tests (incl. real ffmpeg-derived fixture) |
| `packages/streambot/test/subtitle-ytdlp-clean.test.ts`         | New offline e2e with a fake `yt-dlp`               |
| `packages/streambot/integration/subtitles.integration.test.ts` | Burn the cleaned SRT through real libass           |
| `packages/streambot/AGENTS.md`                                 | Subtitles section note                             |

## Verification

- `bun run test` (276 pass), `bun run typecheck`, `bunx eslint .` — all green.
- Real-data checks: detector returns `null` for a real manual caption; collapses real `ffmpeg` vtt→srt
  rolling output to clean single-line cues.
- Integration burn (real libass) runs via `bun run test:integration` / the `testStreambotMedia` Dagger
  target (local Homebrew ffmpeg lacks the libass `subtitles` filter, so it's CI-only).

## Session Log — 2026-06-19

### Done

- Implemented `src/sources/subtitle-clean.ts` (pure SRT parser/detector/collapser/serializer) and wired
  `cleanRollingSubtitleFile` into `resolveSubtitleForYtdlp` (`src/sources/subtitle-io.ts`).
- Added `test/subtitle-clean.test.ts` (13 tests, incl. an ffmpeg-conversion-derived fixture),
  `test/subtitle-ytdlp-clean.test.ts` (offline e2e via fake `yt-dlp`), and a real-libass burn test in
  `integration/subtitles.integration.test.ts`. Updated `AGENTS.md`.
- 276 unit tests pass; typecheck + eslint clean. Validated detector against real data (clean manual
  caption left untouched; real ffmpeg rolling output collapsed correctly).

### Remaining

- CI must run `bun run test:integration` (Dagger `testStreambotMedia`) for the real-libass burn — not
  runnable locally (Homebrew ffmpeg has no libass `subtitles` filter).
- Manual e2e: play a YouTube URL with auto-captions on a real Go-Live stream and confirm captions show
  one clean line at a time.

### Caveats

- Detection is heuristic (signature, not URL). Thresholds were validated against a real manual caption
  (no false positive) and real ffmpeg-converted rolling output (true positive), with comfortable margin,
  but unusual tracks could still slip — tune `SHORT_CUE_MS` / ratios in `subtitle-clean.ts` if needed.
- Collapsing uses SRT cue-level timing (adequate for burned display), not per-word VTT timing. A
  legitimately repeated phrase within the 2-line window collapses (rare; acceptable for ASR captions).
