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
import { createBatchingMetricSink } from "./metric-bridge.ts";
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

  emu.onFrame((rgba) => {
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
    post(
      {
        kind: "frame",
        rgba,
        height: emu.height,
        seatActivity: emu.seatActivity(),
      },
      transferListFor(rgba),
    );
  });
  emu.onAudio((pcm) => {
    post({ kind: "audio", pcm }, transferListFor(pcm));
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
      requireEmulator().setPlayerInput(msg.seat, msg.state);
      return;
    case "clearPlayerInput":
      requireEmulator().clearPlayerInput(msg.seat);
      return;
    case "renderFrame": {
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
