// Prometheus instruments for the driver feed (low-latency in-browser H.264), registered
// on the shared registry. Game-specific feed measurements — Mario Kart's HUD-clock
// glass latency and browser decoder resets — stay in that game's metrics module.
import { Histogram, Counter, Gauge } from "prom-client";
import { registry } from "#src/observability/metrics.ts";

export const driverFeedEncoderRunning = new Gauge({
  name: "driver_feed_encoder_running",
  help: "Number of live driver-feed ffmpeg processes, independent of the Go-Live encoders",
  registers: [registry],
});

export const driverFeedClients = new Gauge({
  name: "driver_feed_clients",
  help: "WebSocket clients currently subscribed to the driver feed. Each one costs a full copy of the encoded stream on the uplink",
  registers: [registry],
});

export const driverFeedFramesEvictedTotal = new Counter({
  name: "driver_feed_frames_evicted_total",
  help: "Raw frames evicted from the driver-feed sink because its ffmpeg could not keep up. Mirrors stream_frames_dropped_total for the second encoder; sustained growth here with a healthy Go-Live path means the driver feed alone is over budget",
  registers: [registry],
});

export const driverFeedAccessUnitBytes = new Histogram({
  name: "driver_feed_access_unit_bytes",
  help: "Size of each encoded H.264 access unit handed to the hub, in bytes. The long tail is keyframes; a rising delta-unit floor means the encoder is fighting the bitrate cap",
  buckets: [
    512, 1024, 2048, 4096, 8192, 16_384, 32_768, 65_536, 131_072, 262_144,
  ],
  registers: [registry],
});

export const driverFeedUnitsSentTotal = new Counter({
  name: "driver_feed_units_sent_total",
  help: "Access units written to a client socket, summed across clients",
  registers: [registry],
});

export const driverFeedUnitsDroppedTotal = new Counter({
  name: "driver_feed_units_dropped_total",
  help: "Access units withheld from a client. reason=backpressure means its socket backlog exceeded the ceiling; reason=awaiting_keyframe means it is mid-resync and cannot use deltas yet. Both are per-client and self-healing at the next keyframe",
  labelNames: ["reason"],
  registers: [registry],
});

export const driverFeedAudioChunksDroppedTotal = new Counter({
  name: "driver_feed_audio_chunks_dropped_total",
  help: "Audio chunks withheld from a driver-feed client because its socket backlog exceeded the ceiling",
  registers: [registry],
});

export const DRIVER_FEED_LATENCY_BUCKETS = [
  1, 2, 4, 8, 16, 25, 33, 50, 66, 100, 150, 250, 500, 1000,
];

export const driverFeedFrameToUnitMs = new Histogram({
  name: "driver_feed_frame_to_unit_ms",
  help: "Time from a composited frame being handed to the driver feed to its encoded access unit being ready for the hub, in ms. Covers the sink queue, the stdin pipe, ffmpeg, and stdout framing",
  buckets: DRIVER_FEED_LATENCY_BUCKETS,
  registers: [registry],
});

export const driverFeedInputToUnitMs = new Histogram({
  name: "driver_feed_input_to_unit_ms",
  help: "Time from a controller input arriving at the backend to the first driver-feed access unit reflecting it being ready for the hub, in ms. The driver-feed counterpart of stream_input_to_packet_ready_ms",
  buckets: DRIVER_FEED_LATENCY_BUCKETS,
  registers: [registry],
});

export const driverFeedSinkFrames = new Gauge({
  name: "driver_feed_sink_frames",
  help: "Total raw frames queued ahead of ffmpeg across live driver feeds, sampled on every push",
  registers: [registry],
});

export const driverFeedLatencyCorrelationFailuresTotal = new Counter({
  name: "driver_feed_latency_correlation_failures_total",
  help: "Times the frame-to-access-unit pairing queue outgrew any honest encoder backlog and was reset. Non-zero means driver_feed_*_to_unit_ms samples around it are unreliable",
  registers: [registry],
});

export const driverFeedClientBufferBytes = new Gauge({
  name: "driver_feed_client_buffer_bytes",
  help: "Largest unflushed WebSocket backlog across driver-feed clients, in bytes. The early-warning signal for a slow viewer, the same role sinkBufferBytes plays on the Go-Live path",
  registers: [registry],
});
