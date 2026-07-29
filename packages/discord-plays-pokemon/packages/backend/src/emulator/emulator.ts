import { createAudioEngine } from "./audio/index.ts";
import type { DrainResult } from "./audio/m4a-driver.ts";
import { createBios } from "./bios.ts";
import { createRenderer } from "./renderer.ts";
import {
  FLASH_BASE,
  FLASH_SIZE,
  FRAME_MS,
  KEYINPUT,
  KEY_MASK,
} from "./constants.ts";
import {
  emulateMs,
  lateMs,
  ticksTotal,
  loopResyncTotal,
} from "@shepherdjerred/discord-plays-core/observability/metrics.ts";
import {
  copyMs,
  frameHookErrorsTotal,
  flashSaveLoadInvalidTotal,
} from "#src/observability/metrics.ts";
import { logger } from "#src/logger.ts";
import { createMemoryReader, type MemoryReader } from "./memory.ts";
import { createGameSymbols, type GameSymbols } from "./symbols.ts";
import {
  decodeEngineMapTile,
  decodeEngineObservation,
  ENGINE_OBSERVATION_SIZE,
  type EngineMapTile,
  type EngineObservationV1,
} from "./engine-observation.ts";
import { AtomicFlashPersistence } from "./flash-persistence.ts";

// Minimal view of the wasm exports we depend on, validated at runtime so we
// never assert types we haven't checked.
type WasmExports = {
  memory: WebAssembly.Memory;
  agbMain: () => void;
  runFrame: () => void;
  readObservation: () => number;
  readMapTile: (x: number, y: number) => number;
  checkpointSave: () => number;
};

function requireFunction(
  exports: Bun.WebAssembly.Exports,
  name: string,
): () => void {
  const value = exports[name];
  if (typeof value !== "function") {
    throw new TypeError(
      `wasm module is missing required function export: ${name}`,
    );
  }
  // Reflect.apply lets us invoke the validated export without a type assertion.
  return () => {
    Reflect.apply(value, undefined, []);
  };
}

function requireNumberFunction(
  exports: Bun.WebAssembly.Exports,
  name: string,
): () => number {
  const value = exports[name];
  if (typeof value !== "function") {
    throw new TypeError(
      `wasm module is missing required function export: ${name}`,
    );
  }
  return () => {
    const result: unknown = Reflect.apply(value, undefined, []);
    if (typeof result !== "number" || !Number.isInteger(result)) {
      throw new TypeError(`wasm export ${name} did not return an integer`);
    }
    return result;
  };
}

function requireNumberFunction2(
  exports: Bun.WebAssembly.Exports,
  name: string,
): (first: number, second: number) => number {
  const value = exports[name];
  if (typeof value !== "function") {
    throw new TypeError(
      `wasm module is missing required function export: ${name}`,
    );
  }
  return (first, second) => {
    const result: unknown = Reflect.apply(value, undefined, [first, second]);
    if (typeof result !== "number" || !Number.isInteger(result)) {
      throw new TypeError(`wasm export ${name} did not return an integer`);
    }
    return result;
  };
}

function requireMemory(exports: Bun.WebAssembly.Exports): WebAssembly.Memory {
  const value = exports["memory"];
  if (!(value instanceof WebAssembly.Memory)) {
    throw new TypeError("wasm module is missing required memory export");
  }
  return value;
}

export type InputSource = "interactive" | "goal";

export class InputLeaseConflictError extends Error {
  constructor(readonly owner: InputSource) {
    super(`input is exclusively leased by ${owner}`);
    this.name = "InputLeaseConflictError";
  }
}

type QueueStep = {
  mask: number;
  frames: number;
  source: InputSource;
  done?: () => void;
  reject?: (error: Error) => void;
};

export type EmulatorOptions = {
  wasmPath: string;
  savePath?: string;
  // How often (in frames) to flush the flash save if it changed. 60 ≈ 1s.
  saveIntervalFrames?: number;
};

export class Emulator {
  private readonly bios = createBios();
  private readonly audio = createAudioEngine();
  private readonly renderer = createRenderer();
  private readonly options: EmulatorOptions;

  private exports: WasmExports | undefined;
  private rawExports: Bun.WebAssembly.Exports | undefined;
  private cachedMemoryReader: MemoryReader | undefined;
  private cachedGameSymbols: GameSymbols | undefined;
  private u16 = new Uint16Array(0);
  private currentFrame = 0;

  private readonly queue: QueueStep[] = [];
  private inputLease: InputSource | undefined;
  private inputLeaseGeneration = 0;
  private onFrameCb: ((rgba: Buffer) => void) | undefined;
  private onAudioCb: ((pcm: DrainResult) => void) | undefined;
  private readonly frameHooks: ((frame: number) => void)[] = [];

  private loopTimer: ReturnType<typeof setTimeout> | undefined;
  private nextTickAt = 0;
  private lastSavedHash = 0;
  private readonly flashPersistence = new AtomicFlashPersistence();

  constructor(options: EmulatorOptions) {
    this.options = options;
  }

  get frame(): number {
    return this.currentFrame;
  }

  async init(): Promise<void> {
    const bytes = await Bun.file(this.options.wasmPath).bytes();
    const module = await WebAssembly.compile(bytes);
    const instance = await WebAssembly.instantiate(
      module,
      this.bios.imports(module),
    );

    const memory = requireMemory(instance.exports);
    this.rawExports = instance.exports;
    this.exports = {
      memory,
      agbMain: requireFunction(instance.exports, "AgbMain"),
      runFrame: requireFunction(instance.exports, "WasmRunFrame"),
      readObservation: requireNumberFunction(
        instance.exports,
        "WasmReadObservation",
      ),
      readMapTile: requireNumberFunction2(instance.exports, "WasmReadMapTile"),
      checkpointSave: requireNumberFunction(
        instance.exports,
        "WasmCheckpointSave",
      ),
    };

    // Views must be refreshed after instantiation, before any BIOS import or
    // game code runs. The wasm linear memory is fixed-size and never grows, so
    // these views stay valid for the process lifetime.
    this.bios.refresh(memory);
    this.audio.refresh(memory);
    this.audio.bindExports(instance.exports);
    this.renderer.refresh(memory);
    this.u16 = new Uint16Array(memory.buffer);

    await this.loadSave(memory);
    this.setKeys(0);
    this.exports.agbMain();
    logger.info(
      `emulator booted (${(bytes.length / 1_048_576).toFixed(1)} MiB wasm, ${(
        memory.buffer.byteLength / 1_048_576
      ).toFixed(0)} MiB memory)`,
    );
  }

  onFrame(cb: (rgba: Buffer) => void): void {
    this.onFrameCb = cb;
  }

  /**
   * Register a callback for PCM audio drained from the wasm's m4a engine after
   * each emulated frame. The drained `DrainResult` includes the native sample
   * rate (typically ~13379 Hz). The wasm's `AgbMain` runs `m4aSoundInit` for
   * us during boot, so the callback may fire from frame 0 — but it's null
   * until the title-screen track loader populates `pcmSamplesPerVBlank`.
   */
  onAudio(cb: (pcm: DrainResult) => void): void {
    this.onAudioCb = cb;
  }

  /**
   * Register a hook invoked after every emulated frame. Hooks are isolated:
   * a throwing hook is logged and counted, never breaking the frame loop or
   * other hooks. Used for game-state polling (event notifications).
   */
  addFrameHook(cb: (frame: number) => void): void {
    this.frameHooks.push(cb);
  }

  /** Typed read-only access to the wasm linear memory. Valid after init(). */
  memoryReader(): MemoryReader {
    if (this.exports === undefined) {
      throw new Error("emulator is not initialized");
    }
    this.cachedMemoryReader ??= createMemoryReader(this.exports.memory);
    return this.cachedMemoryReader;
  }

  /** Addresses of the game-state globals. Valid after init(). */
  gameSymbols(): GameSymbols {
    if (this.rawExports === undefined) {
      throw new Error("emulator is not initialized");
    }
    this.cachedGameSymbols ??= createGameSymbols(this.rawExports);
    return this.cachedGameSymbols;
  }

  /** Versioned, engine-authored phase/readiness/spatial observation. */
  engineObservation(): EngineObservationV1 {
    const exports = this.exports;
    if (exports === undefined) {
      throw new Error("emulator is not initialized");
    }
    const pointer = exports.readObservation();
    const reader = this.memoryReader();
    return decodeEngineObservation(
      reader.bytes(pointer, ENGINE_OBSERVATION_SIZE),
    );
  }

  /** Read one live current-map grid tile through the engine's map API. */
  engineMapTile(x: number, y: number): EngineMapTile | null {
    const exports = this.exports;
    if (exports === undefined) {
      throw new Error("emulator is not initialized");
    }
    if (!Number.isInteger(x) || !Number.isInteger(y)) {
      throw new TypeError("map tile coordinates must be integers");
    }
    return decodeEngineMapTile(x, y, exports.readMapTile(x, y));
  }

  /** Render the current frame to a fresh RGBA buffer (for screenshots). */
  renderFrame(): Buffer {
    const rgba = this.renderer.render();
    return Buffer.from(rgba);
  }

  /**
   * Serialize the current live game state through Emerald's save engine, then
   * durably flush the resulting emulated flash image before returning.
   */
  async checkpointSave(): Promise<void> {
    const exports = this.exports;
    if (exports === undefined) {
      throw new Error("emulator is not initialized");
    }
    const status = exports.checkpointSave();
    if (status !== 1) {
      throw new Error(
        `game engine failed to checkpoint live state: status ${String(status)}`,
      );
    }
    await this.saveIfChanged(true);
  }

  start(): void {
    if (this.loopTimer !== undefined) return;
    this.nextTickAt = performance.now();
    this.scheduleNext();
  }

  stop(): void {
    this.haltLoop();
    void this.saveInBackground(true);
  }

  async stopAndFlush(): Promise<void> {
    this.haltLoop();
    await this.saveIfChanged(true);
  }

  /**
   * Queue a timed button press against the running loop. Presses execute
   * serially in FIFO order: each holds `mask` for `holdFrames`, then releases
   * for `gapFrames`. Resolves once the press (and its gap) has elapsed.
   */
  queuePress(
    mask: number,
    holdFrames: number,
    gapFrames: number,
    source: InputSource = "interactive",
  ): Promise<void> {
    this.assertInputAllowed(source);
    return new Promise((resolve, reject) => {
      const hold = Math.max(1, Math.round(holdFrames));
      const gap = Math.max(0, Math.round(gapFrames));
      if (gap === 0) {
        this.queue.push({
          mask,
          frames: hold,
          source,
          done: resolve,
          reject,
        });
      } else {
        this.queue.push({ mask, frames: hold, source });
        this.queue.push({
          mask: 0,
          frames: gap,
          source,
          done: resolve,
          reject,
        });
      }
    });
  }

  /**
   * Grant one input source exclusive control. Queued commands from another
   * source are rejected immediately, so they cannot bleed into the goal after
   * the lease boundary. The returned release function is generation-scoped:
   * calling an old release can never unlock a newer lease.
   */
  acquireInputLease(source: InputSource): () => void {
    if (this.inputLease !== undefined) {
      throw new Error(`input is already leased by ${this.inputLease}`);
    }
    this.inputLease = source;
    this.inputLeaseGeneration += 1;
    const generation = this.inputLeaseGeneration;
    const rejected = new Set<(error: Error) => void>();
    for (const step of this.queue) {
      if (step.source !== source && step.reject !== undefined) {
        rejected.add(step.reject);
      }
    }
    this.queue.splice(
      0,
      this.queue.length,
      ...this.queue.filter((step) => step.source === source),
    );
    for (const reject of rejected) {
      reject(new InputLeaseConflictError(source));
    }
    return () => {
      if (
        this.inputLease === source &&
        this.inputLeaseGeneration === generation
      ) {
        this.inputLease = undefined;
      }
    };
  }

  private assertInputAllowed(source: InputSource): void {
    if (this.inputLease !== undefined && this.inputLease !== source) {
      throw new InputLeaseConflictError(this.inputLease);
    }
  }

  private setKeys(mask: number): void {
    // KEYINPUT is active-low: a set bit means released.
    this.u16[KEYINPUT >> 1] = KEY_MASK ^ (mask & KEY_MASK);
  }

  private scheduleNext(): void {
    const delay = Math.max(0, this.nextTickAt - performance.now());
    this.loopTimer = setTimeout(() => {
      this.tick();
    }, delay);
  }

  private tick(): void {
    const exports = this.exports;
    if (exports === undefined) return;

    let mask = 0;
    const head = this.queue.at(0);
    if (head !== undefined) {
      mask = head.mask;
      head.frames -= 1;
      if (head.frames <= 0) {
        this.queue.shift();
        head.done?.();
      }
    }

    this.setKeys(mask);
    const emulateStart = performance.now();
    exports.runFrame();
    emulateMs.observe(performance.now() - emulateStart);
    this.currentFrame += 1;

    // The wasm's mixer ran inside WasmRunFrame; we just read the freshly
    // written PCM buffer out. Skip the copy when nobody's listening.
    if (this.onAudioCb !== undefined) {
      const pcm = this.audio.drain();
      if (pcm !== null) this.onAudioCb(pcm);
    }

    if (this.onFrameCb !== undefined) {
      const copyStart = performance.now();
      const rgba = this.renderer.render();
      this.onFrameCb(Buffer.from(rgba));
      copyMs.observe(performance.now() - copyStart);
    }
    for (const hook of this.frameHooks) {
      try {
        hook(this.currentFrame);
      } catch (error) {
        frameHookErrorsTotal.inc();
        logger.error("frame hook failed", error);
      }
    }
    ticksTotal.inc();

    const interval = this.options.saveIntervalFrames ?? 60;
    if (this.currentFrame % interval === 0) {
      void this.saveInBackground(false);
    }

    // Self-correcting pacing: advance the target by one frame. If we fell
    // behind by more than a few frames (e.g. the process was paused), resync
    // rather than sprinting to catch up.
    this.nextTickAt += FRAME_MS;
    // behind > 0 means the tick overran its budget.
    const behind = performance.now() - this.nextTickAt;
    lateMs.observe(Math.max(0, behind));
    if (behind > 250) {
      loopResyncTotal.inc();
      this.nextTickAt = performance.now();
    }
    this.scheduleNext();
  }

  // ---- flash save persistence (replaces EmulatorJS getState/localStorage) ----

  private flashBytes(memory: WebAssembly.Memory): Uint8Array {
    return new Uint8Array(memory.buffer, FLASH_BASE, FLASH_SIZE);
  }

  private hash(bytes: Uint8Array): number {
    let h = 2_166_136_261;
    for (const byte of bytes) {
      h ^= byte;
      h = Math.imul(h, 16_777_619);
    }
    return h >>> 0;
  }

  private async loadSave(memory: WebAssembly.Memory): Promise<void> {
    const flash = this.flashBytes(memory);
    flash.fill(0xff);
    const path = this.options.savePath;
    if (path !== undefined) {
      const file = Bun.file(path);
      if (await file.exists()) {
        const saved = await file.bytes();
        if (saved.length === FLASH_SIZE) {
          flash.set(saved);
          logger.info(`loaded flash save from ${path}`);
        } else {
          flashSaveLoadInvalidTotal.inc();
          logger.warn(
            `ignoring flash save at ${path}: wrong size ${String(saved.length)}`,
          );
        }
      }
    }
    this.lastSavedHash = this.hash(flash);
  }

  private haltLoop(): void {
    if (this.loopTimer !== undefined) {
      clearTimeout(this.loopTimer);
      this.loopTimer = undefined;
    }
  }

  private async saveIfChanged(force: boolean): Promise<void> {
    const path = this.options.savePath;
    const memory = this.exports?.memory;
    if (path === undefined || memory === undefined) return;
    const flash = this.flashBytes(memory);
    const hash = this.hash(flash);
    if (!force && hash === this.lastSavedHash) return;
    // Copy out of live wasm memory and persist without blocking the frame loop.
    await this.flashPersistence.enqueue(path, new Uint8Array(flash));
    this.lastSavedHash = hash;
  }

  private async saveInBackground(force: boolean): Promise<void> {
    try {
      await this.saveIfChanged(force);
    } catch (error) {
      logger.error("failed to persist flash save", error);
    }
  }
}
