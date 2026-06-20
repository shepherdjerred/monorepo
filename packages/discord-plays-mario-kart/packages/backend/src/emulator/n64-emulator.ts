import path from "node:path";
import { logger } from "#src/logger.ts";
import {
  persistMemfsToHost,
  restoreHostToMemfs,
  type FsModule,
} from "./save-persistence.ts";
import { installBrowserStubs, getFakeCanvas } from "./wasm-host.ts";
import { buildConfigTxt } from "./config-txt.ts";
import { drainRing } from "./audio-ring.ts";
import {
  WIDTH,
  HEIGHT,
  BUTTON_ORDER,
  MAX_SEATS,
  AUDIO_RING_SAMPLES,
} from "./constants.ts";
import {
  emulateMs,
  copyMs,
  lateMs,
  ticksTotal,
  loopResyncTotal,
  inputApplyDelayMs,
  emulatorRestartsTotal,
} from "#src/observability/metrics.ts";
import { InputLatencyTracker } from "#src/input/input-latency-tracker.ts";
import type {
  ButtonState,
  PlayerInputState,
} from "@discord-plays-mario-kart/common";
import { EMPTY_INPUT } from "@discord-plays-mario-kart/common";

type SendControls = (
  player: number,
  controls: string,
  axis0: string,
  axis1: string,
) => void;

// The validated emscripten runtime facade (built from the eval'd glue's
// untyped Module/FS at the FFI boundary via runtime checks — no casts).
type Runtime = {
  malloc: (n: number) => number;
  setRom: (ptr: number, size: number) => void;
  videoBuffer: () => number;
  videoHeight: () => number;
  rdramBase: () => number;
  // Byte address of the emscripten audio backend's resampled ring buffer (s16le,
  // 44.1 kHz, stereo) in wasm linear memory, and the current write index into it
  // (in int16 samples). See audio_backend_libretro.c.
  soundBuffer: () => number;
  audioWritePos: () => number;
  runMainLoop: () => void;
  reset: () => void;
  heap: () => Uint8Array;
  send: SendControls;
};

// A reusable empty PCM result so an idle tick (no new audio) allocates nothing.
const EMPTY_PCM = Buffer.alloc(0);

export type EmulatorRestartReason = "stream_session_ended";

export type N64EmulatorOptions = {
  wasmDir: string; // dir with n64wasm.js/.wasm + staged FS assets
  romPath: string; // path to the MK64 ROM (.z64/.v64)
  fps: number;
  software: boolean; // angrylion
  seats: number; // 1..4
  /**
   * Directory on the host filesystem where per-session emulator save state
   * (mempak/eeprom/SRAM — whatever the core writes into MEMFS that isn't a
   * staged asset) is persisted. When provided:
   *  - On `init()`, any files already in this directory are written into MEMFS
   *    BEFORE `callMain` so the core picks up the prior session's state.
   *  - On `persistSaves()`, MEMFS is walked and any file NOT in the known-asset
   *    allowlist (config.txt, shaders, custom.v64, overlay.png, res/*) is
   *    written to this directory.
   *
   * Set to a per-guild path (`saves/<guildId>/emulator`) to hard-isolate save
   * state across Discord servers. When omitted, save state lives only in MEMFS
   * and dies with the wasm module (the pre-pool legacy behaviour).
   */
  savesDir?: string;
};

function requireObject(u: unknown, what: string): object {
  if (typeof u !== "object" || u === null) {
    throw new TypeError(`${what} is not an object`);
  }
  return u;
}
function requireFn(
  host: object,
  name: string,
): (...args: unknown[]) => unknown {
  const f: unknown = Reflect.get(host, name);
  if (typeof f !== "function") {
    throw new TypeError(`emscripten export missing or not callable: ${name}`);
  }
  return (...args: unknown[]): unknown => {
    const result: unknown = Reflect.apply(f, host, args);
    return result;
  };
}
function asNumber(u: unknown): number {
  if (typeof u !== "number") throw new TypeError("expected number from wasm");
  return u;
}

function encodeButtons(b: ButtonState): string {
  let s = "";
  for (const name of BUTTON_ORDER) s += b[name] ? "1" : "0";
  return s;
}

/**
 * Headless N64Wasm (parallel-n64 + angrylion software RDP) host. Boots MK64
 * with the ROM injected into wasm memory, steps it at a fixed rate, injects
 * per-player input each frame, and reads the software-rendered RGBA frame
 * straight out of linear memory — no GPU, no canvas, no browser.
 */
export class N64Emulator {
  private readonly opts: N64EmulatorOptions;
  private rt: Runtime | undefined;
  /** The emscripten FS object — captured during init so persistSaves can walk it. */
  private fs: FsModule | undefined;
  private readonly inputs: PlayerInputState[];
  private readonly inputLatency = new InputLatencyTracker(MAX_SEATS);
  private onFrameCb: ((rgba: Buffer) => void) | undefined;
  private onAudioCb: ((pcm: Buffer) => void) | undefined;
  // Ring-buffer read cursor (int16 sample index) — how far we've drained audio.
  private audioReadPos = 0;
  private running = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private nextAt = 0;
  private frameMs: number;
  private lastHeight = 240;

  constructor(opts: N64EmulatorOptions) {
    this.opts = opts;
    this.frameMs = 1000 / opts.fps;
    this.inputs = Array.from({ length: MAX_SEATS }, () =>
      structuredClone(EMPTY_INPUT),
    );
  }

  get height(): number {
    return this.lastHeight;
  }

  async init(): Promise<void> {
    installBrowserStubs();
    const { wasmDir, romPath, software } = this.opts;

    const wasmBinary = new Uint8Array(
      await Bun.file(path.join(wasmDir, "n64wasm.wasm")).arrayBuffer(),
    );
    const glue = await Bun.file(path.join(wasmDir, "n64wasm.js")).text();
    const rom = new Uint8Array(await Bun.file(romPath).arrayBuffer());

    const ready = new Promise<void>((resolve) => {
      Object.defineProperty(globalThis, "Module", {
        configurable: true,
        writable: true,
        value: {
          wasmBinary,
          canvas: getFakeCanvas(),
          noInitialRun: true,
          print: (s: string) => {
            logger.info(`[n64] ${s}`);
          },
          printErr: (s: string) => {
            logger.warn(`[n64] ${s}`);
          },
          onRuntimeInitialized: () => {
            resolve();
          },
          locateFile: (p: string) => path.join(wasmDir, p),
        },
      });
    });

    // Run the (browser-built) emscripten glue at global scope; it augments
    // globalThis.Module with the wasm exports and sets the global FS.
    (0, eval)(glue);
    await ready;

    const mod = requireObject(Reflect.get(globalThis, "Module"), "Module");
    const fs = requireObject(Reflect.get(globalThis, "FS"), "FS");

    // Build the typed runtime facade (validated FFI wrappers).
    const malloc = requireFn(mod, "_malloc");
    const heap = (): Uint8Array => {
      const h: unknown = Reflect.get(mod, "HEAPU8");
      if (!(h instanceof Uint8Array)) throw new TypeError("HEAPU8 unavailable");
      return h;
    };
    const setRom = requireFn(mod, "_neilSetRom");
    const videoBuffer = requireFn(mod, "_neilGetVideoBuffer");
    const videoHeight = requireFn(mod, "_neilGetVideoHeight");
    const rdramBase = requireFn(mod, "_neilGetRdram");
    const soundBuffer = requireFn(mod, "_neilGetSoundBufferResampledAddress");
    const audioWritePos = requireFn(mod, "_neilGetAudioWritePosition");
    const runMainLoop = requireFn(mod, "_runMainLoop");
    const reset = requireFn(mod, "_neil_reset");
    const callMain = requireFn(mod, "callMain");
    const cwrap = requireFn(mod, "cwrap");
    const fsWrite = requireFn(fs, "writeFile");
    const fsMkdir = requireFn(fs, "mkdir");
    const fsReadFile = requireFn(fs, "readFile");
    const fsReaddir = requireFn(fs, "readdir");
    const fsStat = requireFn(fs, "stat");
    // Build the typed FS facade for save persistence APIs.
    const fsFacade: FsModule = {
      writeFile: (p, data) => {
        fsWrite(p, data);
      },
      readFile: (p) => {
        const bytes = fsReadFile(p);
        if (!(bytes instanceof Uint8Array)) {
          throw new TypeError(`FS.readFile(${p}) did not return Uint8Array`);
        }
        return bytes;
      },
      readdir: (p) => {
        const entries = fsReaddir(p);
        if (!Array.isArray(entries)) {
          throw new TypeError(`FS.readdir(${p}) did not return an array`);
        }
        const safe: string[] = [];
        for (const e of entries) {
          if (typeof e !== "string") {
            throw new TypeError(`FS.readdir(${p}) yielded non-string`);
          }
          safe.push(e);
        }
        return safe;
      },
      mkdir: (p) => {
        try {
          fsMkdir(p);
        } catch {
          /* already exists */
        }
      },
      stat: (p) => {
        const s = fsStat(p);
        if (typeof s !== "object" || s === null) {
          throw new TypeError(`FS.stat(${p}) did not return an object`);
        }
        const mode: unknown = Reflect.get(s, "mode");
        if (typeof mode !== "number") {
          throw new TypeError(`FS.stat(${p}).mode is not a number`);
        }
        return { mode };
      },
    };
    this.fs = fsFacade;

    // angrylion software-renderer config.
    fsWrite("config.txt", buildConfigTxt({ angrylion: software }));

    // Stage the files the core's loadFile() reads from MEMFS (it has no
    // null-check on a missing file, so they must exist or fseek(NULL) traps).
    for (const f of ["shader_vert.hlsl", "shader_frag.hlsl"]) {
      fsWrite(
        f,
        new Uint8Array(await Bun.file(path.join(wasmDir, f)).arrayBuffer()),
      );
    }
    try {
      fsMkdir("res");
    } catch {
      /* already exists */
    }
    for (const [src, dst] of [
      ["overlay.png", "overlay.png"],
      ["res/arial.ttf", "res/arial.ttf"],
    ]) {
      try {
        fsWrite(
          dst,
          new Uint8Array(await Bun.file(path.join(wasmDir, src)).arrayBuffer()),
        );
      } catch {
        /* optional asset */
      }
    }

    // Restore any previously-persisted save state into MEMFS BEFORE the core
    // boots. The first time a guild plays its savesDir is empty so this is a
    // no-op; subsequent sessions for the same guild pick up where they left off.
    if (this.opts.savesDir !== undefined) {
      await restoreHostToMemfs(fsFacade, this.opts.savesDir);
    }

    // Inject the ROM (bypasses the Node fseek trap).
    const romPtr = asNumber(malloc(rom.length));
    heap().set(rom, romPtr);
    setRom(romPtr, rom.length);

    const sendRaw = cwrap("neil_send_mobile_controls_player", null, [
      "number",
      "string",
      "string",
      "string",
    ]);
    if (typeof sendRaw !== "function") {
      throw new TypeError("cwrap did not return a function");
    }
    const send: SendControls = (player, controls, axis0, axis1) => {
      Reflect.apply(sendRaw, undefined, [player, controls, axis0, axis1]);
    };

    this.rt = {
      malloc: (n) => asNumber(malloc(n)),
      setRom: (ptr, size) => {
        setRom(ptr, size);
      },
      videoBuffer: () => asNumber(videoBuffer()),
      videoHeight: () => asNumber(videoHeight()),
      rdramBase: () => asNumber(rdramBase()),
      soundBuffer: () => asNumber(soundBuffer()),
      audioWritePos: () => asNumber(audioWritePos()),
      runMainLoop: () => {
        runMainLoop();
      },
      reset: () => {
        reset();
      },
      heap,
      send,
    };

    callMain(["custom.v64"]);
    logger.info("n64 emulator booted");
  }

  onFrame(cb: (rgba: Buffer) => void): void {
    this.onFrameCb = cb;
  }

  /**
   * Register a sink for resampled PCM (s16le, 44.1 kHz, stereo). Called once per
   * tick after the frame advances, with the audio the core produced this step.
   * Subscribing snaps the read cursor to the current write head so the first tick
   * doesn't flush a backlog of pre-subscription samples (which would leave audio
   * permanently leading video).
   */
  onAudio(cb: (pcm: Buffer) => void): void {
    this.onAudioCb = cb;
    this.resyncAudioCursor();
  }

  /** Snap the audio read cursor to the core's current write position. */
  private resyncAudioCursor(): void {
    const rt = this.rt;
    if (rt !== undefined) this.audioReadPos = rt.audioWritePos();
  }

  /**
   * Drain the resampled audio ring buffer from `audioReadPos` up to the core's
   * current write head, returning interleaved s16le stereo PCM. The wraparound
   * math lives in the pure {@link drainRing} (unit-tested in audio-ring.test.ts).
   */
  private drainAudio(): Buffer {
    const rt = this.rt;
    if (rt === undefined) return EMPTY_PCM;
    const base = rt.soundBuffer();
    if (!base) return EMPTY_PCM;
    const { pcm, readPos } = drainRing({
      heap: rt.heap(),
      base,
      ringSamples: AUDIO_RING_SAMPLES,
      readPos: this.audioReadPos,
      writePos: rt.audioWritePos(),
    });
    this.audioReadPos = readPos;
    return pcm;
  }

  setPlayerInput(player: number, state: PlayerInputState): void {
    if (player < 0 || player >= MAX_SEATS) return;
    this.inputs[player] = state;
    this.inputLatency.record(player);
  }

  /**
   * Re-pace the tick loop. Used by the perf harness to navigate menus in
   * sprint mode then switch to realtime for the measurement window — production
   * is constructed once at the target fps and never calls this.
   */
  setFps(fps: number): void {
    this.frameMs = 1000 / fps;
  }

  /** Zero a player's input (e.g. on disconnect) so a held key doesn't stick. */
  clearPlayerInput(player: number): void {
    if (player < 0 || player >= MAX_SEATS) return;
    this.inputs[player] = structuredClone(EMPTY_INPUT);
    this.inputLatency.clear(player);
  }

  /**
   * Snapshot MEMFS into `savesDir` on the host so a subsequent `init()` for
   * the same guild can restore in-game progress. No-op when `savesDir` was not
   * provided or `init()` hasn't run yet. See {@link persistMemfsToHost} for
   * the file-by-file semantics.
   */
  async persistSaves(): Promise<void> {
    const dir = this.opts.savesDir;
    if (dir === undefined) return;
    const fs = this.fs;
    if (fs === undefined) return;
    await persistMemfsToHost(fs, dir);
  }

  /** Per-seat "any control held" flags (buttons or analog deflection), for the
   *  stream HUD's input-echo indicators. Runs once per emulated frame on the hot
   *  loop, so it avoids the per-seat `slice()`/`Object.values()` allocations and
   *  scans `BUTTON_ORDER` in place instead. */
  seatActivity(): boolean[] {
    const active: boolean[] = [];
    for (let i = 0; i < this.opts.seats; i++) {
      const s = this.inputs[i];
      let held = Math.abs(s.analogX) > 0.25 || Math.abs(s.analogY) > 0.25;
      if (!held) {
        for (const name of BUTTON_ORDER) {
          if (s.buttons[name]) {
            held = true;
            break;
          }
        }
      }
      active.push(held);
    }
    return active;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.nextAt = performance.now();
    this.loop();
  }

  stop(): void {
    this.running = false;
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
  }

  restartFromStartMenu(reason: EmulatorRestartReason): void {
    const rt = this.rt;
    if (rt === undefined) {
      throw new Error("cannot restart emulator before runtime initialization");
    }

    const wasRunning = this.running;
    this.stop();
    for (let player = 0; player < MAX_SEATS; player++) {
      this.clearPlayerInput(player);
    }
    rt.reset();
    this.lastHeight = HEIGHT;
    // The loop was stopped across reset(), so audio kept being written without
    // being drained; snap the cursor forward so we don't dump that gap on resume.
    this.resyncAudioCursor();
    emulatorRestartsTotal.inc({ reason });
    logger.info("n64 emulator restarted", { reason });
    if (wasRunning) {
      this.start();
    }
  }

  /**
   * Emulated N64 RDRAM as a window into wasm linear memory, for game-state
   * reads (leaderboards). `base` is the RDRAM offset within `heap`; decode
   * via mk64-memory.ts, which owns the byte-order contract (PATCHES.md §0003).
   * Undefined before init or if the core hasn't allocated RDRAM yet.
   */
  rdram(): { base: number; heap: Uint8Array } | undefined {
    const rt = this.rt;
    if (rt === undefined) return undefined;
    const base = rt.rdramBase();
    if (!base) return undefined;
    return { base, heap: rt.heap() };
  }

  /** Read the current frame as RGBA (for screenshots). */
  renderFrame(): { rgba: Buffer; width: number; height: number } {
    const rt = this.rt;
    if (rt === undefined) {
      return { rgba: Buffer.alloc(0), width: WIDTH, height: 0 };
    }
    const vbuf = rt.videoBuffer();
    const h = rt.videoHeight();
    if (!vbuf || !h) return { rgba: Buffer.alloc(0), width: WIDTH, height: 0 };
    return {
      rgba: Buffer.from(rt.heap().subarray(vbuf, vbuf + WIDTH * h * 4)),
      width: WIDTH,
      height: h,
    };
  }

  private tick(): void {
    const rt = this.rt;
    if (rt === undefined) return;

    // Push each seat's input before runMainLoop. The C side only LATCHES it
    // (into g_neilHostPads) and re-applies it inside mainLoopInner AFTER the
    // per-frame resetNeilButtons() — a direct write here would be wiped before
    // retro_run() polls it. See applyHostControls() in PATCHES.md.
    for (let p = 0; p < this.opts.seats; p++) {
      const s = this.inputs[p];
      rt.send(
        p,
        encodeButtons(s.buttons),
        String(s.analogX),
        String(s.analogY),
      );
    }
    // Everything pending is now latched into this tick.
    this.inputLatency.drainAll((ms) => {
      inputApplyDelayMs.observe(ms);
    });

    const emulateStart = performance.now();
    rt.runMainLoop();
    emulateMs.observe(performance.now() - emulateStart);

    const cb = this.onFrameCb;
    if (cb !== undefined) {
      const vbuf = rt.videoBuffer();
      const h = rt.videoHeight();
      if (vbuf && h) {
        this.lastHeight = h;
        // Copy out of the (reused) heap view before handing off.
        const copyStart = performance.now();
        cb(Buffer.from(rt.heap().subarray(vbuf, vbuf + WIDTH * h * 4)));
        copyMs.observe(performance.now() - copyStart);
      }
    }

    // Drain the audio the core produced this tick (after runMainLoop). Always
    // drained while subscribed — even when the stream sink is idle — so the read
    // cursor tracks the write head and a later stream start doesn't flush a
    // backlog. The sink is a no-op until a broadcast is live.
    const audioCb = this.onAudioCb;
    if (audioCb !== undefined) {
      const pcm = this.drainAudio();
      if (pcm.length > 0) audioCb(pcm);
    }
    ticksTotal.inc();
  }

  private loop(): void {
    if (!this.running) return;
    try {
      this.tick();
    } catch (error) {
      logger.error("emulator tick failed", error);
    }
    this.nextAt += this.frameMs;
    let delay = this.nextAt - performance.now();
    // delay < 0 means the tick overran its budget; record how far behind we are.
    lateMs.observe(Math.max(0, -delay));
    if (delay < -250) {
      // Fell far behind (paused process); resync rather than sprint.
      loopResyncTotal.inc();
      this.nextAt = performance.now();
      delay = 0;
    }
    this.timer = setTimeout(
      () => {
        this.loop();
      },
      Math.max(0, delay),
    );
  }
}
