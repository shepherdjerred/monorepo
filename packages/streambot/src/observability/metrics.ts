/**
 * Prometheus metrics for streambot. A single custom {@link Registry} is exposed over a tiny
 * `Bun.serve` HTTP server at `/metrics` (scraped by a ServiceMonitor in the homelab chart) plus a
 * `/healthz` liveness route. Modelled on `packages/temporal/src/observability/metrics.ts`.
 *
 * The metric set is built around the signals that were invisible during the 2026-06-07 stutter
 * incident: ffmpeg realtime `speed`, send-path frametime, hardware-decode engagement, and source
 * media properties. `collectDefaultMetrics` additionally exports process CPU/memory and — critically
 * for realtime send stutter — `streambot_nodejs_eventloop_lag_seconds`.
 */

import {
  Counter,
  Gauge,
  Histogram,
  collectDefaultMetrics,
  Registry,
} from "prom-client";
import { logger } from "@shepherdjerred/streambot/util/logger.ts";

const log = logger.child("metrics");

export const register = new Registry();
register.setDefaultLabels({ app: "streambot" });
collectDefaultMetrics({ register, prefix: "streambot_" });

// --- ffmpeg transcode realtime health --------------------------------------

/** ffmpeg realtime ratio (media-time advance / wall-clock advance). < 1 means falling behind. */
export const ffmpegSpeedRatio = new Gauge({
  name: "streambot_ffmpeg_speed_ratio",
  help: "ffmpeg realtime speed ratio for the current segment (media seconds produced per wall-clock second); <1 = falling behind realtime",
  labelNames: ["hardware"] as const,
  registers: [register],
});

export const ffmpegFps = new Gauge({
  name: "streambot_ffmpeg_fps",
  help: "ffmpeg current output frames per second for the active segment",
  labelNames: ["hardware"] as const,
  registers: [register],
});

export const ffmpegBitrateKbps = new Gauge({
  name: "streambot_ffmpeg_bitrate_kbps",
  help: "ffmpeg current output bitrate in kbps for the active segment",
  labelNames: ["hardware"] as const,
  registers: [register],
});

// --- send path --------------------------------------------------------------

/** Per-frame send time / frame budget. >1 means the realtime send path is behind. */
export const sendFrametimeRatio = new Histogram({
  name: "streambot_send_frametime_ratio",
  help: "Fraction of a frame's wall-clock budget consumed by the Discord send path, by stream kind",
  labelNames: ["kind"] as const,
  buckets: [0.25, 0.5, 0.75, 0.9, 1, 1.1, 1.25, 1.5, 2, 3],
  registers: [register],
});

export const sendLateFramesTotal = new Counter({
  name: "streambot_send_late_frames_total",
  help: "Frames whose send exceeded their frametime budget (ratio > 1), by stream kind",
  labelNames: ["kind"] as const,
  registers: [register],
});

// --- hardware vs software ---------------------------------------------------

/** 1 when the active ffmpeg command applied the VAAPI hardware-decode flags, else 0. */
export const hwDecodeEngaged = new Gauge({
  name: "streambot_hw_decode_engaged",
  help: "Whether the active ffmpeg command applied the VAAPI hardware-decode pipeline (1) or not (0)",
  registers: [register],
});

export const hwFallbackTotal = new Counter({
  name: "streambot_hw_fallback_total",
  help: "Count of hardware->software encode fallbacks (a hardware attempt failed and was retried in software)",
  registers: [register],
});

/** 1 when the current segment is streaming on the hardware path, 0 on the software path. */
export const streamHardware = new Gauge({
  name: "streambot_stream_hardware",
  help: "Whether the current streaming segment is using the hardware path (1) or software (0)",
  registers: [register],
});

// --- segment lifecycle ------------------------------------------------------

export const streamActive = new Gauge({
  name: "streambot_stream_active",
  help: "Whether a stream segment is currently playing (1) or not (0)",
  registers: [register],
});

export const streamSegmentsTotal = new Counter({
  name: "streambot_stream_segments_total",
  help: "Completed stream segments, by hardware path and outcome (ended | error)",
  labelNames: ["hardware", "outcome"] as const,
  registers: [register],
});

export const streamSegmentDurationSeconds = new Histogram({
  name: "streambot_stream_segment_duration_seconds",
  help: "Wall-clock duration of a stream segment, by hardware path and outcome",
  labelNames: ["hardware", "outcome"] as const,
  buckets: [1, 5, 30, 60, 300, 900, 1800, 3600, 7200],
  registers: [register],
});

export const playbackPositionSeconds = new Gauge({
  name: "streambot_playback_position_seconds",
  help: "Current playback position of the active segment, in seconds",
  registers: [register],
});

// --- source media properties (set from ffprobe) -----------------------------

const sourceInfo = new Gauge({
  name: "streambot_source_info",
  help: "Info metric (value 1) describing the currently-playing source's media properties",
  labelNames: ["video_codec", "audio_codec", "hdr", "resolution"] as const,
  registers: [register],
});

/**
 * Replace the single source-info series with the current source's properties. Resets first so stale
 * label combinations from the previous source don't linger.
 */
export function setSourceInfo(labels: {
  video_codec: string;
  audio_codec: string;
  hdr: string;
  resolution: string;
}): void {
  sourceInfo.reset();
  sourceInfo.set(labels, 1);
}

// --- playback machine -------------------------------------------------------

const playbackStateGauge = new Gauge({
  name: "streambot_playback_state",
  help: "Current xstate playback-machine state (value 1 on the active state label)",
  labelNames: ["state"] as const,
  registers: [register],
});

/** Set the active machine state (resets others so exactly one label carries value 1). */
export function setPlaybackState(state: string): void {
  playbackStateGauge.reset();
  playbackStateGauge.set({ state }, 1);
}

export const queueLength = new Gauge({
  name: "streambot_queue_length",
  help: "Number of items currently in the playback queue",
  registers: [register],
});

export const actorDurationSeconds = new Histogram({
  name: "streambot_actor_duration_seconds",
  help: "Wall-clock duration of playback-machine actor invocations, by actor and outcome",
  labelNames: ["actor", "outcome"] as const,
  buckets: [0.05, 0.1, 0.5, 1, 5, 30, 300, 1800, 7200],
  registers: [register],
});

// --- HTTP server ------------------------------------------------------------

let server: ReturnType<typeof Bun.serve> | undefined;

/**
 * Start the metrics HTTP server on `port`. A port of `0` disables metrics entirely (returns without
 * binding). Returns the bound port, or `undefined` when disabled.
 */
export function startMetricsServer(port: number): number | undefined {
  if (port === 0) {
    log.info("metrics disabled (port 0)");
    return undefined;
  }
  if (server !== undefined) {
    throw new Error("metrics server already started");
  }

  server = Bun.serve({
    port,
    hostname: "0.0.0.0",
    async fetch(req) {
      const url = new URL(req.url);
      if (url.pathname === "/metrics") {
        return new Response(await register.metrics(), {
          status: 200,
          headers: { "content-type": register.contentType },
        });
      }
      if (url.pathname === "/healthz") {
        return new Response("ok\n", { status: 200 });
      }
      return new Response("not found\n", { status: 404 });
    },
  });

  log.info("metrics server started", { port });
  return port;
}

export async function stopMetricsServer(): Promise<void> {
  if (server === undefined) {
    return;
  }
  await server.stop();
  server = undefined;
}
