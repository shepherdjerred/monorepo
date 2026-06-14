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
  copyMs,
  lateMs,
  ticksTotal,
  loopResyncTotal,
  frameHookErrorsTotal,
} from "#src/observability/metrics.ts";
import { logger } from "#src/logger.ts";
import { createMemoryReader, type MemoryReader } from "./memory.ts";
import { createGameSymbols, type GameSymbols } from "./symbols.ts";

// Minimal view of the wasm exports we depend on, validated at runtime so we
// never assert types we haven't checked.
type WasmExports = {
  memory: WebAssembly.Memory;
  agbMain: () => void;
  runFrame: () => void;
};

function requireFunction(
  exports: WebAssembly.Exports,
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

function requireMemory(exports: WebAssembly.Exports): WebAssembly.Memory {
  const value = exports.memory;
  if (!(value instanceof WebAssembly.Memory)) {
    throw new TypeError("wasm module is missing required memory export");
  }
  return value;
}

type QueueStep = { mask: number; frames: number; done?: () => void };

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
  private rawExports: WebAssembly.Exports | undefined;
  private cachedMemoryReader: MemoryReader | undefined;
  private cachedGameSymbols: GameSymbols | undefined;
  private u16 = new Uint16Array(0);
  private currentFrame = 0;

  private readonly queue: QueueStep[] = [];
  private onFrameCb: ((rgba: Buffer) => void) | undefined;
  private onAudioCb: ((pcm: DrainResult) => void) | undefined;
  private readonly frameHooks: ((frame: number) => void)[] = [];

  private loopTimer: ReturnType<typeof setTimeout> | undefined;
  private nextTickAt = 0;
  private lastSavedHash = 0;

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
      this.bios.imports(module, { extras: this.audio.extras }),
    );

    const memory = requireMemory(instance.exports);
    this.rawExports = instance.exports;
    this.exports = {
      memory,
      agbMain: requireFunction(instance.exports, "AgbMain"),
      runFrame: requireFunction(instance.exports, "WasmRunFrame"),
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
   * Register a callback for PCM audio drained from the wasm-side m4a mixer
   * after each emulated frame. The drained `DrainResult` includes the native
   * sample rate (typically ~13379 Hz). The wasm's natural boot path does not
   * initialise the mixer; call `initAudio()` after `init()` if you want PCM
   * starting from the first frame instead of waiting for the game to start
   * music on its own.
   */
  onAudio(cb: (pcm: DrainResult) => void): void {
    this.onAudioCb = cb;
  }

  /**
   * Bootstrap the wasm-side m4a engine (`SoundInit` + `m4aSoundMode` at
   * 13379 Hz). Call once after `init()` if you want deterministic PCM from
   * frame 0. Idempotent.
   */
  initAudio(): void {
    this.audio.initEngine();
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

  /** Render the current frame to a fresh RGBA buffer (for screenshots). */
  renderFrame(): Buffer {
    const rgba = this.renderer.render();
    return Buffer.from(rgba);
  }

  start(): void {
    if (this.loopTimer !== undefined) return;
    this.nextTickAt = performance.now();
    this.scheduleNext();
  }

  stop(): void {
    if (this.loopTimer !== undefined) {
      clearTimeout(this.loopTimer);
      this.loopTimer = undefined;
    }
    this.saveIfChanged(true);
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
  ): Promise<void> {
    return new Promise((resolve) => {
      const hold = Math.max(1, Math.round(holdFrames));
      const gap = Math.max(0, Math.round(gapFrames));
      if (gap === 0) {
        this.queue.push({ mask, frames: hold, done: resolve });
      } else {
        this.queue.push({ mask, frames: hold });
        this.queue.push({ mask: 0, frames: gap, done: resolve });
      }
    });
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

    // Always tick the mixer — m4aSoundMain must fire unconditionally every
    // VBlank (it advances the track-command interpreter and per-channel state).
    // Gating on onAudioCb would freeze the music engine for callers that don't
    // register an audio consumer (video-only streams, graphics-only tests, etc).
    const pcm = this.audio.tickAndDrain();
    if (pcm !== null && this.onAudioCb !== undefined) {
      this.onAudioCb(pcm);
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
    if (this.currentFrame % interval === 0) this.saveIfChanged(false);

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
          logger.warn(
            `ignoring flash save at ${path}: wrong size ${String(saved.length)}`,
          );
        }
      }
    }
    this.lastSavedHash = this.hash(flash);
  }

  private saveIfChanged(force: boolean): void {
    const path = this.options.savePath;
    const memory = this.exports?.memory;
    if (path === undefined || memory === undefined) return;
    const flash = this.flashBytes(memory);
    const hash = this.hash(flash);
    if (!force && hash === this.lastSavedHash) return;
    this.lastSavedHash = hash;
    // Copy out of live wasm memory and persist without blocking the frame loop.
    void this.persist(path, new Uint8Array(flash));
  }

  private async persist(path: string, data: Uint8Array): Promise<void> {
    try {
      await Bun.write(path, data);
    } catch (error) {
      logger.error("failed to persist flash save", error);
    }
  }
}
