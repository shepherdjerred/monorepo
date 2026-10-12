// GameEngine over the native SpaghettiKart port.
//
// The game renders and mixes in its own process (host.ts), so this side only
// parses bridge messages on the main thread: frames arrive as BGRA ready for
// the encoders, audio as s16le stereo, and race state once per game frame.
//
// Lifecycle: init() boots the game in lockstep, so it waits at its first input
// latch until start() switches it to wall-clock pacing for good.
import * as Sentry from "@sentry/bun";
import {
  EMPTY_INPUT,
  type PlayerInputState,
} from "@discord-plays-mario-kart/common";
import { MAX_SEATS } from "#src/emulator/constants.ts";
import {
  snapshotFromRawState,
  type Mk64Snapshot,
} from "#src/emulator/mk64-state.ts";
import {
  createPromMetricSink,
  type MetricSink,
} from "#src/emulator/metric-sink.ts";
import { seatActivity } from "#src/input/seat-activity.ts";
import { logger } from "#src/logger.ts";
import { spaghettiFormat, type FrameFormat } from "#src/engine/format.ts";
import type {
  EngineFrame,
  EngineRestartReason,
  EngineScreenshot,
  GameEngine,
} from "#src/engine/game-engine.ts";
import { SpaghettiHost, type SpaghettiHostOptions } from "./host.ts";
import type { SpaghettiBuild } from "./install.ts";
import {
  BRIDGE_PROTOCOL_VERSION,
  NEUTRAL_PAD,
  padFromInput,
  type AudioMessage,
  type FrameMessage,
  type Hello,
  type Pad,
  type StateMessage,
} from "./protocol.ts";

/** The slice of SpaghettiHost the engine drives; tests substitute a fake. */
export type BridgeHost = {
  start: () => Promise<Hello>;
  sendInput: (pads: readonly Pad[]) => number;
  runPaced: () => void;
  reset: () => void;
  stop: () => Promise<void>;
};

export type BridgeHostCallbacks = Required<
  Pick<
    SpaghettiHostOptions,
    "onFrame" | "onAudio" | "onState" | "onUnexpectedExit"
  >
>;

export type BridgeHostFactory = (callbacks: BridgeHostCallbacks) => BridgeHost;

export type SpaghettiEngineOptions = {
  readonly build: SpaghettiBuild;
  /** SHIP_HOME: per-guild config, logs, and the EEPROM save. */
  readonly homeDir: string;
  readonly seats: number;
  readonly outputFps: 30 | 60;
  /** Decode + deliver a race snapshot every N game frames. */
  readonly snapshotEveryNFrames: number;
  readonly metrics?: MetricSink;
  readonly hostFactory?: BridgeHostFactory;
};

/** Inputs sent but not yet latched. Bounded for a game that is not running. */
const MAX_PENDING_INPUTS = 1024;
const SCREENSHOT_TIMEOUT_MS = 2000;

type PendingInput = { seq: number; seat: number; receivedAtMs: number };

type ScreenshotWaiter = {
  resolve: (shot: EngineScreenshot) => void;
  reject: (error: Error) => void;
};

function epochNowMs(): number {
  return performance.timeOrigin + performance.now();
}

async function closeExitedHost(host: BridgeHost): Promise<void> {
  try {
    await host.stop();
  } catch (error) {
    logger.error("closing the exited SpaghettiKart host failed", error);
  }
}

/** BGRA → RGBA copy with opaque alpha, for screenshots. */
export function bgraToRgba(bgra: Buffer): Buffer {
  const rgba = Buffer.allocUnsafe(bgra.length);
  for (let i = 0; i < bgra.length; i += 4) {
    rgba[i] = bgra[i + 2] ?? 0;
    rgba[i + 1] = bgra[i + 1] ?? 0;
    rgba[i + 2] = bgra[i] ?? 0;
    rgba[i + 3] = 0xff;
  }
  return rgba;
}

/**
 * The game must run on a display-less server. SDL's offscreen driver gives it
 * an EGL context with no window system; Mesa picks the GPU render node when
 * the pod has one and llvmpipe otherwise. macOS keeps its hidden Cocoa window.
 */
function platformEnv(): Record<string, string> {
  return process.platform === "linux" ? { SDL_VIDEODRIVER: "offscreen" } : {};
}

export class SpaghettiEngine implements GameEngine {
  readonly format: FrameFormat;
  private readonly opts: SpaghettiEngineOptions;
  private readonly metrics: MetricSink;
  private host: BridgeHost | undefined;
  private running = false;
  private pacedRequested = false;
  private readonly inputs: PlayerInputState[];
  private readonly pads: Pad[];
  private pendingInputs: PendingInput[] = [];
  /** drawSeq of the first frame since start/reset: content time zero. */
  private originDrawSeq: number | undefined;
  private audioSampleFrames = 0;
  private lastSeatActivity: readonly boolean[] = [];
  private screenshotWaiters: ScreenshotWaiter[] = [];
  private sawFormatFrame = false;
  private warnedSizeMismatch = false;
  private onFrameCb: ((frame: EngineFrame) => void) | undefined;
  private onAudioCb: ((pcm: Buffer, contentEndMs: number) => void) | undefined;
  private onSnapshotCb: ((snapshot: Mk64Snapshot) => void) | undefined;

  constructor(opts: SpaghettiEngineOptions) {
    this.opts = opts;
    this.format = spaghettiFormat(opts.outputFps);
    this.metrics = opts.metrics ?? createPromMetricSink();
    this.inputs = Array.from({ length: MAX_SEATS }, () =>
      structuredClone(EMPTY_INPUT),
    );
    this.pads = Array.from({ length: MAX_SEATS }, () => ({ ...NEUTRAL_PAD }));
  }

  get latestSeatActivity(): readonly boolean[] {
    return this.lastSeatActivity;
  }

  async init(): Promise<void> {
    if (this.host !== undefined) {
      throw new Error("SpaghettiEngine.init called twice");
    }
    const callbacks: BridgeHostCallbacks = {
      onFrame: (frame) => {
        this.handleFrame(frame);
      },
      onAudio: (audio) => {
        this.handleAudio(audio);
      },
      onState: (state) => {
        this.handleState(state);
      },
      onUnexpectedExit: (error) => {
        this.handleExit(error);
      },
    };
    const factory =
      this.opts.hostFactory ??
      ((cb: BridgeHostCallbacks) =>
        new SpaghettiHost({
          build: this.opts.build,
          homeDir: this.opts.homeDir,
          lockstep: true,
          outputFps: this.opts.outputFps,
          env: platformEnv(),
          ...cb,
        }));
    const host = factory(callbacks);
    this.host = host;
    try {
      this.checkHello(await host.start());
    } catch (error) {
      this.host = undefined;
      await host.stop();
      throw error;
    }
    logger.info("SpaghettiKart booted", { fps: this.format.fps });
  }

  /** The game's announced media must match what the encoders were sized for. */
  private checkHello(hello: Hello): void {
    const problems: string[] = [];
    if (hello.protocolVersion !== BRIDGE_PROTOCOL_VERSION) {
      problems.push(`protocol ${String(hello.protocolVersion)}`);
    }
    if (hello.audioRate !== this.format.audioSampleRate) {
      problems.push(`audio ${String(hello.audioRate)} Hz`);
    }
    if (hello.outputFps !== this.format.fps) {
      problems.push(`${String(hello.outputFps)} fps`);
    }
    if (problems.length > 0) {
      throw new Error(
        `SpaghettiKart bridge mismatch: ${problems.join(", ")} (expected protocol ` +
          `${String(BRIDGE_PROTOCOL_VERSION)}, ${String(this.format.audioSampleRate)} Hz, ` +
          `${String(this.format.fps)} fps)`,
      );
    }
  }

  start(): void {
    const host = this.requireHost();
    if (this.running) return;
    this.running = true;
    this.resetTimeline();
    if (!this.pacedRequested) {
      this.pacedRequested = true;
      host.runPaced();
    }
  }

  async stop(): Promise<void> {
    const host = this.host;
    this.running = false;
    this.host = undefined;
    this.pendingInputs = [];
    this.failScreenshots(new Error("SpaghettiKart stopped"));
    await host?.stop();
  }

  restartFromStartMenu(reason: EngineRestartReason): void {
    const host = this.requireHost();
    for (let seat = 0; seat < MAX_SEATS; seat++) this.clearSeat(seat);
    host.sendInput(this.pads);
    this.pendingInputs = [];
    host.reset();
    this.resetTimeline();
    this.metrics.incRestarts(reason);
    logger.info("SpaghettiKart restarted", { reason });
  }

  setPlayerInput(seat: number, state: PlayerInputState): void {
    const host = this.host;
    if (host === undefined || seat < 0 || seat >= MAX_SEATS) return;
    this.inputs[seat] = state;
    this.pads[seat] = padFromInput(state);
    const seq = host.sendInput(this.pads);
    this.pendingInputs.push({ seq, seat, receivedAtMs: epochNowMs() });
    if (this.pendingInputs.length > MAX_PENDING_INPUTS) {
      this.pendingInputs.shift();
    }
  }

  clearPlayerInput(seat: number): void {
    const host = this.host;
    if (host === undefined || seat < 0 || seat >= MAX_SEATS) return;
    this.clearSeat(seat);
    this.pendingInputs = this.pendingInputs.filter((p) => p.seat !== seat);
    host.sendInput(this.pads);
  }

  private clearSeat(seat: number): void {
    this.inputs[seat] = structuredClone(EMPTY_INPUT);
    this.pads[seat] = { ...NEUTRAL_PAD };
  }

  /** The next frame, before any overlay draws into it. */
  renderFrame(): Promise<EngineScreenshot> {
    if (this.host === undefined || !this.running) {
      return Promise.reject(new Error("SpaghettiKart is not running"));
    }
    return new Promise<EngineScreenshot>((resolve, reject) => {
      const waiter: ScreenshotWaiter = { resolve, reject };
      this.screenshotWaiters.push(waiter);
      setTimeout(() => {
        const at = this.screenshotWaiters.indexOf(waiter);
        if (at === -1) return;
        this.screenshotWaiters.splice(at, 1);
        reject(new Error("SpaghettiKart produced no frame for the screenshot"));
      }, SCREENSHOT_TIMEOUT_MS);
    });
  }

  onFrame(cb: (frame: EngineFrame) => void): void {
    this.onFrameCb = cb;
  }

  onAudio(cb: (pcm: Buffer, contentEndMs: number) => void): void {
    this.onAudioCb = cb;
  }

  onSnapshot(cb: (snapshot: Mk64Snapshot) => void): void {
    this.onSnapshotCb = cb;
  }

  private requireHost(): BridgeHost {
    const host = this.host;
    if (host === undefined) throw new Error("SpaghettiKart is not running");
    return host;
  }

  private resetTimeline(): void {
    this.originDrawSeq = undefined;
    this.audioSampleFrames = 0;
  }

  private handleFrame(frame: FrameMessage): void {
    if (!this.running) return;
    if (
      frame.width !== this.format.width ||
      frame.height !== this.format.height
    ) {
      // Both encoders were sized for the configured format; a frame of any
      // other size would desync their raw input. Drop it. The game's first
      // draw precedes its window resize, so only a mismatch after a
      // correctly sized frame is a fault, reported loudly once.
      if (this.sawFormatFrame && !this.warnedSizeMismatch) {
        this.warnedSizeMismatch = true;
        logger.error("SpaghettiKart frame has an unexpected size", {
          width: frame.width,
          height: frame.height,
        });
        Sentry.captureMessage("SpaghettiKart frame size mismatch", "error");
      }
      return;
    }
    this.sawFormatFrame = true;
    this.originDrawSeq ??= frame.drawSeq;
    const contentTimeMs =
      ((frame.drawSeq - this.originDrawSeq) * 1000) / this.format.fps;
    const inputReceivedAtMs = this.drainLatchedInputs(frame);

    if (this.screenshotWaiters.length > 0) {
      const shot: EngineScreenshot = {
        rgba: bgraToRgba(frame.bgra),
        width: frame.width,
        height: frame.height,
      };
      const waiters = this.screenshotWaiters;
      this.screenshotWaiters = [];
      for (const waiter of waiters) waiter.resolve(shot);
    }

    this.metrics.incTicks(1);
    const activity = seatActivity(this.inputs, this.opts.seats);
    this.lastSeatActivity = activity;
    const cb = this.onFrameCb;
    if (cb === undefined) return;
    this.safeInvoke("frame", () => {
      cb({
        rgba: frame.bgra,
        height: frame.height,
        seatActivity: activity,
        contentTimeMs,
        ...(inputReceivedAtMs === undefined ? {} : { inputReceivedAtMs }),
      });
    });
  }

  /**
   * Retire every input the frame's game tick latched. Observes the
   * arrival-to-latch delay once per seat (the earliest arrival, as
   * InputLatencyTracker does) and returns the earliest arrival overall: this
   * frame is the first to reflect those inputs.
   */
  private drainLatchedInputs(frame: FrameMessage): number | undefined {
    let latched = 0;
    while (
      latched < this.pendingInputs.length &&
      (this.pendingInputs[latched]?.seq ?? Infinity) <= frame.latchedInputSeq
    ) {
      latched += 1;
    }
    if (latched === 0) return undefined;
    const retired = this.pendingInputs.slice(0, latched);
    this.pendingInputs = this.pendingInputs.slice(latched);

    const latchedAtMs = epochNowMs() - frame.latchToCaptureUs / 1000;
    const earliestBySeat = new Map<number, number>();
    for (const input of retired) {
      const seen = earliestBySeat.get(input.seat);
      if (seen === undefined || input.receivedAtMs < seen) {
        earliestBySeat.set(input.seat, input.receivedAtMs);
      }
    }
    let earliest: number | undefined;
    for (const receivedAtMs of earliestBySeat.values()) {
      this.metrics.observeInputApplyDelayMs(
        Math.max(0, latchedAtMs - receivedAtMs),
      );
      earliest =
        earliest === undefined
          ? receivedAtMs
          : Math.min(earliest, receivedAtMs);
    }
    return earliest;
  }

  private handleAudio(audio: AudioMessage): void {
    if (!this.running) return;
    this.audioSampleFrames += audio.pcm.length / 4;
    const contentEndMs =
      (this.audioSampleFrames * 1000) / this.format.audioSampleRate;
    const cb = this.onAudioCb;
    if (cb === undefined) return;
    this.safeInvoke("audio", () => {
      cb(audio.pcm, contentEndMs);
    });
  }

  private handleState(state: StateMessage): void {
    if (!this.running) return;
    if (state.gameFrame % this.opts.snapshotEveryNFrames !== 0) return;
    const cb = this.onSnapshotCb;
    if (cb === undefined) return;
    this.safeInvoke("snapshot", () => {
      cb(snapshotFromRawState(state.raw));
    });
  }

  /**
   * The game died mid-session. Detach and close its host so input, restarts
   * and screenshots fail fast instead of queueing for a process that is gone;
   * the stream freezes until the session is stopped.
   */
  private handleExit(error: Error): void {
    logger.error("SpaghettiKart exited unexpectedly", {
      error: error.message,
    });
    Sentry.captureException(error);
    const host = this.host;
    this.host = undefined;
    this.running = false;
    this.pendingInputs = [];
    this.failScreenshots(error);
    if (host !== undefined) void closeExitedHost(host);
  }

  private failScreenshots(error: Error): void {
    const waiters = this.screenshotWaiters;
    this.screenshotWaiters = [];
    for (const waiter of waiters) waiter.reject(error);
  }

  /**
   * Run a consumer callback without letting a throw escape the socket handler
   * and end the game: a transient stream-path failure must not take the whole
   * session down.
   */
  private safeInvoke(what: string, fn: () => void): void {
    try {
      fn();
    } catch (error) {
      logger.error("engine callback failed", {
        what,
        error: error instanceof Error ? error.message : String(error),
      });
      Sentry.captureException(error);
    }
  }
}
