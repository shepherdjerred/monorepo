---
id: 2026-07-25-streambot-playback-outcome-model
type: plan
status: in-progress
board: false
---

# Streambot: complete playback-outcome model + bounded HW-first recovery

Companion log (diagnosis + repro): `packages/docs/logs/2026-07-25_streambot-spiderman3-ffmpeg-exit-218.md`.

## Context

Spider-Man 3 (4K HDR) died ~1.7s in — ffmpeg 7.1.5 VAAPI tonemap reinit bug, exit 218 — and streambot silently pretended the movie ended. The audit that followed found a class of problems: the (video player × discord bot) union machine only truthfully models happy-path EOF and user commands. Every abnormal outcome is swallowed, unmodeled, or dead code:

| #   | Outcome/event                                                                     | Today                                                             | Evidence                                                                       |
| --- | --------------------------------------------------------------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| 1   | ffmpeg crash mid-stream                                                           | Swallowed → clean EOF (`succeed()` wins race vs `fail()`)         | `discord-video-stream/src/media/player.ts:163-170` vs `:135-139`               |
| 2   | Demuxer error mid-extraction                                                      | Swallowed → clean EOF; error only info-logged in fork             | `LibavDemuxer.ts:293-299` → `cleanup():124-134`                                |
| 3   | ffmpeg exit-0 on truncated source (URL expiry etc.)                               | Swallowed → "complete"; `loop:"track"` = infinite truncated loop  | duration probed but discarded (`resolve.ts:50`, `machine/types.ts:47-59`)      |
| 4   | ffmpeg alive but stalled                                                          | Unmodeled — `streaming` wedges forever; progress age metrics-only | `stream-observer.ts:98-105`; `PRODUCER_STALLED` type has 0 senders, no handler |
| 5   | yt-dlp hang during machine resolve                                                | Unmodeled — `resolving` wedges (machine path has no timeout)      | `sources/ytdlp.ts:202-207`, `playback-machine.ts:395-443`                      |
| 6   | Voice-join handshake never completes                                              | Unmodeled — `joining` wedges (fork promise resolve-only)          | `Streamer.ts:71-105`, `playback-machine.ts:350-374`                            |
| 7   | ffmpeg stderr on failure                                                          | Lost (only fluent-ffmpeg's last line)                             | `newApi.ts:632-641`                                                            |
| 8   | `GUILD_REMOVED`, `CHANNEL_DELETED`, `PRODUCER_FAILED`, `SHUTDOWN`, gateway-health | Handlers modeled, zero dispatchers                                | `command-bot.ts:117-128`                                                       |

Goals: (1) HW accel stays primary; (2) every terminal segment outcome is typed with an explicit, announced machine transition; (3) no state can wedge forever.

## Phase 0 — In-pod experiment results (2026-07-25, pod media-streambot-55d856f889-gptpl)

Video-only repro, `-t 30`, output to /dev/null, `-nostdin`:

| Experiment                                                               | Result                                                                                                                                      |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| E1 baseline (pure-HW graph: `scale_vaapi=p010,tonemap_vaapi`)            | **exit 218** — "Reconfiguring filter graph because hwaccel changed" → "Impossible to convert … 'Parsed_tonemap_vaapi_1' and 'auto_scale_0'" |
| E2a `-ss 1` / E2b `-ss 2`                                                | **both exit 218** — plain HW retry-at-position does NOT clear this file (only `-ss 10` known-good)                                          |
| E3 `hwupload` head, GPU output frames                                    | **exit 218** — same illegal renegotiation                                                                                                   |
| E4 HW decode → system frames → `hwupload,scale_vaapi=p010,tonemap_vaapi` | **exit 0**, speed 1.48x — structurally immune (graph input always SW frames, nothing to renegotiate)                                        |
| P1 pure-HW at `-ss 10 -t 60` (perf)                                      | exit 0, **6.1x** realtime                                                                                                                   |
| P2 E4-variant at `-ss 10 -t 60` (perf)                                   | exit 0, **1.34x** realtime                                                                                                                  |

**Decision:** the hwupload-bounce graph is ~4.5x slower than pure HW (1.34x vs 6.1x) — too tight for peak 4K HDR scenes to be the default, but ideal as a recovery rung: it plays this exact file with GPU decode/tonemap/encode. Recovery ladder therefore uses **pipeline modes**, not a boolean:

> attempt 0 (first play): `hw` → retry 1: `hw` (transient crashes keep full quality) → retry 2: `hw-upload` (reinit-class bugs, still GPU) → retry 3: `sw` (last resort)

## Design: typed segment outcomes

Every stream segment ends in exactly one of: `ended` (exit 0 + drain, position ≈ duration) · `ended-short` (exit 0, position ≪ duration) · `crashed` (nonzero exit / demux error; carries position, exit code, stderr tail) · `aborted` (seek/stop/skip — never an error). `ended-short` and `crashed` route into one bounded recovery ladder: re-resolve + retry at last position (re-resolving regenerates expired network URLs), pipeline mode per the ladder above, then `failed` + announce. Stalls and wedge timeouts convert into the same ladder or a typed failure.

## Phase 1 — Fork: truthful terminal outcomes (`packages/discord-video-stream`)

- `newApi.ts`: exported `FfmpegExitError { exitCode; stderrTail; startTimeSeconds? }`; ring-buffer last ≤50 `command.on("stderr")` lines; reject prepare promise with it in the non-abort error branch (`:631-643`).
- `newApi.ts`: support the `hw-upload` pipeline variant — HW decode without `-hwaccel_output_format vaapi`, graph head `hwupload` (new prepare option; exact shape decided against the existing encoder-settings plumbing).
- `player.ts:163-173`: on `pipeline.done`, await the segment's ffmpeg promise (raced vs `ffmpegSettleTimeoutMs`, default 5000) before settling: resolved/timeout → `succeed()`; rejected → `fail(err)`. Guards unchanged.
- `LibavDemuxer.ts:293-299`: extraction error → `vPipe/aPipe.destroy(err)` so `pipeline.done` rejects; real-EOF path unchanged. Verify `attachPipeline` error wiring (`newApi.ts:986-990`).
- Tests: `test/player.test.ts` per plan.

## Phase 2 — Streamer outcome classification (`packages/streambot/src/streamer/`)

- New `stream-errors.ts`: `StreamCrashError { positionSeconds; pipelineMode; exitCode; stderrTail; kind: "crash" | "ended-short" }`.
- `streamer.ts`: `streamOnce` classifies (started+throw → crash; resolved-but-short → ended-short with 30s+10% tolerance); `runStream` takes `pipelineMode` from input; `StreamCrashError` propagates past the in-streamer startup HW→SW fallback (which remains for pre-start failures).
- Thread `durationSeconds` into `ResolvedSource` (`resolve.ts`, `machine/types.ts`).

## Phase 3 — Machine: recovery ladder + wedge timeouts (`packages/streambot/src/machine/`)

- `types.ts`: context += `crashRetries`, `crashNotice { nonce; kind: retry|gave-up; reason: crash|ended-short|stall; title; positionSeconds; attempt; maxAttempts; pipelineMode }`; `RunStreamInput` += `pipelineMode: "hw" | "hw-upload" | "sw"`; `lastErrorKind` += `crash|stall|timeout`; `PRODUCER_STALLED` gains `positionSeconds`.
- `playback-machine.ts` (`MAX_CRASH_RETRIES = 3`): ladder mapping `crashRetries → pipelineMode` = 0-1: hw, 2: hw-upload, 3: sw (respecting `config.stream.hardwareAcceleration=false` → always sw). `streaming.onError` guarded: retryable → `skipped` + `queueCrashRetry` (re-queue current at head, `resumeSeekSeconds`, notice); else `failed` + notice + reset. `PRODUCER_STALLED` in `streaming` → same ladder. `after` timeouts: resolving 60s, joining 30s, leaving 10s. `resetCrashRetries` on clean end/SKIP/STOP/CHANGE_SUBTITLES/idle.
- Stall sender: `stream-observer`/`session-manager` dispatch `PRODUCER_STALLED{positionSeconds}` on sustained progress age > 20s; re-armed on healthy progress.
- Loop semantics: crashes/ended-short no longer reach `advance`; retries exhausted → `failed → skipped` exits loop with announcement.

## Phase 4 — Feedback + metrics

- `session-manager.ts`: thread `crashNotice` into `StatusSnapshot`.
- `status-reporter.ts`: nonce-deduped announcements — retry: `⚠️ {title} {crashed|stalled|ended early} at {mm:ss} — retrying (attempt {k}/{N}, {mode})…`; give-up: `🛑 {title} failed after {N} retries at {mm:ss}: {reason}` (also when queue continues).
- `metrics.ts`: `streamCrashesTotal{pipelineMode,kind}`; new `streamSegmentsTotal` outcomes.

## Phase 5 — Session/gateway hardening (same PR)

- Wire `guildDelete`/`channelDelete` listeners → `GUILD_REMOVED`/`CHANNEL_DELETED`; wire or delete `PRODUCER_FAILED` + gateway-health dead types; `SHUTDOWN` dispatch-or-delete.

## Phase 6 — Tests + verification

Test matrix: fork player race/timeout/demux-error; streamer classification incl. ended-short matrix + pipelineMode honored; machine ladder (crash@42 → seek 42 hw; rung mapping; exhaustion; stall event; wedge timeouts; loop interactions; notice nonces); status-reporter announcements; resolve duration threading.

Verify: `bunx turbo run typecheck test lint --filter=discord-video-stream --filter=streambot`; `bun run verify -- --affected`. Live: deploy, play Spider-Man 3 (expect crash detected w/ stderr tail → retries → hw-upload rung plays in HW); stall drill (`kill -STOP` ffmpeg → retry ≤20s); wedge drill (hung resolve times out at 60s); SDR sanity (zero announcements, `outcome="ended"`).

## Out of scope

- Upstream ffmpeg trac report (evidence captured; optional follow-up).
- Voice-recovery redesign (already sound).

## Workflow

One PR from worktree `.claude/worktrees/streambot-outcome-model` (branch `feature/streambot-outcome-model`, git-spice).
