import path from "node:path";
import { logger } from "#src/logger.ts";
import { installBrowserStubs, getFakeCanvas } from "./wasm-host.ts";
import { buildConfigTxt } from "./config-txt.ts";
import { WIDTH, BUTTON_ORDER, MAX_SEATS } from "./constants.ts";
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
  runMainLoop: () => void;
  heap: () => Uint8Array;
  send: SendControls;
};

export type N64EmulatorOptions = {
  wasmDir: string; // dir with n64wasm.js/.wasm + staged FS assets
  romPath: string; // path to the MK64 ROM (.z64/.v64)
  fps: number;
  software: boolean; // angrylion
  seats: number; // 1..4
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
  private readonly inputs: PlayerInputState[];
  private onFrameCb: ((rgba: Buffer) => void) | undefined;
  private running = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private nextAt = 0;
  private readonly frameMs: number;
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
    const runMainLoop = requireFn(mod, "_runMainLoop");
    const callMain = requireFn(mod, "callMain");
    const cwrap = requireFn(mod, "cwrap");
    const fsWrite = requireFn(fs, "writeFile");
    const fsMkdir = requireFn(fs, "mkdir");

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
      runMainLoop: () => {
        runMainLoop();
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

  setPlayerInput(player: number, state: PlayerInputState): void {
    if (player < 0 || player >= MAX_SEATS) return;
    this.inputs[player] = state;
  }

  /** Zero a player's input (e.g. on disconnect) so a held key doesn't stick. */
  clearPlayerInput(player: number): void {
    if (player < 0 || player >= MAX_SEATS) return;
    this.inputs[player] = structuredClone(EMPTY_INPUT);
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

    // Apply each seat's latched input IMMEDIATELY before runMainLoop (the core
    // zeroes neilbuttons[*] at frame start then polls — see PATCHES.md).
    for (let p = 0; p < this.opts.seats; p++) {
      const s = this.inputs[p];
      rt.send(
        p,
        encodeButtons(s.buttons),
        String(s.analogX),
        String(s.analogY),
      );
    }

    rt.runMainLoop();

    const cb = this.onFrameCb;
    if (cb !== undefined) {
      const vbuf = rt.videoBuffer();
      const h = rt.videoHeight();
      if (vbuf && h) {
        this.lastHeight = h;
        // Copy out of the (reused) heap view before handing off.
        cb(Buffer.from(rt.heap().subarray(vbuf, vbuf + WIDTH * h * 4)));
      }
    }
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
    if (delay < -250) {
      // Fell far behind (paused process); resync rather than sprint.
      this.nextAt = performance.now();
      delay = 0;
    }
    this.timer = setTimeout(() => {
      this.loop();
    }, Math.max(0, delay));
  }
}
