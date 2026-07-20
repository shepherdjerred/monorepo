---
id: reference-completed-2026-06-19-streambot-youtube-subtitle-cleanup
type: reference
status: complete
board: false
---

# Fix YouTube auto-caption "rolling" subtitle artifact in streambot

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

## Phase 2 — Evidence-driven hardening (2026-06-19)

Closed the "validate against a real _rolling_ ASR track end-to-end" gap. How the ecosystem handles this:
yt-dlp core never fixes it (issues #1734/#6274/#3352); the de-facto fix is the `bindestriche/srt_fix`
postprocessor, whose `dedupe_yt_srt()` uses the **same** cue-level approach we do. Higher tiers exist —
`srv3`/`json3` word-level rebuild (`yttml`, `ytdl2transcript`) and Whisper/WhisperX re-transcription — but
both are wrong for realtime burn-in (viewer-invisible precision / heavy GPU latency), so we stay at Tier 1.

Captured a **real** rolling ASR track (YouTube `aircAruvnKk`, 3Blue1Brown — 491 `<c>` word tags; `ffmpeg`
vtt→srt produced 992 doubled cues). Ran it through `cleanRollingSrt`:

- Detected as rolling (true positive); collapsed to **500 clean single-line cues**.
- **0 degenerate ≤1 ms cues, 0 multi-line cues, 0 adjacent duplicates**; `[Music]` preserved; min cue
  duration 1041 ms (p50 2081 ms) — nothing choppy.
- The 14 ≤2-word cues are all natural sentence endings ("digits.", "multiplication.") shown 1–4 s, so the
  time-aware fragment-merge would _hurt_ readability — **not added**.
- Duration distribution: 90 %+ of cues are ≤3 s (normal subtitle timing), but a small tail lingered — a
  short line held until the next caption, so during a pause / `[Music]` it sat up to ~10 s.

Two changes resulted (no detection/threshold change — detection fired correctly, no choppy fragments):

1. **Grounded the regression suite**: a trimmed slice of the real capture is now a committed fixture in
   `test/subtitle-clean.test.ts`.
2. **Capped on-screen time** at `MAX_CUE_MS` (5 s) in `collapseRollingCaptions`, so a caption clears
   during a long pause instead of lingering stale; the normal 1–4 s majority is untouched (no extra
   flicker). This addresses a review question about long single-word display times.

Decided against (reasons in the harness plan): Tier 2 srv3 rebuild, `srt_fix`'s timing-blind fragment
merge, and Whisper.
