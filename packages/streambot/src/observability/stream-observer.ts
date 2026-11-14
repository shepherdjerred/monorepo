/**
 * Maps the discord-video-stream fork's {@link StreamObserver} callbacks onto Prometheus metrics +
 * structured logs. The fork computes these signals but otherwise only writes them to debug logs;
 * this is the seam that surfaces them.
 *
 * The headline signal is the ffmpeg realtime ratio. Since PR #1196 ffmpeg IS readrate-limited
 * (`-readrate 1`), so ~1.0 is the steady-state ceiling, not idle headroom: values above 1.0 appear
 * only during the initial burst or while catching back up to the wall-clock line after a dip. A
 * sustained value below ~1.0 means production fell behind realtime — either genuinely
 * transcode-bound (the 4K-software-decode case) or consumer backpressure through the zero-slack
 * NUT pipe (see the original investigation). The
 * send-path frametime ratio covers the complementary send-bound case. We derive the ratio from
 * `timemark` (media time) advance vs wall-clock between consecutive progress callbacks rather than
 * trusting fluent-ffmpeg to parse `speed`.
 */

import type { StreamObserver } from "@shepherdjerred/discord-video-stream";
import { logger } from "@shepherdjerred/streambot/util/logger.ts";
import { OwnedPlaybackGauges } from "@shepherdjerred/streambot/observability/owned-playback-gauges.ts";
import {
  createPlaybackDiagnostics,
  type PlaybackDiagnosticContext,
} from "@shepherdjerred/streambot/observability/playback-diagnostics.ts";
import {
  ffmpegBitrateKbps,
  ffmpegFps,
  ffmpegOutTimeSecondsTotal,
  ffmpegProgressAgeSeconds,
  ffmpegSpeedRatio,
  framesBehindScheduleTotal,
  hwDecodeEngaged,
  liveScheduleEventsTotal,
  pipelineQueueDepth,
  playbackBehindSeconds,
  sendFrametimeRatio,
  sendLateFramesTotal,
  sendSyncEventsTotal,
  sendSyncWaitSecondsTotal,
  streamHardware,
} from "@shepherdjerred/streambot/observability/metrics.ts";

const log = logger.child("streamer:metrics");

/** Parse an ffmpeg `timemark` ("HH:MM:SS.ss", possibly negative) to seconds; undefined if unparseable. */
export function parseTimemarkSeconds(timemark?: string): number | undefined {
  if (timemark === undefined) {
    return undefined;
  }
  const sign = timemark.startsWith("-") ? -1 : 1;
  const parts = timemark.replace(/^-/, "").split(":");
  if (parts.length !== 3) {
    return undefined;
  }
  const h = Number(parts[0]);
  const m = Number(parts[1]);
  const s = Number(parts[2]);
  const totalSeconds = h * 3600 + m * 60 + s;
  return [h, m, s].every((n) => Number.isFinite(n))
    ? sign * totalSeconds
    : undefined;
}

/**
 * Whether an ffmpeg command line applied the VAAPI hardware-decode pipeline. Matches the input-side
 * `-hwaccel vaapi` flag or the GPU `scale_vaapi` filter the fork emits when the pipeline engages.
 */
export function commandUsesHardwareDecode(command: string): boolean {
  return /-hwaccel\s+vaapi/.test(command) || command.includes("scale_vaapi");
}

/** Return value of {@link createStreamObserver}: the observer wired to metrics, and a disposer. */
export type StreamObserverHandle = {
  /** Pass to the DVS player's `prepare` and `play` options. */
  observer: StreamObserver;
  /**
   * Stop the internal progress-age timer. Call this whenever the streaming segment ends (in a
   * `finally` block) so stale timers from old segments don't race on the shared gauge after a seek
   * or track change.
   */
  dispose: () => void;
};

/**
 * Seconds of zero ffmpeg progress (process alive, no output) before {@link createStreamObserver}
 * fires its `onStall` callback. Well above the 5 s alert threshold so transient dips alert first
 * without triggering recovery; a full 20 s of silence means the pipeline is genuinely wedged.
 */
export const STALL_AFTER_SECONDS = 20;

/** Cadence of the progress-age watchdog tick. Injectable so tests can drive it deterministically. */
export const PROGRESS_TICK_MS = 1000;

/** ffmpeg diagnostic stderr lines kept per segment for the stall report. */
const STALL_STDERR_TAIL_LINES = 15;

/** ffmpeg's `-progress` protocol: one bare `key=value` per line, reported through `onProgress`. */
const PROGRESS_PROTOCOL_LINE = /^[a-z_0-9]+=/u;

export type StreamObserverOptions = {
  readonly diagnosticContext?: PlaybackDiagnosticContext;
  /** Watchdog cadence. Defaults to {@link PROGRESS_TICK_MS}. */
  readonly progressTickMs?: number;
  /**
   * This segment carries audio only (music over the normal voice connection), so the video-only
   * signals must be **absent rather than zero**.
   *
   * Writing `hw_decode_engaged = 0` for a stream with no picture reads on a dashboard exactly like
   * "hardware decode broke", and a `ffmpeg_fps` pinned at 0 reads like a frozen encoder. Neither is
   * true: there is no video path to report on. The labelled ones (`ffmpeg_fps`,
   * `pipeline_queue_depth{kind:"video"}`) therefore stay absent. Ownership keeps a music
   * segment from overwriting or removing a concurrent video's readings.
   */
  readonly audioOnly?: boolean;
};

export function playbackObserverOptions(
  audioOnly: boolean,
  pipelineMode: PlaybackDiagnosticContext["pipelineMode"],
  offsetSeconds: () => number,
): StreamObserverOptions {
  return {
    audioOnly,
    diagnosticContext: {
      transport: audioOnly ? "voice" : "go-live",
      pipelineMode,
      offsetSeconds,
    },
  };
}

/**
 * Build a {@link StreamObserver} for one streaming segment. `hardware` labels the metrics with the
 * path the segment is attempting. `now` is injectable for deterministic tests. `onStall` (optional)
 * fires — once per silence, re-armed only when the media clock actually advances — after
 * {@link STALL_AFTER_SECONDS} with no ffmpeg progress; it receives the last delivered media
 * timemark in seconds (relative to the current ffmpeg `-ss` offset), or `undefined` if none was
 * parsed, so the caller can resume from the true producer position rather than the wall-clock one
 * (which over-counts when ffmpeg was producing below realtime). Each `onCommand` starts a fresh
 * progress epoch (a `/seek` restarts ffmpeg at a new `-ss`, so its timemark restarts near zero).
 * {@link StreamObserverOptions} carries the watchdog cadence and the audio-only suppression flag.
 *
 * Always call the returned `dispose()` when the segment ends to stop the internal progress-age
 * timer. Without it, each call leaves a live `setInterval` writing to the shared
 * `ffmpegProgressAgeSeconds` gauge, causing stale timers from prior segments to race against the
 * current one after seeks and track changes.
 */
export function createStreamObserver(
  hardware: boolean,
  now: () => number = Date.now,
  onStall?: (lastMediaSeconds: number | undefined) => void,
  options: StreamObserverOptions = {},
): StreamObserverHandle {
  const hw = hardware ? "true" : "false";
  const progressTickMs = options.progressTickMs ?? PROGRESS_TICK_MS;
  const audioOnly = options.audioOnly ?? false;
  const gauges = new OwnedPlaybackGauges();
  const diagnostics = createPlaybackDiagnostics(hw, now, gauges, {
    context: options.diagnosticContext,
    progressAgeSeconds: () =>
      lastProgressWallMs === undefined
        ? 0
        : Math.max(0, now() - lastProgressWallMs) / 1000,
  });
  let disposed = false;
  if (!audioOnly) gauges.set(streamHardware, {}, hardware ? 1 : 0, "min");
  let prevMediaSeconds: number | undefined;
  let prevWallMs: number | undefined;
  let lastProgressWallMs: number | undefined;
  let progressAgeTimer: ReturnType<typeof setInterval> | undefined;
  let stallFired = false;
  // ffmpeg's own account of a stall — reconnect attempts, HTTP errors, demux resyncs — is the only
  // evidence of why a live process stopped producing. A crash carries its tail in the error; a
  // stall has no error, so the observer keeps one. Progress-protocol lines are excluded: they are
  // already metrics and would push every diagnostic out of a bounded tail.
  let stderrTail: string[] = [];

  // Drive the progress-age gauge on a 1s tick: a deadlocked subprocess (stdout+stderr both backed
  // up, ffmpeg blocked on write) stops emitting progress entirely, so the only way the gauge can
  // climb past 5 s — the alert threshold — is by an external timer.
  const startProgressAgeTimer = () => {
    if (progressAgeTimer !== undefined) return;
    progressAgeTimer = setInterval(() => {
      if (lastProgressWallMs === undefined) return;
      const ageSeconds = (now() - lastProgressWallMs) / 1000;
      gauges.set(ffmpegProgressAgeSeconds, {}, ageSeconds, "max");
      if (!stallFired && ageSeconds >= STALL_AFTER_SECONDS) {
        stallFired = true;
        log.warn("ffmpeg progress stalled", {
          ageSeconds,
          lastMediaSeconds: prevMediaSeconds,
          stderrTail: [...stderrTail],
        });
        // Pass the last delivered media position (the frozen timemark), NOT the wall-clock age, so
        // the caller resumes from what ffmpeg actually produced even if it was running below realtime.
        onStall?.(prevMediaSeconds);
      }
    }, progressTickMs);
    progressAgeTimer.unref();
  };

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    if (progressAgeTimer !== undefined) {
      clearInterval(progressAgeTimer);
      progressAgeTimer = undefined;
    }
    diagnostics.dispose();
    gauges.dispose();
  };

  const observer: StreamObserver = {
    onCommand: (command) => {
      if (disposed) return;
      const engaged = commandUsesHardwareDecode(command);
      if (!audioOnly) gauges.set(hwDecodeEngaged, {}, engaged ? 1 : 0, "min");
      diagnostics.reset();
      // The command can contain signed media URLs and HTTP authorization headers.
      log.info("ffmpeg command started", { hwDecodeEngaged: engaged });
      // A new command is a new progress epoch. A `/seek` restarts ffmpeg at a new `-ss` offset, so
      // its output timemark restarts near zero; without resetting the previous media/wall samples,
      // the "media advanced" check would compare the new low timemark against the old (higher) one,
      // never re-arm the watchdog, and fire a false stall on healthy post-seek playback.
      prevMediaSeconds = undefined;
      prevWallMs = undefined;
      stallFired = false;
      stderrTail = [];
      // Treat command start as the initial progress sample so the age gauge is meaningful before
      // the first onProgress callback (which can be > 1s out on a cold ffmpeg startup).
      lastProgressWallMs = now();
      gauges.set(ffmpegProgressAgeSeconds, {}, 0, "max");
      startProgressAgeTimer();
    },
    onStderrLine: (line) => {
      if (disposed) return;
      if (PROGRESS_PROTOCOL_LINE.test(line)) return;
      stderrTail.push(line);
      if (stderrTail.length > STALL_STDERR_TAIL_LINES) stderrTail.shift();
    },
    onProcessStart: (pid) => {
      if (disposed) return;
      log.info("ffmpeg subprocess started", { pid });
    },
    onCodecData: (data) => {
      if (disposed) return;
      log.info("ffmpeg input codec", {
        video: data.video,
        audio: data.audio,
        duration: data.duration,
        videoDetails: data.video_details,
        audioDetails: data.audio_details,
      });
    },
    onProgress: (progress) => {
      if (disposed) return;
      if (!audioOnly) diagnostics.onProgress(progress);
      if (!audioOnly && typeof progress.currentFps === "number") {
        gauges.set(ffmpegFps, { hardware: hw }, progress.currentFps, "min");
      }
      if (typeof progress.currentKbps === "number") {
        gauges.set(
          ffmpegBitrateKbps,
          { hardware: hw },
          progress.currentKbps,
          "sum",
        );
      }
      const mediaSeconds = parseTimemarkSeconds(progress.timemark);
      const wallMs = now();
      // Re-arm the stall watchdog ONLY when the media clock actually advanced. A wedged ffmpeg that
      // stays alive and keeps emitting progress reports with the SAME timemark would otherwise
      // refresh `lastProgressWallMs` and clear `stallFired` every tick, so the progress-age never
      // reaches STALL_AFTER_SECONDS and the stall is never detected. The first parseable sample
      // (prevMediaSeconds still undefined) counts as an advance so a healthy start arms the gauge.
      const mediaAdvanced =
        mediaSeconds !== undefined &&
        (prevMediaSeconds === undefined || mediaSeconds > prevMediaSeconds);
      if (mediaAdvanced) {
        lastProgressWallMs = wallMs;
        gauges.set(ffmpegProgressAgeSeconds, {}, 0, "max");
        stallFired = false;
      }
      if (
        mediaSeconds !== undefined &&
        prevMediaSeconds !== undefined &&
        prevWallMs !== undefined
      ) {
        const deltaMedia = mediaSeconds - prevMediaSeconds;
        const deltaWall = (wallMs - prevWallMs) / 1000;
        // Require deltaMedia > 0 (not >= 0): two samples with the same timemark (e.g. the 1s tick
        // firing before ffmpeg advanced the media clock) would otherwise write ratio=0, which is
        // indistinguishable from "catastrophically behind realtime" on the dashboard.
        if (deltaWall > 0 && deltaMedia > 0) {
          gauges.set(
            ffmpegSpeedRatio,
            { hardware: hw },
            deltaMedia / deltaWall,
            "min",
          );
          // Increment the monotonic media-time counter by the same delta. rate() over this gives
          // the producer's realtime rate even when ffmpeg's own `speed=` figure stalls — the
          // canonical stall detector per the ffmpeg-user mailing list.
          ffmpegOutTimeSecondsTotal.inc({ hardware: hw }, deltaMedia);
        }
      }
      if (mediaSeconds !== undefined) {
        prevMediaSeconds = mediaSeconds;
        prevWallMs = wallMs;
      }
    },
    onSendStats: (stats) => {
      if (disposed) return;
      diagnostics.observer.onSendStats(stats);
      sendFrametimeRatio.observe({ kind: stats.kind }, stats.ratio);
      if (stats.ratio > 1) {
        sendLateFramesTotal.inc({ kind: stats.kind });
      }
      gauges.set(
        playbackBehindSeconds,
        { kind: stats.kind },
        stats.behindMs / 1000,
        "max",
      );
      // 200 ms (≈ 6 video frames), NOT one frametime: per-frame behindMs oscillates by the NUT
      // interleave jitter (~1 video frame, 33 ms), which exceeds audio's 20 ms budget — a
      // one-frametime threshold counts ordinary jitter on ~half of audio frames. 200 ms is where
      // lateness becomes viewer-meaningful.
      if (stats.behindMs > 200) {
        framesBehindScheduleTotal.inc({ kind: stats.kind });
      }
      if (stats.syncEvent !== undefined) {
        sendSyncEventsTotal.inc({
          kind: stats.kind,
          direction: stats.syncEvent,
        });
      }
      if (stats.liveEvent !== undefined) {
        liveScheduleEventsTotal.inc({
          kind: stats.kind,
          event: stats.liveEvent,
        });
        // Rare by design and each one is a visible freeze, so every rebuffer earns a log line.
        if (stats.liveEvent === "rebuffer") {
          log.warn("live source ran dry; rebuffering", {
            kind: stats.kind,
            behindMs: Math.round(stats.behindMs),
            ptsMs: Math.round(stats.ptsMs),
          });
        }
      }
      if (stats.syncWaitMs > 0) {
        sendSyncWaitSecondsTotal.inc(
          { kind: stats.kind },
          stats.syncWaitMs / 1000,
        );
      }
    },
    onQueueDepth: (depth) => {
      if (disposed) return;
      diagnostics.observer.onQueueDepth(depth);
      if (!audioOnly)
        gauges.set(pipelineQueueDepth, { kind: "video" }, depth.video, "max");
      gauges.set(pipelineQueueDepth, { kind: "audio" }, depth.audio, "max");
    },
    onPacketReady: diagnostics.observer.onPacketReady,
    onVideoFeedback: diagnostics.observer.onVideoFeedback,
    onVideoSubmission: diagnostics.observer.onVideoSubmission,
  };

  return { observer, dispose };
}
