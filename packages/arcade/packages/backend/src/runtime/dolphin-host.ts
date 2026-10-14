import path from "node:path";
import { mkdir, lstat, open, constants } from "node:fs/promises";
import { createServer, type Socket } from "node:net";
import type { ControllerState } from "@arcade/common/protocol.ts";
import type { Logger } from "@shepherdjerred/discord-plays-core/logger.ts";
import { encodePacket } from "@arcade/common/wire.ts";
import type { RuntimeMediaFormat } from "@arcade/common/runtime/config.ts";
import { runtimeEnvironment } from "./environment.ts";
import { MediaPeer, type RuntimeCallbacks } from "./media-peer.ts";
import { PacketFramer } from "./framer.ts";
import { DolphinPads, dolphinControllers } from "./dolphin-input.ts";
import { waitFor } from "./wait.ts";
import { PipeWriter } from "./pipe-writer.ts";
import { verifyAssets } from "./assets.ts";

export class DolphinHost {
  private readonly server = createServer();
  private socket: Socket | undefined;
  private child: ReturnType<typeof Bun.spawn> | undefined;
  private readonly pipes: PipeWriter[] = [];
  private stopping = false;
  private stopPromise: Promise<void> | undefined;
  private readonly pads = new DolphinPads((seat, message) => {
    this.write(seat, message);
  });

  constructor(
    private readonly options: {
      assets: string;
      sessionDir: string;
      executable: string;
      startupTimeoutMs: number;
      format: RuntimeMediaFormat;
      callbacks: RuntimeCallbacks;
      logger: Logger;
    },
  ) {}

  async start(signal: AbortSignal): Promise<void> {
    signal.throwIfAborted();
    await verifyAssets(
      path.join(this.options.assets, "brawl"),
      "brawl",
      "2614969fa80dfeb87d2a4ad3bdaa703237127074",
    );
    signal.throwIfAborted();
    const root = path.join(this.options.sessionDir, "emulator");
    await this.configure(root);
    signal.throwIfAborted();
    const peer = new MediaPeer({
      gameId: "brawl",
      sourceRevision: "2614969fa80dfeb87d2a4ad3bdaa703237127074",
      format: this.options.format,
      saved: () => {
        /* Dolphin flushes NAND on its orderly exit. */
      },
      callbacks: {
        ...this.options.callbacks,
        telemetry: (data) => {
          this.pads.tick();
          this.options.callbacks.telemetry(data);
        },
      },
    });
    this.server.on("connection", (socket) => {
      if (this.socket !== undefined) {
        socket.destroy();
        return;
      }
      this.socket = socket;
      const framer = new PacketFramer((packet) => {
        peer.receive(packet);
      });
      socket.on("data", (chunk) => {
        try {
          if (typeof chunk === "string")
            throw new TypeError("Dolphin bridge changed its binary encoding");
          framer.push(chunk);
        } catch (error) {
          this.fail(error);
        }
      });
      socket.on("end", () => {
        if (!this.stopping)
          this.fail(new Error("Dolphin media bridge ended unexpectedly"));
      });
      socket.on("error", (error) => {
        this.fail(error);
      });
    });
    await new Promise<void>((resolve, reject) => {
      this.server.once("error", reject);
      this.server.listen(0, "127.0.0.1", () => {
        this.server.off("error", reject);
        resolve();
      });
    });
    signal.throwIfAborted();
    const address = this.server.address();
    if (address === null || typeof address === "string")
      throw new Error("Dolphin bridge did not bind a loopback port");
    const child = Bun.spawn(
      [
        this.options.executable,
        "--platform",
        "headless",
        "-u",
        root,
        "-e",
        path.join(this.options.assets, "brawl/disc.wbfs"),
      ],
      {
        cwd: root,
        env: {
          ...runtimeEnvironment(),
          ARCADE_BRIDGE_PORT: String(address.port),
          EGL_PLATFORM: "surfaceless",
        },
        stdin: "ignore",
        stdout: "ignore",
        stderr: "pipe",
      },
    );
    this.child = child;
    void this.logs(child.stderr);
    void (async () => {
      const code = await child.exited;
      if (!this.stopping)
        this.fail(new Error(`Dolphin exited unexpectedly (${String(code)})`));
    })();
    await waitFor(
      peer.ready,
      signal,
      this.options.startupTimeoutMs,
      "Dolphin media startup",
    );
  }

  input(seat: number, state: ControllerState): void {
    this.pads.set(seat, state);
  }
  clearInput(seat: number): void {
    if (this.pipes[seat] !== undefined) this.pads.clear(seat);
  }
  stop(): Promise<void> {
    this.stopPromise ??= this.close();
    return this.stopPromise;
  }

  private async close(): Promise<void> {
    this.stopping = true;
    const failures: unknown[] = [];
    const child = this.child;
    if (child?.exitCode === null) {
      try {
        if (this.socket !== undefined && !this.socket.destroyed)
          this.socket.write(
            encodePacket({
              kind: "stop",
              sequence: 1,
              timeMs: performance.now(),
              payload: new Uint8Array(),
            }),
          );
        else child.kill("SIGTERM");
        const code = await waitFor(
          child.exited,
          new AbortController().signal,
          20_000,
          "Dolphin save and shutdown",
        );
        if (code !== 0)
          throw new Error(`Dolphin did not exit cleanly (${String(code)})`);
      } catch (error) {
        failures.push(error);
        child.kill("SIGKILL");
        await child.exited;
      }
    }
    for (const pipe of this.pipes.splice(0)) {
      try {
        await pipe.close();
      } catch (error) {
        failures.push(error);
      }
    }
    this.socket?.destroy();
    if (this.server.listening)
      await new Promise<void>((resolve, reject) => {
        this.server.close((error) => {
          if (error === undefined) resolve();
          else reject(error);
        });
      });
    if (failures.length > 0)
      throw new AggregateError(
        failures,
        "Dolphin could not save and stop cleanly",
      );
  }

  private async configure(root: string): Promise<void> {
    await mkdir(path.join(root, "Config"), { recursive: true });
    await mkdir(path.join(root, "Pipes"), { recursive: true });
    const core =
      "[Core]\nCPUCore = 1\nCPUThread = True\nEnableCheats = False\nGFXBackend = OGL\nSIDevice0 = 6\nSIDevice1 = 6\nSIDevice2 = 6\nSIDevice3 = 6\n[Audio]\nBackend = Null\n[Display]\nRenderWindowWidth = 640\nRenderWindowHeight = 480\n[Movie]\nDumpFrames = False\nDumpAudio = False\n";
    const graphics =
      "[Settings]\nEFBScale = 1\nAspectRatio = 2\n[Enhancements]\nMSAA = 1\n[Hacks]\nEFBToTextureEnable = True\n";
    await Bun.write(path.join(root, "Config/Dolphin.ini"), core);
    await Bun.write(path.join(root, "Config/GFX.ini"), graphics);
    await Bun.write(
      path.join(root, "Config/GCPadNew.ini"),
      dolphinControllers(),
    );
    for (let seat = 0; seat < 4; seat++) {
      const file = path.join(root, "Pipes", `arcade-seat${String(seat)}`);
      const existing = await lstat(file).catch((error: unknown) => {
        if (
          error instanceof Error &&
          "code" in error &&
          error.code === "ENOENT"
        )
          return;
        throw error;
      });
      if (existing === undefined) {
        const process = Bun.spawn(["mkfifo", "-m", "600", file], {
          stdout: "ignore",
          stderr: "pipe",
        });
        if ((await process.exited) !== 0)
          throw new Error("Could not create a Dolphin controller pipe");
      } else if (!existing.isFIFO())
        throw new Error("Dolphin controller path is not a FIFO");
      const handle = await open(file, constants.O_RDWR | constants.O_NONBLOCK);
      this.pipes.push(
        new PipeWriter(handle, (error) => {
          this.fail(error);
        }),
      );
    }
  }

  private write(seat: number, message: string): void {
    const pipe = this.pipes[seat];
    if (pipe === undefined)
      throw new Error("Dolphin controller pipe is unavailable");
    pipe.write(message);
  }
  private fail(error: unknown): void {
    if (!this.stopping)
      this.options.callbacks.fatal(
        error instanceof Error ? error : new Error(String(error)),
      );
  }
  private async logs(stream: ReadableStream<Uint8Array>): Promise<void> {
    try {
      for await (const bytes of stream) {
        const text = new TextDecoder().decode(bytes);
        this.options.logger.debug("Dolphin runtime", {
          message: text.slice(0, 2000),
        });
      }
    } catch (error) {
      this.fail(error);
    }
  }
}
