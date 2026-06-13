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
  help: "Time to render the frame and hand it to the stream, in ms",
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

export const frameHookErrorsTotal = new Counter({
  name: "emulator_frame_hook_errors_total",
  help: "Exceptions thrown by frame hooks (isolated from the frame loop)",
  registers: [registry],
});

export const gameEventsTotal = new Counter({
  name: "game_events_total",
  help: "In-game events detected by the memory watcher, by kind",
  labelNames: ["kind"],
  registers: [registry],
});

export const snapshotInvalidTotal = new Counter({
  name: "game_snapshot_invalid_total",
  help: "Polls where the game state was unreadable (no save loaded, torn read)",
  registers: [registry],
});

export const notificationSendErrorsTotal = new Counter({
  name: "notification_send_errors_total",
  help: "Failures sending game event notifications to Discord",
  registers: [registry],
});
