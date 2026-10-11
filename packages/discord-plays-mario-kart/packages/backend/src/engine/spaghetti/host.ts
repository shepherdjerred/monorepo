// One SpaghettiKart game process and its bridge socket.
//
// The host listens on a Unix socket, spawns the game with `--host-socket`, and
// exchanges the bridge's messages (protocol.ts): input/step/reset/quit/run-paced
// out; hello/frame/audio/state in. The game's home (SHIP_HOME) is `homeDir`:
// its config, logs, and EEPROM save (default.sav) live there, and the two
// asset archives are linked in on every start.
import { mkdir, mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { SpaghettiBuild } from "./install.ts";
import {
  BridgeReader,
  MSG,
  encodeInput,
  encodeSignal,
  encodeStep,
  parseAudio,
  parseFrame,
  parseHello,
  parseState,
  type AudioMessage,
  type FrameMessage,
  type Hello,
  type Pad,
  type StateMessage,
} from "./protocol.ts";

/** Boot can include shader compilation on a software rasterizer. */
const HELLO_TIMEOUT_MS = 60_000;
const QUIT_TIMEOUT_MS = 3000;
const STDERR_TAIL_BYTES = 4000;

export type SpaghettiHostOptions = {
  readonly build: SpaghettiBuild;
  /** SHIP_HOME: persistent per-guild state (config, logs, default.sav). */
  readonly homeDir: string;
  /** Start blocked, advancing only on step() until runPaced(). */
  readonly lockstep: boolean;
  readonly outputFps: 30 | 60;
  /** Extra environment for the game, e.g. SDL_VIDEODRIVER. */
  readonly env?: Readonly<Record<string, string>>;
  readonly onFrame?: (frame: FrameMessage) => void;
  readonly onAudio?: (audio: AudioMessage) => void;
  readonly onState?: (state: StateMessage) => void;
  /** The game exited without being asked to. */
  readonly onUnexpectedExit?: (error: Error) => void;
};

async function replaceLink(target: string, link: string): Promise<void> {
  await rm(link, { force: true });
  await symlink(target, link);
}

async function tail(file: string): Promise<string> {
  const handle = Bun.file(file);
  if (!(await handle.exists())) return "";
  const size = handle.size;
  const text = await handle
    .slice(Math.max(0, size - STDERR_TAIL_BYTES), size)
    .text();
  return text.trim();
}

async function rejectAfter(ms: number, message: string): Promise<never> {
  await Bun.sleep(ms);
  throw new Error(message);
}

async function resolvesTrue(promise: Promise<unknown>): Promise<true> {
  await promise;
  return true;
}

async function resolvesFalseAfter(ms: number): Promise<false> {
  await Bun.sleep(ms);
  return false;
}

export class SpaghettiHost {
  private readonly opts: SpaghettiHostOptions;
  private readonly reader = new BridgeReader();
  private socketDir: string | undefined;
  private listener: ReturnType<typeof Bun.listen> | undefined;
  private conn: Bun.Socket<unknown> | undefined;
  private child: Bun.Subprocess | undefined;
  private outbox: Buffer[] = [];
  private inputSeq = 0;
  private stopping = false;
  private helloResolve: ((hello: Hello) => void) | undefined;
  private helloReject: ((error: Error) => void) | undefined;
  private exitError: Error | undefined;

  constructor(opts: SpaghettiHostOptions) {
    this.opts = opts;
  }

  /** The exit error once the game has died unexpectedly. */
  get exited(): Error | undefined {
    return this.exitError;
  }

  get stderrLog(): string {
    return path.join(this.opts.homeDir, "stderr.log");
  }

  /** Spawn the game and wait for its HELLO. */
  async start(): Promise<Hello> {
    if (this.child !== undefined) {
      throw new Error("SpaghettiHost.start called twice");
    }
    const { build, homeDir } = this.opts;
    await mkdir(homeDir, { recursive: true });
    await replaceLink(build.gameArchive, path.join(homeDir, "mk64.o2r"));
    await replaceLink(build.engineArchive, path.join(homeDir, "spaghetti.o2r"));
    // Unix socket paths are capped near 104 bytes, so keep the socket out of
    // the (deep) home directory.
    this.socketDir = await mkdtemp(path.join(tmpdir(), "sk-"));
    const socketPath = path.join(this.socketDir, "bridge.sock");

    const hello = new Promise<Hello>((resolve, reject) => {
      this.helloResolve = resolve;
      this.helloReject = reject;
    });
    this.listener = Bun.listen({
      unix: socketPath,
      socket: {
        open: (socket) => {
          if (this.conn !== undefined) {
            socket.end();
            return;
          }
          this.conn = socket;
          this.flush();
        },
        data: (_socket, chunk) => {
          try {
            this.receive(chunk);
          } catch (error) {
            this.fail(
              error instanceof Error ? error : new Error(String(error)),
            );
          }
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
      socketPath,
      "--output-fps",
      String(this.opts.outputFps),
      "--hidden",
    ];
    if (this.opts.lockstep) args.push("--lockstep");
    const child = Bun.spawn(args, {
      cwd: homeDir,
      env: { ...Bun.env, ...this.opts.env, SHIP_HOME: homeDir },
      stdin: "ignore",
      stdout: Bun.file(path.join(homeDir, "stdout.log")),
      stderr: Bun.file(this.stderrLog),
    });
    this.child = child;
    void this.watchExit(child);
    return Promise.race([
      hello,
      rejectAfter(
        HELLO_TIMEOUT_MS,
        `SpaghettiKart did not connect within ${String(HELLO_TIMEOUT_MS / 1000)} s; see ${this.stderrLog}`,
      ),
    ]);
  }

  private async watchExit(child: Bun.Subprocess): Promise<void> {
    const code = await child.exited;
    if (this.stopping) return;
    const stderr = await tail(this.stderrLog);
    const error = new Error(
      `SpaghettiKart exited with code ${String(code)}` +
        (stderr.length > 0 ? `: ${stderr}` : ""),
    );
    this.exitError = error;
    this.helloReject?.(error);
    this.opts.onUnexpectedExit?.(error);
  }

  /**
   * A broken bridge contract (an unparseable message) ends the game: the
   * stream has no resync point, so continuing would only misread every frame.
   */
  private fail(error: Error): void {
    if (this.stopping || this.exitError !== undefined) return;
    this.exitError = error;
    this.stopping = true;
    this.child?.kill("SIGKILL");
    this.helloReject?.(error);
    this.opts.onUnexpectedExit?.(error);
  }

  /** Send one input for all four ports. Returns its sequence number. */
  sendInput(pads: readonly Pad[]): number {
    this.inputSeq += 1;
    this.send(encodeInput(this.inputSeq, pads));
    return this.inputSeq;
  }

  step(frames = 1): void {
    this.send(encodeStep(frames));
  }

  /** Leave lockstep; the game then runs at wall-clock speed. */
  runPaced(): void {
    this.send(encodeSignal(MSG.runPaced));
  }

  /** The game's own soft reset, back to the title screen. */
  reset(): void {
    this.send(encodeSignal(MSG.reset));
  }

  /** Ask the game to quit, kill it if it does not, and close the socket. */
  async stop(): Promise<void> {
    this.stopping = true;
    const child = this.child;
    if (child?.exitCode === null) {
      this.send(encodeSignal(MSG.quit));
      const exited = await Promise.race([
        resolvesTrue(child.exited),
        resolvesFalseAfter(QUIT_TIMEOUT_MS),
      ]);
      if (!exited) {
        child.kill("SIGKILL");
        await child.exited;
      }
    }
    this.listener?.stop(true);
    this.listener = undefined;
    if (this.socketDir !== undefined) {
      await rm(this.socketDir, { recursive: true, force: true });
      this.socketDir = undefined;
    }
  }

  private send(message: Buffer): void {
    this.outbox.push(message);
    this.flush();
  }

  private flush(): void {
    const conn = this.conn;
    if (conn === undefined) return;
    while (this.outbox.length > 0) {
      const head = this.outbox[0];
      if (head === undefined) break;
      const written = conn.write(head);
      if (written < head.length) {
        this.outbox[0] = head.subarray(Math.max(0, written));
        return;
      }
      this.outbox.shift();
    }
  }

  private receive(chunk: Buffer): void {
    for (const { type, body } of this.reader.push(chunk)) {
      switch (type) {
        case MSG.hello:
          this.helloResolve?.(parseHello(body));
          break;
        case MSG.frame:
          this.opts.onFrame?.(parseFrame(body));
          break;
        case MSG.audio:
          this.opts.onAudio?.(parseAudio(body));
          break;
        case MSG.state:
          this.opts.onState?.(parseState(body));
          break;
        default:
          throw new Error(`unknown bridge message type ${String(type)}`);
      }
    }
  }
}
