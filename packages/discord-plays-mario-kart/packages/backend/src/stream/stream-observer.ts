// Maps the discord-video-stream fork's StreamObserver callbacks onto the
// Prometheus metrics + structured logs used to root-cause stream latency.
// Adapted from streambot's stream-observer (packages/streambot/src/
// observability/stream-observer.ts) — that module can't be imported across the
// nested workspaces, and this pipeline differs: rawvideo input means hardware
// use shows on the ENCODE side (h264_vaapi/hwupload), not `-hwaccel`.
//
// The headline signal is the realtime speed ratio derived from `timemark`
// (media time) advance vs wall clock between progress callbacks — sustained
// below ~1.0 means the encoder cannot keep up with the 30fps frame feed.
import type { StreamObserver } from "@shepherdjerred/discord-video-stream";
import { logger } from "#src/logger.ts";
import {
  streamFfmpegBitrateKbps,
  streamFfmpegFps,
  streamFfmpegSpeedRatio,
  streamHwEncodeEngaged,
  streamSendFrametimeRatio,
  streamSendLateFramesTotal,
} from "#src/observability/metrics.ts";

/** Aggregates over one Go-Live session, logged as a summary on stop. */
export type SessionStats = {
  framesPushed: number;
  framesDropped: number;
  videoFramesSent: number;
  lateVideoFrames: number;
  lastSpeedRatio: number | undefined;
};

export function newSessionStats(): SessionStats {
  return {
    framesPushed: 0,
    framesDropped: 0,
    videoFramesSent: 0,
    lateVideoFrames: 0,
    lastSpeedRatio: undefined,
  };
}

/** Parse an ffmpeg `timemark` ("HH:MM:SS.ss", possibly negative) to seconds;
 *  undefined if unparseable. */
export function parseTimemarkSeconds(timemark?: string): number | undefined {
  if (timemark === undefined) return undefined;
  const sign = timemark.startsWith("-") ? -1 : 1;
  const parts = timemark.replace(/^-/, "").split(":");
  if (parts.length !== 3) return undefined;
  const h = Number(parts[0]);
  const m = Number(parts[1]);
  const s = Number(parts[2]);
  if (![h, m, s].every((n) => Number.isFinite(n))) return undefined;
  return sign * (h * 3600 + m * 60 + s);
}

/** Whether the ffmpeg command line engaged the VAAPI hardware ENCODER. */
export function commandUsesHardwareEncode(command: string): boolean {
  return command.includes("h264_vaapi") || command.includes("hwupload");
}

// Sustained-slowness warning: this many consecutive sub-realtime progress
// samples (~1/s) before warning, and at most one warning per minute.
const SLOW_SAMPLES_BEFORE_WARN = 5;
const SLOW_WARN_INTERVAL_MS = 60_000;
const SLOW_RATIO_THRESHOLD = 0.95;

/**
 * Build the observer for one Go-Live session. `session` accumulates the
 * stop-time summary; `now` is injectable for deterministic tests.
 */
export function createStreamObserver(
  session: SessionStats,
  now: () => number = Date.now,
): StreamObserver {
  let prevMediaSeconds: number | undefined;
  let prevWallMs: number | undefined;
  let slowSamples = 0;
  let lastSlowWarnAt: number | undefined;

  return {
    onCommand: (command) => {
      const engaged = commandUsesHardwareEncode(command);
      streamHwEncodeEngaged.set(engaged ? 1 : 0);
      logger.info("ffmpeg command", { command, hwEncodeEngaged: engaged });
    },
    onCodecData: (data) => {
      logger.info("ffmpeg input codec", {
        video: data.video,
        videoDetails: data.video_details,
      });
    },
    onProgress: (progress) => {
      if (typeof progress.currentFps === "number") {
        streamFfmpegFps.set(progress.currentFps);
      }
      if (typeof progress.currentKbps === "number") {
        streamFfmpegBitrateKbps.set(progress.currentKbps);
      }
      const mediaSeconds = parseTimemarkSeconds(progress.timemark);
      const wallMs = now();
      if (
        mediaSeconds !== undefined &&
        prevMediaSeconds !== undefined &&
        prevWallMs !== undefined
      ) {
        const deltaMedia = mediaSeconds - prevMediaSeconds;
        const deltaWall = (wallMs - prevWallMs) / 1000;
        // Require deltaMedia > 0 (not >= 0): two samples with the same
        // timemark would otherwise write ratio=0, indistinguishable from
        // "catastrophically behind realtime" on the dashboard.
        if (deltaWall > 0 && deltaMedia > 0) {
          const ratio = deltaMedia / deltaWall;
          streamFfmpegSpeedRatio.set(ratio);
          session.lastSpeedRatio = ratio;
          if (ratio < SLOW_RATIO_THRESHOLD) {
            slowSamples++;
            const warnDue =
              lastSlowWarnAt === undefined ||
              wallMs - lastSlowWarnAt >= SLOW_WARN_INTERVAL_MS;
            if (slowSamples >= SLOW_SAMPLES_BEFORE_WARN && warnDue) {
              lastSlowWarnAt = wallMs;
              logger.warn("ffmpeg encode running below realtime", {
                speedRatio: ratio,
                consecutiveSlowSamples: slowSamples,
              });
            }
          } else {
            slowSamples = 0;
          }
        }
      }
      if (mediaSeconds !== undefined) {
        prevMediaSeconds = mediaSeconds;
        prevWallMs = wallMs;
      }
    },
    onSendStats: (stats) => {
      streamSendFrametimeRatio.observe({ kind: stats.kind }, stats.ratio);
      if (stats.kind === "video") session.videoFramesSent++;
      if (stats.ratio > 1) {
        streamSendLateFramesTotal.inc({ kind: stats.kind });
        if (stats.kind === "video") session.lateVideoFrames++;
      }
    },
  };
}
