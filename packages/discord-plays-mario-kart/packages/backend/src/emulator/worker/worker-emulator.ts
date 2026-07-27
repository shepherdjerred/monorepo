// Main-thread facade for the Worker-hosted emulator. Presents the surface the
// driver/web dispatch need (lifecycle, per-frame/audio/snapshot callbacks,
// input, screenshots, save persistence) while the N64Emulator itself — and its
// synchronous ~12–30ms-per-frame wasm stepping — runs on a Worker thread. That
// leaves this (main) event loop free for ffmpeg stdin/stdout, demux, and the
// Discord RTP send, which is what restores full-rate streaming. See
// packages/docs/plans/2026-07-26_mk64-emulator-worker-thread.md.
import * as Sentry from "@sentry/bun";
import type { PlayerInputState } from "@discord-plays-mario-kart/common";
import type { Mk64Snapshot } from "#src/emulator/mk64-memory.ts";
import type { EmulatorRestartReason } from "#src/emulator/n64-emulator.ts";
import { HEIGHT } from "#src/emulator/constants.ts";
import { logger } from "#src/logger.ts";
import { replayMetricBatch } from "./metric-replay.ts";
import { parseWorkerMessage } from "./protocol.ts";
import type { MainToWorker, WorkerInitOpts, WorkerToMain } from "./protocol.ts";

export type EmulatorFrame = {
  rgba: Buffer;
  height: number;
  seatActivity: boolean[];
};

type PendingRequest = {
  resolve: (msg: WorkerToMain) => void;
  reject: (error: Error) => void;
};

/** Zero-copy Buffer view over a received (transferred) Uint8Array. */
function bufferView(u8: Uint8Array): Buffer {
  return Buffer.from(u8.buffer, u8.byteOffset, u8.byteLength);
}

export class WorkerEmulator {
  private readonly opts: WorkerInitOpts;
  private worker: Worker | undefined;
  private nextId = 1;
  private readonly pending = new Map<number, PendingRequest>();
  private readyResolve: (() => void) | undefined;
  private readyReject: ((error: Error) => void) | undefined;
  private stoppedResolve: (() => void) | undefined;
  private onFrameCb: ((frame: EmulatorFrame) => void) | undefined;
  private onAudioCb: ((pcm: Buffer) => void) | undefined;
  private onSnapshotCb: ((snapshot: Mk64Snapshot) => void) | undefined;
  private lastHeight = HEIGHT;
  private lastSeatActivity: boolean[] = [];

  constructor(opts: WorkerInitOpts) {
    this.opts = opts;
  }

  /** Frame height from the most recent frame message (HEIGHT before any). */
  get latestHeight(): number {
    return this.lastHeight;
  }

  /** Seat-activity flags from the most recent frame message. */
  get latestSeatActivity(): readonly boolean[] {
    return this.lastSeatActivity;
  }

  /** Spawn the worker and boot the emulator core inside it. */
  async init(): Promise<void> {
    if (this.worker !== undefined) {
      throw new Error("WorkerEmulator.init called twice");
    }
    const worker = new Worker(new URL("emulator-worker.ts", import.meta.url));
    this.worker = worker;
    worker.addEventListener("message", (event: MessageEvent) => {
      this.handleMessage(event.data);
    });
    worker.addEventListener("error", (event: Event) => {
      // A worker-level failure kills the emulator for this session; surface it
      // loudly (Sentry + log) and fail every pending caller.
      const message =
        "message" in event && typeof event.message === "string"
          ? event.message
          : "emulator worker errored";
      logger.error("emulator worker error", { message });
      Sentry.captureMessage(message, "error");
      // Tear the dead worker down and mark it terminal. Otherwise a later
      // stop() would post `stop` to a corpse and await a `stopped` ack that can
      // never arrive, hanging session teardown and userbot release.
      worker.terminate();
      this.worker = undefined;
      this.failPending(new Error(message));
    });
    const ready = new Promise<void>((resolve, reject) => {
      this.readyResolve = resolve;
      this.readyReject = reject;
    });
    this.post({ kind: "init", opts: this.opts });
    await ready;
  }

  start(): void {
    this.post({ kind: "start" });
  }

  /** Stop the tick loop, drain the final metrics, and terminate the worker. */
  async stop(): Promise<void> {
    const worker = this.worker;
    if (worker === undefined) return;
    const stopped = new Promise<void>((resolve) => {
      this.stoppedResolve = resolve;
    });
    this.post({ kind: "stop" });
    await stopped;
    worker.terminate();
    this.worker = undefined;
    this.failPending(new Error("emulator worker stopped"));
  }

  restartFromStartMenu(reason: EmulatorRestartReason): void {
    this.post({ kind: "restartFromStartMenu", reason });
  }

  setPlayerInput(seat: number, state: PlayerInputState): void {
    // Fire-and-forget: after stop() the session is gone and input is a no-op,
    // matching the pre-worker "no active runtime" behaviour.
    if (this.worker === undefined) return;
    // Stamp arrival on THIS (main) thread so the worker's latency metric spans
    // backend-arrival→applying-tick, including the main→worker transit. The
    // clock is absolute epoch ms so it stays comparable across threads.
    const receivedAt = performance.timeOrigin + performance.now();
    this.post({ kind: "setPlayerInput", seat, state, receivedAt });
  }

  clearPlayerInput(seat: number): void {
    if (this.worker === undefined) return;
    this.post({ kind: "clearPlayerInput", seat });
  }

  /** Current frame as RGBA (screenshot path). Rejects if the worker is gone. */
  renderFrame(): Promise<{ rgba: Buffer; width: number; height: number }> {
    const id = this.nextId++;
    const result = new Promise<{ rgba: Buffer; width: number; height: number }>(
      (resolve, reject) => {
        this.pending.set(id, {
          resolve: (msg) => {
            if (msg.kind !== "renderFrameResult") {
              reject(
                new Error(`unexpected response for renderFrame: ${msg.kind}`),
              );
              return;
            }
            resolve({
              rgba: bufferView(msg.rgba),
              width: msg.width,
              height: msg.height,
            });
          },
          reject,
        });
      },
    );
    this.post({ kind: "renderFrame", id });
    return result;
  }

  /** Snapshot MEMFS → host savesDir (in the worker, which owns the FS). */
  persistSaves(): Promise<void> {
    const id = this.nextId++;
    const result = new Promise<void>((resolve, reject) => {
      this.pending.set(id, {
        resolve: (msg) => {
          if (msg.kind !== "persistSavesResult") {
            reject(
              new Error(`unexpected response for persistSaves: ${msg.kind}`),
            );
            return;
          }
          if (msg.error !== undefined) {
            reject(new Error(msg.error));
            return;
          }
          resolve();
        },
        reject,
      });
    });
    this.post({ kind: "persistSaves", id });
    return result;
  }

  onFrame(cb: (frame: EmulatorFrame) => void): void {
    this.onFrameCb = cb;
  }

  onAudio(cb: (pcm: Buffer) => void): void {
    this.onAudioCb = cb;
  }

  /** Decoded race snapshot, posted every snapshotEveryNFrames frames. */
  onSnapshot(cb: (snapshot: Mk64Snapshot) => void): void {
    this.onSnapshotCb = cb;
  }

  private post(msg: MainToWorker): void {
    const worker = this.worker;
    if (worker === undefined) {
      throw new Error("emulator worker is not running");
    }
    worker.postMessage(msg);
  }

  private failPending(error: Error): void {
    const pending = [...this.pending.values()];
    this.pending.clear();
    for (const p of pending) p.reject(error);
    this.readyReject?.(error);
    this.stoppedResolve?.();
  }

  /**
   * Run a consumer callback (overlay compose, streamer.pushFrame, RaceTracker)
   * without letting a throw escape the Worker message listener and crash the
   * Bun process. In-process this ran inside N64Emulator.loop()'s try/catch; the
   * boundary must preserve that containment so a transient stream-path failure
   * doesn't take down the whole bot.
   */
  private safeInvoke(what: string, fn: () => void): void {
    try {
      fn();
    } catch (error) {
      logger.error("emulator worker callback failed", {
        what,
        error: error instanceof Error ? error.message : String(error),
      });
      Sentry.captureException(error);
    }
  }

  private handleMessage(data: unknown): void {
    let msg: WorkerToMain;
    try {
      msg = parseWorkerMessage(data);
    } catch (error) {
      logger.error("unparseable worker message", {
        error: error instanceof Error ? error.message : String(error),
      });
      return;
    }
    switch (msg.kind) {
      case "ready":
        this.readyResolve?.();
        return;
      case "initFailed":
        this.readyReject?.(new Error(msg.message));
        return;
      case "stopped":
        this.stoppedResolve?.();
        return;
      case "frame":
        this.deliverFrame(msg);
        return;
      case "audio": {
        const cb = this.onAudioCb;
        if (cb !== undefined) {
          const pcm = bufferView(msg.pcm);
          this.safeInvoke("audio", () => {
            cb(pcm);
          });
        }
        return;
      }
      case "snapshot": {
        const cb = this.onSnapshotCb;
        if (cb !== undefined) {
          const { snapshot } = msg;
          this.safeInvoke("snapshot", () => {
            cb(snapshot);
          });
        }
        return;
      }
      case "metrics":
        replayMetricBatch(msg.batch);
        return;
      case "renderFrameResult":
      case "persistSavesResult": {
        const pending = this.pending.get(msg.id);
        if (pending === undefined) {
          logger.warn("response for unknown request id", { id: msg.id });
          return;
        }
        this.pending.delete(msg.id);
        pending.resolve(msg);
        return;
      }
      case "error":
        this.handleWorkerError(msg);
        return;
    }
  }

  /** Ack, latch, and hand a received frame to the consumer (contained). */
  private deliverFrame(msg: Extract<WorkerToMain, { kind: "frame" }>): void {
    // Ack first — the moment the frame is off the port — so the worker's
    // in-flight bound reflects "dequeued", independent of whether the consumer
    // below drops or throws. Skip if the worker was already torn down (error
    // path) while a frame was still queued.
    if (this.worker !== undefined) this.post({ kind: "frameAck" });
    const frame: EmulatorFrame = {
      rgba: bufferView(msg.rgba),
      height: msg.height,
      seatActivity: msg.seatActivity,
    };
    this.lastHeight = msg.height;
    this.lastSeatActivity = msg.seatActivity;
    const cb = this.onFrameCb;
    if (cb !== undefined) {
      this.safeInvoke("frame", () => {
        cb(frame);
      });
    }
  }

  private handleWorkerError(
    msg: Extract<WorkerToMain, { kind: "error" }>,
  ): void {
    logger.error("emulator worker reported error", { message: msg.message });
    Sentry.captureMessage(`emulator worker: ${msg.message}`, "error");
    // A correlated failure (renderFrame/persistSaves) must reject its pending
    // promise, or the caller (/screenshot, save flush) hangs until Discord
    // times out and the map entry leaks.
    if (msg.id === undefined) return;
    const pending = this.pending.get(msg.id);
    if (pending !== undefined) {
      this.pending.delete(msg.id);
      pending.reject(new Error(msg.message));
    }
  }
}
