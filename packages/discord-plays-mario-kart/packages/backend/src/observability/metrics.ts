// Prometheus instruments for the streaming hot loop. Scraped at GET /metrics and
// surfaced in Grafana — they tell apart the candidate causes of choppy video:
// emulation-bound (emulate_ms high, achieved fps < target), copy-bound, or
// encode/send-bound (sink buffer climbing). Always-on; each observe() is cheap.
import {
  Registry,
  Histogram,
  Counter,
  Gauge,
  collectDefaultMetrics,
} from "prom-client";

export const registry = new Registry();

// process/heap/CPU + nodejs_eventloop_lag — the event-loop lag series directly
// shows when the single JS thread (emulate + frame copy) saturates.
collectDefaultMetrics({ register: registry });

// Per-frame durations, in milliseconds. Buckets straddle the 30fps (33ms) and
// 60fps (16ms) frame budgets so we can see when work blows the budget.
const FRAME_MS_BUCKETS = [0.25, 0.5, 1, 2, 4, 8, 16, 25, 33, 50, 100, 200];

export const emulateMs = new Histogram({
  name: "emulator_frame_emulate_ms",
  help: "Time to run one emulator frame (the wasm core step), in ms",
  buckets: FRAME_MS_BUCKETS,
  registers: [registry],
});

export const copyMs = new Histogram({
  name: "emulator_frame_copy_ms",
  help: "Time to copy the frame out of wasm memory and hand it to the stream, in ms",
  buckets: FRAME_MS_BUCKETS,
  registers: [registry],
});

export const lateMs = new Histogram({
  name: "emulator_frame_late_ms",
  help: "How far behind schedule the paced loop is at each tick, in ms (0 when on time)",
  buckets: [0, 1, 2, 4, 8, 16, 33, 66, 133, 250],
  registers: [registry],
});

export const ticksTotal = new Counter({
  name: "emulator_ticks_total",
  help: "Emulator ticks executed; rate() gives the achieved frame rate",
  registers: [registry],
});

export const loopResyncTotal = new Counter({
  name: "emulator_loop_resync_total",
  help: "Times the paced loop fell far enough behind to resync (dropping frames)",
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

export const sinkBufferBytes = new Gauge({
  name: "stream_sink_buffer_bytes",
  help: "Bytes buffered in the PassThrough feeding ffmpeg; a rising value means the encoder/send path is falling behind",
  registers: [registry],
});

export const streamActive = new Gauge({
  name: "stream_active",
  help: "1 while a Go-Live broadcast is running and accepting frames, else 0",
  registers: [registry],
});
