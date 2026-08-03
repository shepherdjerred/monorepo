// Prometheus instruments for the streaming hot loop. Scraped at GET /metrics and
// surfaced in Grafana. The shared registry + the emu/stream instruments both
// discord-plays backends define identically live in discord-plays-core; this file
// re-exports them and registers the Mario Kart-specific instruments (input/controller
// latency, emulator restarts, the richer frame→encoder→send-path metrics) plus
// copyMs (whose help text differs from pokemon's) against the shared registry.
import { Histogram, Counter, Gauge } from "prom-client";
import {
  registry,
  FRAME_MS_BUCKETS,
} from "@shepherdjerred/discord-plays-core/observability/metrics.ts";

export const copyMs = new Histogram({
  name: "emulator_frame_copy_ms",
  help: "Time to copy the frame out of wasm memory and hand it to the stream, in ms",
  buckets: FRAME_MS_BUCKETS,
  registers: [registry],
});

export const emulatorRestartsTotal = new Counter({
  name: "emulator_restarts_total",
  help: "Emulator restarts requested by backend lifecycle events",
  labelNames: ["reason"],
  registers: [registry],
});

export const inputApplyDelayMs = new Histogram({
  name: "emulator_input_apply_delay_ms",
  help: "Time from a controller input arriving at the backend to being latched into the emulator tick that applies it, in ms",
  buckets: [1, 2, 4, 8, 16, 25, 33, 50, 100, 250],
  registers: [registry],
});

export const controllerRttMs = new Histogram({
  name: "controller_rtt_ms",
  help: "Socket round-trip time measured by the web controller and reported to the server, in ms",
  buckets: [5, 10, 25, 50, 75, 100, 150, 250, 500, 1000, 2500],
  registers: [registry],
});

// ---- frame → encoder cadence ----

export const streamFrameIntervalMs = new Histogram({
  name: "stream_frame_interval_ms",
  help: "Wall-clock gap between consecutive frames pushed to the encoder while streaming, in ms (jitter around the frame budget)",
  buckets: [16, 25, 30, 33, 36, 40, 50, 66, 100, 200],
  registers: [registry],
});

export const streamFrameWriteMs = new Histogram({
  name: "stream_frame_write_ms",
  help: "Duration of the write handing a frame to the ffmpeg pipe, in ms; rises with backpressure before the sink buffer does",
  buckets: FRAME_MS_BUCKETS,
  registers: [registry],
});

export const streamFramesDroppedTotal = new Counter({
  name: "stream_frames_dropped_total",
  help: "Oldest queued raw-video frames evicted to keep video content near the continuous audio timeline",
  registers: [registry],
});

// ---- ffmpeg encode health (from the discord-video-stream StreamObserver) ----

export const streamFfmpegSpeedRatio = new Gauge({
  name: "stream_ffmpeg_speed_ratio",
  help: "Media seconds encoded per wall-clock second, derived from ffmpeg timemark advance; sustained <1 means the encoder cannot keep realtime",
  registers: [registry],
});

export const streamFfmpegFps = new Gauge({
  name: "stream_ffmpeg_fps",
  help: "ffmpeg's reported output frame rate",
  registers: [registry],
});

export const streamFfmpegBitrateKbps = new Gauge({
  name: "stream_ffmpeg_bitrate_kbps",
  help: "ffmpeg's reported output bitrate, in kbps",
  registers: [registry],
});

export const streamHwEncodeEngaged = new Gauge({
  name: "stream_hw_encode_engaged",
  help: "1 if the running ffmpeg command uses the VAAPI hardware encoder, else 0",
  registers: [registry],
});

// ---- encoder → Discord RTP send path ----

export const streamSendFrametimeRatio = new Histogram({
  name: "stream_send_frametime_ratio",
  help: "Per-frame send time as a fraction of the frame's wall-clock budget; >1 means the frame was sent late",
  buckets: [0.25, 0.5, 0.75, 0.9, 1, 1.1, 1.25, 1.5, 2, 3],
  labelNames: ["kind"],
  registers: [registry],
});

export const streamSendLateFramesTotal = new Counter({
  name: "stream_send_late_frames_total",
  help: "Frames whose RTP send exceeded their frametime budget",
  labelNames: ["kind"],
  registers: [registry],
});

const PIPELINE_LATENCY_BUCKETS = [
  1, 2, 4, 8, 16, 25, 33, 50, 75, 100, 150, 250, 500, 1000, 2500,
];

export const streamPacketReadyDelayMs = new Histogram({
  name: "stream_packet_ready_delay_ms",
  help: "Time from raw media becoming available to its matching encoded NUT packet becoming ready, in ms",
  buckets: PIPELINE_LATENCY_BUCKETS,
  labelNames: ["kind"],
  registers: [registry],
});

export const streamSendCompleteDelayMs = new Histogram({
  name: "stream_send_complete_delay_ms",
  help: "Time from raw media becoming available to its matching RTP send completing, in ms",
  buckets: PIPELINE_LATENCY_BUCKETS,
  labelNames: ["kind"],
  registers: [registry],
});

export const streamInputToPacketReadyMs = new Histogram({
  name: "stream_input_to_packet_ready_ms",
  help: "Time from controller input receipt to the first matching encoded video packet becoming ready, in ms",
  buckets: PIPELINE_LATENCY_BUCKETS,
  registers: [registry],
});

export const streamInputToSendCompleteMs = new Histogram({
  name: "stream_input_to_send_complete_ms",
  help: "Time from controller input receipt to the first matching RTP video send completing, in ms",
  buckets: PIPELINE_LATENCY_BUCKETS,
  registers: [registry],
});

export const streamAvContentOffsetMs = new Gauge({
  name: "stream_av_content_offset_ms",
  help: "Video source-content offset minus audio source-content offset at encoded output, in ms; positive means audio content lags video",
  registers: [registry],
});

export const streamAvContentSkewAbsMs = new Histogram({
  name: "stream_av_content_skew_abs_ms",
  help: "Absolute source-content offset between encoded video and audio packets, in ms",
  buckets: [1, 2, 4, 8, 16, 25, 33, 50, 60, 75, 100, 150, 250, 500, 1000],
  registers: [registry],
});

export const streamLatencyCorrelationFailuresTotal = new Counter({
  name: "stream_latency_correlation_failures_total",
  help: "Packets that could not be correlated with their raw media or send checkpoint",
  labelNames: ["kind", "reason"],
  registers: [registry],
});

export const streamTrackerVideoSourceDepth = new Gauge({
  name: "stream_tracker_video_source_depth",
  help: "Unconsumed raw-video source entries in the latency tracker's pairing FIFO. Sustained ~30 while the viewer's glass is realtime means phantom head entries are corrupting every pipeline histogram (packages/docs/todos/mk64-stream-latency-correlation-desync.md); ~0-3 means the pairing is honest. Delivered frames ≈ stream_frame_interval_ms_count − stream_frames_dropped_total; emitted packets = stream_packet_ready_delay_ms_count",
  registers: [registry],
});

export const streamSendIntervalMs = new Histogram({
  name: "stream_send_interval_ms",
  help: "Wall-clock gap between consecutive RTP sends of the same kind, in ms. Fine buckets make 100-500ms send stalls visible; the coarse pipeline-latency buckets cannot resolve them",
  buckets: [16, 25, 30, 33, 36, 40, 50, 66, 100, 150, 250, 500],
  labelNames: ["kind"],
  registers: [registry],
});

export const eventLoopLagMs = new Histogram({
  name: "event_loop_lag_ms",
  help: "Excess delay of a 20ms interval timer beyond its schedule, per thread, in ms; sustained >33 stalls the frame pipeline. Manual sampler — Bun's monitorEventLoopDelay does not detect synchronous blocks (verified 2026-08-03)",
  buckets: [1, 2, 4, 8, 16, 33, 50, 100, 150, 250, 500],
  labelNames: ["thread"],
  registers: [registry],
});
