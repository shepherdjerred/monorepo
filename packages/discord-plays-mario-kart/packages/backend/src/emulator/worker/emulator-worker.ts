// Emulator Worker entrypoint (spawned by WorkerEmulator). Owns the N64Emulator
// — wasm core, paced tick loop, input latching, audio drain, RDRAM snapshots,
// MEMFS save persistence — so the synchronous ~12–30ms runMainLoop runs OFF the
// main thread, leaving the main event loop free for ffmpeg/stream I/O. See
// packages/docs/plans/2026-07-26_mk64-emulator-worker-thread.md.
//
// Environment note: Bun Workers have `process` but no `importScripts`/
// `window`, so the emscripten glue evaluates with ENVIRONMENT_IS_NODE exactly
// as it does on the main thread (wasm-host.ts's contract holds).
import { N64Emulator } from "#src/emulator/n64-emulator.ts";
import { readSnapshot } from "#src/emulator/mk64-memory.ts";
import { MAX_AUDIO_IN_FLIGHT, MAX_FRAMES_IN_FLIGHT } from "./backpressure.ts";
import { createBatchingMetricSink } from "./metric-bridge.ts";
import { startEventLoopLagSampler } from "#src/observability/event-loop-lag.ts";
import { parseMainMessage } from "./protocol.ts";
import type { WorkerInitOpts, WorkerToMain } from "./protocol.ts";
import { logger } from "#src/logger.ts";

function post(message: WorkerToMain, transfer: ArrayBufferLike[] = []): void {
  const postMessage: unknown = Reflect.get(globalThis, "postMessage");
  if (typeof postMessage !== "function") {
    throw new TypeError("worker global postMessage unavailable");
  }
  Reflect.apply(postMessage, globalThis, [message, transfer]);
}

/**
 * The transfer list for a byte payload, but ONLY when it owns its whole
 * ArrayBuffer. `Buffer.from`/`Buffer.concat` back small results (audio chunks)
 * with Node/Bun's shared Buffer pool — transferring a pooled `.buffer` would
 * detach the entire pool and corrupt every other Buffer sharing it. Frames are
 * far larger than the pool threshold so they own a dedicated buffer and are
 * transferred zero-copy; a pooled payload returns [] and is structured-clone
 * copied instead (cheap for the tiny audio case).
 */
function transferListFor(bytes: Uint8Array): ArrayBufferLike[] {
  const ownsWholeBuffer =
    bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength;
  return ownsWholeBuffer ? [bytes.buffer] : [];
}

function onMessage(handler: (data: unknown) => void): void {
  Reflect.set(globalThis, "onmessage", (event: { data: unknown }) => {
    handler(event.data);
  });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

let emulator: N64Emulator | undefined;
let batching: ReturnType<typeof createBatchingMetricSink> | undefined;
let frameCount = 0;
let snapshotEveryNFrames = 10;

// Frame backpressure. The main thread acks each frame it dequeues; the worker
// posts a new frame only while fewer than this many are unacked. When the main
// event loop stalls (overlay/stream load) acks stop, framesInFlight saturates,
// and further frames are DROPPED rather than piled into the port queue — the
// same bound-latency-degrade-fps tradeoff the main-thread sink drop-gate makes.
// ~3 frames ≈ 100ms at 30fps: enough headroom for normal jitter, small enough
// to keep transferred RGBA buffers from accumulating.
let framesInFlight = 0;

// Audio has the same ~100 ms time-based headroom as video. Since audio drains
// at 60 Hz and video emits at 30 Hz, its chunk bound is twice the frame bound.
// Without a bound, stale audio would accumulate in the port queue; with only
// three chunks, PCM would drop after ~50 ms while video remained buffered.
let audioInFlight = 0;

function requireEmulator(): N64Emulator {
  const emu = emulator;
  if (emu === undefined) {
    throw new Error("emulator not initialized (init message not received)");
  }
  return emu;
}

async function handleInit(opts: WorkerInitOpts): Promise<void> {
  snapshotEveryNFrames = opts.snapshotEveryNFrames;
  batching = createBatchingMetricSink((batch) => {
    post({ kind: "metrics", batch });
  });
  const emu = new N64Emulator({
    wasmDir: opts.wasmDir,
    romPath: opts.romPath,
    fps: opts.fps,
    software: opts.software,
    seats: opts.seats,
    ...(opts.savesDir === undefined ? {} : { savesDir: opts.savesDir }),
    metrics: batching.sink,
  });
  await emu.init();

  // Worker-thread stall visibility: a blocked worker loop delays frames but was
  // previously invisible below the 66ms tick-lateness floor. Start sampling only
  // AFTER init() so synchronous WASM/ROM boot latency is not recorded as
  // streaming loop lag in the event_loop_lag_ms histogram.
  const sinkForLag = batching;
  startEventLoopLagSampler((lagMs) => {
    sinkForLag.observeEventLoopLagMs(lagMs);
  });

  emu.onFrame((rgba, contentTimeMs) => {
    frameCount += 1;
    // Race snapshots decode in the worker (RDRAM lives here); only the small
    // decoded snapshot crosses to the main thread. A bad read must never break
    // the frame loop — warn and skip, exactly as RaceTracker did in-process.
    if (frameCount % snapshotEveryNFrames === 0) {
      const mem = emu.rdram();
      if (mem !== undefined) {
        try {
          post({ kind: "snapshot", snapshot: readSnapshot(mem) });
        } catch (error) {
          logger.warn("race snapshot read failed", {
            error: errorMessage(error),
          });
        }
      }
    }
    if (framesInFlight >= MAX_FRAMES_IN_FLIGHT) {
      // Main thread is behind (unacked frames saturated the bound). Drop this
      // frame instead of growing the port's transfer queue.
      return;
    }
    framesInFlight += 1;
    const inputReceivedAtMs = emu.takePendingFrameInputReceivedAtMs();
    post(
      {
        kind: "frame",
        rgba,
        height: emu.height,
        seatActivity: emu.seatActivity(),
        contentTimeMs,
        ...(inputReceivedAtMs === undefined ? {} : { inputReceivedAtMs }),
      },
      transferListFor(rgba),
    );
  });
  emu.onAudio((pcm, contentEndMs) => {
    if (audioInFlight >= MAX_AUDIO_IN_FLIGHT) {
      // Main thread is behind; drop this chunk rather than growing the queue.
      return;
    }
    audioInFlight += 1;
    post({ kind: "audio", pcm, contentEndMs }, transferListFor(pcm));
  });

  emulator = emu;
  post({ kind: "ready" });
}

async function handle(data: unknown): Promise<void> {
  const msg = parseMainMessage(data);
  switch (msg.kind) {
    case "init":
      try {
        await handleInit(msg.opts);
      } catch (error) {
        post({ kind: "initFailed", message: errorMessage(error) });
      }
      return;
    case "start":
      requireEmulator().start();
      return;
    case "stop": {
      requireEmulator().stop();
      // Final metrics flush must precede the stopped ack (port FIFO), so the
      // main thread observes the last observations before it terminates us.
      batching?.close();
      post({ kind: "stopped" });
      return;
    }
    case "restartFromStartMenu":
      requireEmulator().restartFromStartMenu(msg.reason);
      return;
    case "setPlayerInput":
      requireEmulator().setPlayerInput(msg.seat, msg.state, msg.receivedAt);
      // Ack so the main facade frees an in-flight slot and sends the next
      // coalesced input; bounds the port queue under a controller flood.
      post({ kind: "inputAck" });
      return;
    case "clearPlayerInput":
      requireEmulator().clearPlayerInput(msg.seat);
      return;
    case "frameAck":
      framesInFlight = Math.max(0, framesInFlight - 1);
      return;
    case "audioAck":
      audioInFlight = Math.max(0, audioInFlight - 1);
      return;
    case "renderFrame": {
      // Correlate a failure to msg.id so the facade rejects that pending
      // request rather than leaking it (the generic dispatch catch can't).
      try {
        const frame = requireEmulator().renderFrame();
        post(
          {
            kind: "renderFrameResult",
            id: msg.id,
            rgba: frame.rgba,
            width: frame.width,
            height: frame.height,
          },
          transferListFor(frame.rgba),
        );
      } catch (error) {
        post({ kind: "error", id: msg.id, message: errorMessage(error) });
      }
      return;
    }
    case "persistSaves": {
      try {
        await requireEmulator().persistSaves();
        post({ kind: "persistSavesResult", id: msg.id });
      } catch (error) {
        post({
          kind: "persistSavesResult",
          id: msg.id,
          error: errorMessage(error),
        });
      }
      return;
    }
  }
}

async function dispatch(data: unknown): Promise<void> {
  try {
    await handle(data);
  } catch (error) {
    post({ kind: "error", message: errorMessage(error) });
  }
}

onMessage((data) => {
  void dispatch(data);
});
