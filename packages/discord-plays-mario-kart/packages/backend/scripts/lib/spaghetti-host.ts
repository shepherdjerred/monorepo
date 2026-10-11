// Client for the SpaghettiKart host bridge (spaghetti-src/patches, see
// spaghetti-src/PATCHES.md). Spawns the native MK64 port, listens on a Unix
// socket it connects to, and exchanges the bridge's little-endian messages:
// input/step/reset/quit out; hello/frame/audio/state in.
//
// Spike-only for now: the latency harness uses it to compare the native port
// with the wasm emulator. Needs `bun run --cwd ../.. build:spaghetti` (which
// also needs the ROM), so it never runs in CI.
import { mkdir, mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { z } from "zod";
import type { PlayerInputState } from "@discord-plays-mario-kart/common";

const PACKAGE_ROOT = path.resolve(import.meta.dirname, "../../../..");
export const SPAGHETTI_CACHE = path.join(PACKAGE_ROOT, ".cache/spaghetti");
const MANIFEST_PATH = path.join(SPAGHETTI_CACHE, "dist/manifest.json");

export const MSG = {
  hello: 1,
  frame: 2,
  audio: 3,
  state: 4,
  input: 16,
  step: 17,
  reset: 18,
  quit: 19,
  runPaced: 20,
} as const;

/** N64 controller button bits (libultra CONT_*). */
export const N64_BUTTON = {
  a: 0x80_00,
  b: 0x40_00,
  z: 0x20_00,
  start: 0x10_00,
  up: 0x08_00,
  down: 0x04_00,
  left: 0x02_00,
  right: 0x01_00,
  l: 0x00_20,
  r: 0x00_10,
  cUp: 0x00_08,
  cDown: 0x00_04,
  cLeft: 0x00_02,
  cRight: 0x00_01,
} as const;

/** Full N64 stick deflection, matching the wasm core's 32000-of-32767 scale. */
const STICK_RANGE = 80;

export type Pad = { button: number; stickX: number; stickY: number };

export const NEUTRAL_PAD: Pad = { button: 0, stickX: 0, stickY: 0 };

const BUTTON_BITS = new Map<string, number>(Object.entries(N64_BUTTON));

export function padFromInput(input: PlayerInputState): Pad {
  let button = 0;
  for (const [name, pressed] of Object.entries(input.buttons)) {
    if (pressed) button |= BUTTON_BITS.get(name) ?? 0;
  }
  return {
    button,
    stickX: Math.round(input.analogX * STICK_RANGE),
    stickY: Math.round(input.analogY * STICK_RANGE),
  };
}

export type Hello = {
  protocolVersion: number;
  audioRate: number;
  outputFps: number;
  lockstep: boolean;
};

export type Frame = {
  drawSeq: number;
  gameFrame: number;
  latchedInputSeq: number;
  latchToCaptureUs: number;
  width: number;
  height: number;
  /** BGRA, top row first. Valid only during the callback. */
  bgra: Buffer;
  receivedAtMs: number;
};

export type AudioChunk = { gameFrame: number; samples: Int16Array };

export type PlayerState = {
  type: number;
  currentRank: number;
  characterId: number;
};

export type GameState = {
  gameFrame: number;
  gamestate: number;
  raceState: number;
  menuSelection: number;
  activeScreenMode: number;
  playerCountSelection: number;
  modeSelection: number;
  courseId: number;
  players: PlayerState[];
  hud: { timer: number; raceComplete: number }[];
};

const HELLO_BYTES = 16;
const FRAME_HEADER_BYTES = 24;
const AUDIO_HEADER_BYTES = 8;
const STATE_BYTES = 4 * 7 + 4 + 4 * 8 + 4 * 8;

function parseState(b: Buffer): GameState {
  const players: PlayerState[] = [];
  const hud: GameState["hud"] = [];
  for (let i = 0; i < 4; i++) {
    const p = 32 + i * 8;
    players.push({
      type: b.readUInt16LE(p),
      currentRank: b.readInt16LE(p + 2),
      characterId: b.readUInt16LE(p + 4),
    });
    const h = 64 + i * 8;
    hud.push({ timer: b.readUInt32LE(h), raceComplete: b.readInt8(h + 4) });
  }
  return {
    gameFrame: b.readUInt32LE(0),
    gamestate: b.readInt32LE(4),
    raceState: b.readInt32LE(8),
    menuSelection: b.readInt32LE(12),
    activeScreenMode: b.readInt32LE(16),
    playerCountSelection: b.readInt32LE(20),
    modeSelection: b.readInt32LE(24),
    courseId: b.readInt16LE(28),
    players,
    hud,
  };
}

const ManifestSchema = z.object({
  binary: z.string(),
  engineArchive: z.string(),
  gameArchive: z.string(),
});
export type SpaghettiBuild = z.infer<typeof ManifestSchema>;

export async function loadSpaghettiBuild(): Promise<SpaghettiBuild> {
  const file = Bun.file(MANIFEST_PATH);
  if (!(await file.exists())) {
    throw new Error(
      `SpaghettiKart is not built (${MANIFEST_PATH} missing). Run ` +
        "`bun run --cwd packages/discord-plays-mario-kart build:spaghetti`.",
    );
  }
  return ManifestSchema.parse(await file.json());
}

export type HostOptions = {
  build: SpaghettiBuild;
  /** Per-run writable home (config, saves, logs). Recreated on start. */
  runDir: string;
  lockstep: boolean;
  outputFps: 30 | 60;
  hidden?: boolean;
  /** Extra environment for the child, e.g. SDL_VIDEODRIVER on Linux. */
  env?: Record<string, string>;
  onFrame?: (frame: Frame) => void;
  onAudio?: (chunk: AudioChunk) => void;
  onState?: (state: GameState) => void;
};

export class SpaghettiHost {
  private socketPath = "";
  private socketDir = "";
  private listener: ReturnType<typeof Bun.listen> | undefined;
  private conn: Bun.Socket<unknown> | undefined;
  private child: Bun.Subprocess | undefined;
  private pending: Buffer = Buffer.alloc(0);
  private outbox: Buffer[] = [];
  private inputSeq = 0;
  private helloResolve: ((h: Hello) => void) | undefined;
  private exitError: Error | undefined;
  readonly hello: Promise<Hello>;

  constructor(private readonly opts: HostOptions) {
    this.hello = new Promise((resolve) => {
      this.helloResolve = resolve;
    });
  }

  async start(): Promise<Hello> {
    const { runDir, build } = this.opts;
    await rm(runDir, { recursive: true, force: true });
    await mkdir(runDir, { recursive: true });
    await symlink(build.gameArchive, path.join(runDir, "mk64.o2r"));
    await symlink(build.engineArchive, path.join(runDir, "spaghetti.o2r"));
    // Unix socket paths are capped near 104 bytes; keep it out of deep run dirs.
    this.socketDir = await mkdtemp(path.join(tmpdir(), "sk-"));
    this.socketPath = path.join(this.socketDir, "bridge.sock");

    this.listener = Bun.listen({
      unix: this.socketPath,
      socket: {
        open: (socket) => {
          this.conn = socket;
          this.flush();
        },
        data: (_socket, chunk) => {
          this.receive(chunk);
        },
        drain: () => {
          this.flush();
        },
        close: () => {
          this.conn = undefined;
        },
      },
    });

    const args = [
      build.binary,
      "--host-socket",
      this.socketPath,
      "--output-fps",
      String(this.opts.outputFps),
    ];
    if (this.opts.lockstep) args.push("--lockstep");
    if (this.opts.hidden ?? true) args.push("--hidden");
    this.child = Bun.spawn(args, {
      cwd: runDir,
      env: { ...Bun.env, SHIP_HOME: runDir, ...this.opts.env },
      stdout: Bun.file(path.join(runDir, "stdout.log")),
      stderr: Bun.file(path.join(runDir, "stderr.log")),
    });
    void this.watchExit(this.child);
    return Promise.race([this.hello, connectTimeout()]);
  }

  private async watchExit(child: Bun.Subprocess): Promise<void> {
    const code = await child.exited;
    this.exitError = new Error(
      `SpaghettiKart exited with code ${String(code)}; see ${this.opts.runDir}/stderr.log`,
    );
  }

  get exited(): Error | undefined {
    return this.exitError;
  }

  /** Sends one input for all four ports. Returns its sequence number. */
  sendInput(pads: readonly Pad[]): number {
    const seq = ++this.inputSeq;
    const body = Buffer.alloc(4 + 16);
    body.writeUInt32LE(seq, 0);
    for (let i = 0; i < 4; i++) {
      const pad = pads[i] ?? NEUTRAL_PAD;
      body.writeUInt16LE(pad.button, 4 + i * 4);
      body.writeInt8(clampStick(pad.stickX), 4 + i * 4 + 2);
      body.writeInt8(clampStick(pad.stickY), 4 + i * 4 + 3);
    }
    this.send(MSG.input, body);
    return seq;
  }

  step(frames = 1): void {
    const body = Buffer.alloc(4);
    body.writeUInt32LE(frames, 0);
    this.send(MSG.step, body);
  }

  /** Leaves lockstep; the game then runs at wall-clock speed. */
  runPaced(): void {
    this.send(MSG.runPaced, Buffer.alloc(0));
  }

  reset(): void {
    this.send(MSG.reset, Buffer.alloc(0));
  }

  async stop(): Promise<void> {
    if (this.child?.exitCode === null) {
      this.send(MSG.quit, Buffer.alloc(0));
      const exited = await Promise.race([
        resolvesTrue(this.child.exited),
        resolvesFalseAfter(3000),
      ]);
      if (!exited) this.child.kill("SIGKILL");
    }
    this.listener?.stop(true);
    await rm(this.socketDir, { recursive: true, force: true });
  }

  private send(type: number, body: Buffer): void {
    const prefix = Buffer.alloc(8);
    prefix.writeUInt32LE(type, 0);
    prefix.writeUInt32LE(body.length, 4);
    this.outbox.push(prefix, body);
    this.flush();
  }

  private flush(): void {
    if (!this.conn) return;
    while (this.outbox.length > 0) {
      const head = this.outbox[0];
      if (head === undefined) break;
      const written = this.conn.write(head);
      if (written < head.length) {
        this.outbox[0] = head.subarray(written);
        return;
      }
      this.outbox.shift();
    }
  }

  private receive(chunk: Buffer): void {
    this.pending =
      this.pending.length === 0 ? chunk : Buffer.concat([this.pending, chunk]);
    let offset = 0;
    while (this.pending.length - offset >= 8) {
      const type = this.pending.readUInt32LE(offset);
      const length = this.pending.readUInt32LE(offset + 4);
      if (this.pending.length - offset - 8 < length) break;
      const body = this.pending.subarray(offset + 8, offset + 8 + length);
      this.dispatch(type, body);
      offset += 8 + length;
    }
    this.pending =
      offset === this.pending.length
        ? Buffer.alloc(0)
        : Buffer.from(this.pending.subarray(offset));
  }

  private dispatch(type: number, body: Buffer): void {
    switch (type) {
      case MSG.hello: {
        expectSize("hello", body, HELLO_BYTES);
        this.helloResolve?.({
          protocolVersion: body.readUInt32LE(0),
          audioRate: body.readUInt32LE(4),
          outputFps: body.readUInt32LE(8),
          lockstep: body.readUInt32LE(12) === 1,
        });
        return;
      }
      case MSG.frame: {
        const width = body.readUInt32LE(16);
        const height = body.readUInt32LE(20);
        expectSize("frame", body, FRAME_HEADER_BYTES + width * height * 4);
        this.opts.onFrame?.({
          drawSeq: body.readUInt32LE(0),
          gameFrame: body.readUInt32LE(4),
          latchedInputSeq: body.readUInt32LE(8),
          latchToCaptureUs: body.readUInt32LE(12),
          width,
          height,
          bgra: body.subarray(FRAME_HEADER_BYTES),
          receivedAtMs: performance.now(),
        });
        return;
      }
      case MSG.audio: {
        const sampleFrames = body.readUInt32LE(4);
        expectSize("audio", body, AUDIO_HEADER_BYTES + sampleFrames * 4);
        const pcm = Buffer.from(body.subarray(AUDIO_HEADER_BYTES));
        this.opts.onAudio?.({
          gameFrame: body.readUInt32LE(0),
          samples: new Int16Array(pcm.buffer, pcm.byteOffset, sampleFrames * 2),
        });
        return;
      }
      case MSG.state: {
        expectSize("state", body, STATE_BYTES);
        this.opts.onState?.(parseState(body));
        return;
      }
      default:
        throw new Error(`unknown bridge message type ${String(type)}`);
    }
  }
}

async function connectTimeout(): Promise<never> {
  await Bun.sleep(30_000);
  throw new Error("SpaghettiKart did not connect within 30 s");
}

async function resolvesTrue(promise: Promise<unknown>): Promise<true> {
  await promise;
  return true;
}

async function resolvesFalseAfter(ms: number): Promise<false> {
  await Bun.sleep(ms);
  return false;
}

function expectSize(kind: string, body: Buffer, size: number): void {
  if (body.length !== size) {
    throw new Error(
      `bridge ${kind} message is ${String(body.length)} bytes, expected ${String(size)}`,
    );
  }
}

function clampStick(value: number): number {
  return Math.max(-STICK_RANGE, Math.min(STICK_RANGE, Math.round(value)));
}

/** BGRA (top row first) → RGBA copy, for PNG encoding. */
export function bgraToRgba(bgra: Buffer): Buffer {
  const rgba = Buffer.allocUnsafe(bgra.length);
  for (let i = 0; i < bgra.length; i += 4) {
    rgba[i] = bgra[i + 2] ?? 0;
    rgba[i + 1] = bgra[i + 1] ?? 0;
    rgba[i + 2] = bgra[i] ?? 0;
    rgba[i + 3] = 255;
  }
  return rgba;
}
