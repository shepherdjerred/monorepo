# Fix streambot embedded-subtitle extraction (broken cache filename)

## Status

Partially Complete

## Context

Subtitles stopped working for Avengers Endgame (and every other movie with embedded text tracks) after PR #1172 (`708c15c9f`, 2026-06-13) added the embedded-subtitle cache. The cache path stages the extracted SRT to `.<uuid>.srt.tmp` before atomically renaming it to its final `<key>.srt`. ffmpeg picks the output muxer from the **last** filename extension; `.tmp` is unknown, so every extraction fails with:

```
Unable to choose an output format for '/subs-cache/.<uuid>.srt.tmp';
use a standard extension for the filename or specify the format manually.
```

The resolver then falls back to the next-ranked sidecar — for Endgame that's `…en.forced.srt` (forced/alien-language only), so most dialogue has no subtitles. Pre-PR-1172 there was no cache and the uncached path used `<uuid>.srt` (extension intact), which is why it worked before.

The homelab streambot deployment sets `SUBS_CACHE_DIR=/subs-cache` (`packages/homelab/src/cdk8s/src/resources/streambot.ts:117`), so the bug is hot in prod and dormant in any uncached environment.

## The change

Single source file under change: `packages/streambot/src/sources/subtitle-io.ts`.

### 1. Reorder the staging filename so `.srt` is last (the actual fix)

At ~line 248 in `extractEmbeddedTrack`:

```ts
// before
: path.join(path.dirname(cachePath), `.${randomUUID()}.srt.tmp`);

// after
: path.join(path.dirname(cachePath), `.${randomUUID()}.tmp.srt`);
```

Keeps the leading `.` (hidden) and the `.tmp` middle marker (still telegraphs "transient"); just moves `.srt` to the trailing position so ffmpeg's muxer auto-detect succeeds.

### 2. Add `-f srt` to the ffmpeg command (defense-in-depth)

```ts
const extract = await run(
  [
    config.ffmpegPath,
    "-y",
    "-i",
    filePath,
    "-map",
    `0:s:${String(subtitleIndex)}`,
    "-c:s",
    "srt",
    "-f",
    "srt", // NEW — pin the muxer, don't depend on extension
    staging,
  ],
  signal,
);
```

`-c:s srt` already pins the codec; `-f srt` pins the container/muxer. Together they make the call robust against future filename refactors.

## Regression test

`packages/streambot/test/subtitle-cache.test.ts` already asserts `first.path.endsWith(".srt")` (line 110) and still passed under the bug — because the fake `ffmpeg` (lines 73-78) blindly wrote to whatever `dest` it received, while _real_ ffmpeg rejects unknown extensions. The fake is now hardened to mirror real-ffmpeg behaviour:

```sh
for dest in "$@"; do :; done
case "$dest" in
  *.srt) ;;
  *) echo "fake-ffmpeg: dest must end in .srt, got: $dest" >&2; exit 1 ;;
esac
printf '1\n00:00:01,000 --> 00:00:02,000\nhi\n' > "$dest"
```

All three existing tests (`extracts once…`, `re-extracts when source changes`, `without a cache dir…`) now double as the regression test — they would all fail on PR #1172 without §1.

## Files touched

- `packages/streambot/src/sources/subtitle-io.ts` — two small edits in `extractEmbeddedTrack`
- `packages/streambot/test/subtitle-cache.test.ts` — tighten fake ffmpeg

## Baseline & post-deploy watch

User flagged 2026-06-14: **current streambot runtime performance is really good** — startup latency, stream-start time, ffmpeg throughput on the VAAPI pipeline, no observed stutter on 4K HDR. Treat this as the baseline this fix must not regress.

If, after deploy, the user reports any of the following, **this PR is the prime suspect** before looking anywhere else:

- Slow stream start (caches were empty pre-fix; the first play of every film now does a real ffmpeg extraction — expect a one-time multi-second hit per file, then instant on replay)
- ffmpeg CPU spikes during a play (extraction runs concurrently with the VAAPI burn-in pipeline)
- Cache directory growing without bound on the PV (no eviction policy — was never exercised before)
- Subtitles suddenly missing on a film that previously had them (would indicate the rename / `-f srt` change broke the happy path)

Action when triggered: `git revert <merge-commit>` first, debug second. Don't try to forward-fix from a regressed baseline.

## Verification

- `bun test test/subtitle-cache.test.ts` in `packages/streambot` — 3/3 pass.
- `bun run typecheck` in `packages/streambot` — clean.
- `bunx eslint src/sources/subtitle-io.ts test/subtitle-cache.test.ts` — clean.
- Manual end-to-end in homelab after merge & deploy:
  - `kubectl -n media rollout restart deploy/media-streambot`
  - Play Endgame. Expect `extracted embedded subtitle (cached)` + `subtitle selected kind: "embedded"` in logs; no `embedded subtitle extraction failed` warnings.
  - Replay Endgame — expect `embedded subtitle cache hit`, no ffmpeg extraction.

## Out of scope

- The `/subs-cache/` PV currently holds zero usable SRTs and a pile of orphan `.<uuid>.srt.tmp` staging files from PR #1172. They're outside `subsTempDir()`'s startup-sweep scope. Harmless; can be left to expire or filed as a separate one-shot cleanup.

## Session Log — 2026-06-14

### Done

- `packages/streambot/src/sources/subtitle-io.ts` — staging filename `.${uuid}.srt.tmp` → `.${uuid}.tmp.srt`; added `-f srt` to the ffmpeg invocation.
- `packages/streambot/test/subtitle-cache.test.ts` — hardened fake ffmpeg to refuse non-`.srt` dests so this class of bug fails the suite next time.
- Memory: `~/.claude/projects/-Users-jerred-git-monorepo/memory/project_streambot_perf_baseline_2026_06_14.md` capturing the user's "perf is great" baseline and the post-deploy watchlist.
- PR opened: see PR link printed below.

### Remaining

- Merge + deploy + manual e2e on Endgame (see Verification above).

### Caveats

- This is the first time the embedded-subtitle cache path will actually execute in prod; if any perf characteristic regresses (startup latency, CPU during burn-in, PV growth) the user wants a revert before a forward-fix.
