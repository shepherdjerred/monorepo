/**
 * Maps the discord-video-stream fork's {@link StreamObserver} callbacks onto Prometheus metrics +
 * structured logs. The fork computes these signals but otherwise only writes them to debug logs;
 * this is the seam that surfaces them.
 *
 * The headline signal is the ffmpeg realtime ratio. ffmpeg is not readrate-limited, so `speed`
 * reflects raw transcode throughput: a sustained value below ~1.0 means the pipeline cannot produce
 * frames as fast as realtime (decode/transcode-bound — the 4K-software-decode case) and playback
 * will stutter once the startup buffer drains. The send-path frametime ratio covers the
 * complementary send-bound case. We derive the ratio from `timemark` (media time) advance vs
 * wall-clock between consecutive progress callbacks rather than trusting fluent-ffmpeg to parse
 * `speed`.
 */

import type { StreamObserver } from "@shepherdjerred/discord-video-stream";
import { logger } from "@shepherdjerred/streambot/util/logger.ts";
import {
  ffmpegBitrateKbps,
  ffmpegFps,
  ffmpegOutTimeSecondsTotal,
  ffmpegProgressAgeSeconds,
  ffmpegSpeedRatio,
  hwDecodeEngaged,
  sendFrametimeRatio,
  sendLateFramesTotal,
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
  if (![h, m, s].every((n) => Number.isFinite(n))) {
    return undefined;
  }
  return sign * (h * 3600 + m * 60 + s);
}

/**
 * Whether an ffmpeg command line applied the VAAPI hardware-decode pipeline. Matches the input-side
 * `-hwaccel vaapi` flag or the GPU `scale_vaapi` filter the fork emits when the pipeline engages.
 */
export function commandUsesHardwareDecode(command: string): boolean {
  return /-hwaccel\s+vaapi/.test(command) || command.includes("scale_vaapi");
}

/**
 * Build a {@link StreamObserver} for one streaming segment. `hardware` labels the metrics with the
 * path the segment is attempting. `now` is injectable for deterministic tests.
 */
export function createStreamObserver(
  hardware: boolean,
  now: () => number = Date.now,
): StreamObserver {
  const hw = hardware ? "true" : "false";
  let prevMediaSeconds: number | undefined;
  let prevWallMs: number | undefined;
  let lastProgressWallMs: number | undefined;
  let progressAgeTimer: ReturnType<typeof setInterval> | undefined;

  // Drive the progress-age gauge on a 1s tick: a deadlocked subprocess (stdout+stderr both backed
  // up, ffmpeg blocked on write) stops emitting progress entirely, so the only way the gauge can
  // climb past 5 s — the alert threshold — is by an external timer.
  const startProgressAgeTimer = () => {
    if (progressAgeTimer !== undefined) return;
    progressAgeTimer = setInterval(() => {
      if (lastProgressWallMs === undefined) return;
      ffmpegProgressAgeSeconds.set((now() - lastProgressWallMs) / 1000);
    }, 1000);
    progressAgeTimer.unref();
  };

  return {
    onCommand: (command) => {
      const engaged = commandUsesHardwareDecode(command);
      hwDecodeEngaged.set(engaged ? 1 : 0);
      log.info("ffmpeg command", { command, hwDecodeEngaged: engaged });
      // Treat command start as the initial progress sample so the age gauge is meaningful before
      // the first onProgress callback (which can be > 1s out on a cold ffmpeg startup).
      lastProgressWallMs = now();
      ffmpegProgressAgeSeconds.set(0);
      startProgressAgeTimer();
    },
    onProcessStart: (pid) => {
      log.info("ffmpeg subprocess started", { pid });
    },
    onCodecData: (data) => {
      log.info("ffmpeg input codec", {
        video: data.video,
        audio: data.audio,
        duration: data.duration,
        videoDetails: data.video_details,
        audioDetails: data.audio_details,
      });
    },
    onProgress: (progress) => {
      if (typeof progress.currentFps === "number") {
        ffmpegFps.set({ hardware: hw }, progress.currentFps);
      }
      if (typeof progress.currentKbps === "number") {
        ffmpegBitrateKbps.set({ hardware: hw }, progress.currentKbps);
      }
      const mediaSeconds = parseTimemarkSeconds(progress.timemark);
      const wallMs = now();
      lastProgressWallMs = wallMs;
      ffmpegProgressAgeSeconds.set(0);
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
          ffmpegSpeedRatio.set({ hardware: hw }, deltaMedia / deltaWall);
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
      sendFrametimeRatio.observe({ kind: stats.kind }, stats.ratio);
      if (stats.ratio > 1) {
        sendLateFramesTotal.inc({ kind: stats.kind });
      }
    },
  };
}
