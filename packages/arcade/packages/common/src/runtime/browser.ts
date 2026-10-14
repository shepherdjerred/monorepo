import { RuntimePageSchema, type RuntimePageConfig } from "./config.ts";
import { AudioResampler } from "./audio.ts";
import { BrowserPads } from "./pads.ts";
import { decodeInput } from "./input.ts";
import {
  decodePacket,
  encodePacket,
  type PacketKind,
} from "@arcade/common/wire.ts";
import {
  gameModule,
  readProbe,
  remoteDisc,
  upstreamCommand,
  UpstreamMessageSchema,
} from "./native-module.ts";

class BrowserRuntime {
  private readonly pads = new BrowserPads();
  private readonly audio = new AudioResampler();
  private readonly control = new WebSocket(
    `ws://${location.host}/bridge/control`,
  );
  private readonly video = new WebSocket(`ws://${location.host}/bridge/video`);
  private sequence = 0;
  private pending = false;
  private lastVideoTime = -Infinity;
  private videoStarted = false;
  private failed = false;
  private readonly canvas: HTMLCanvasElement;
  private readonly surface: OffscreenCanvas;
  private readonly context: OffscreenCanvasRenderingContext2D;

  constructor(private readonly config: RuntimePageConfig) {
    const canvas = document.querySelector("#canvas");
    if (!(canvas instanceof HTMLCanvasElement))
      throw new TypeError("Runtime canvas is missing");
    this.canvas = canvas;
    this.surface = new OffscreenCanvas(
      config.format.width,
      config.format.height,
    );
    const context = this.surface.getContext("2d", { willReadFrequently: true });
    if (context === null)
      throw new Error("Runtime readback context is unavailable");
    this.context = context;
  }

  async connect(): Promise<void> {
    this.control.binaryType = "arraybuffer";
    this.control.addEventListener("message", (event) => {
      void this.command(event.data);
    });
    for (const socket of [this.control, this.video])
      socket.addEventListener("close", () => {
        this.fail(new Error("Runtime bridge disconnected"));
      });
    await Promise.all([socketReady(this.control), socketReady(this.video)]);
    this.send(
      "hello",
      new TextEncoder().encode(
        JSON.stringify({
          version: 1,
          gameId: this.config.gameId,
          sourceRevision: this.config.sourceRevision,
          format: this.config.format,
        }),
      ),
    );
  }

  installMkw(): void {
    const module = gameModule();
    module.onArcadeFrame = (frame) => {
      this.frame(frame);
    };
    module.onArcadeAudio = (pointer, bytes, rate) => {
      try {
        if (
          pointer % 2 !== 0 ||
          bytes % 4 !== 0 ||
          bytes > 48_000 ||
          pointer < 0 ||
          pointer + bytes > module.HEAPU8.length
        )
          throw new Error("Invalid native PCM buffer");
        this.pcm(
          module.HEAP16.subarray(pointer / 2, (pointer + bytes) / 2),
          rate,
          1 / 32_768,
        );
      } catch (error) {
        this.fail(error);
      }
    };
    this.pads.apply("mkwii", 0);
  }

  installMelee(): void {
    const module = gameModule();
    const frame = module.onFrame;
    const audio = module.onAudio;
    if (frame === undefined || audio === undefined)
      throw new Error("Melee assets are missing media callbacks");
    module.onFrame = (value) => {
      frame(value);
      this.frame(value);
    };
    module.onAudio = (samples, rate) => {
      audio(samples, rate);
      this.pcm(samples, rate);
    };
    upstreamCommand({ type: "surface", direct: true });
    this.pads.apply("melee", 0);
  }

  fail(error: unknown): void {
    if (this.failed) return;
    this.failed = true;
    const message = error instanceof Error ? error.message : String(error);
    if (this.control.readyState === WebSocket.OPEN)
      this.send("error", new TextEncoder().encode(message.slice(0, 2000)));
    console.error("Arcade runtime failed", message);
  }

  private frame(frame: number): void {
    if (this.failed) return;
    try {
      this.pads.apply(this.config.gameId, frame);
      this.send(
        "telemetry",
        new TextEncoder().encode(
          JSON.stringify(readProbe(this.config.gameId, frame)),
        ),
      );
      const now = performance.now();
      if (
        this.pending ||
        now - this.lastVideoTime < 1000 / this.config.format.fps - 1
      )
        return;
      this.pending = true;
      this.lastVideoTime = now;
      void this.capture();
    } catch (error) {
      this.fail(error);
    }
  }

  private async capture(): Promise<void> {
    try {
      if (
        this.canvas.width !== this.config.format.width ||
        this.canvas.height !== this.config.format.height
      )
        throw new Error("Game changed its configured framebuffer size");
      const bitmap = await createImageBitmap(this.canvas);
      try {
        this.context.drawImage(bitmap, 0, 0);
      } finally {
        bitmap.close();
      }
      const pixels = this.context.getImageData(
        0,
        0,
        this.config.format.width,
        this.config.format.height,
      ).data;
      if (this.video.bufferedAmount > pixels.byteLength * 2) return;
      this.send(
        "video",
        new Uint8Array(pixels.buffer, pixels.byteOffset, pixels.byteLength),
      );
      this.videoStarted = true;
    } catch (error) {
      this.fail(error);
    } finally {
      this.pending = false;
    }
  }

  private pcm(samples: ArrayLike<number>, rate: number, scale = 1): void {
    if (this.failed || !this.videoStarted) return;
    try {
      if (samples.length > 24_000)
        throw new Error("Game emitted an oversized audio block");
      this.send("audio", this.audio.convert(samples, rate, scale));
    } catch (error) {
      this.fail(error);
    }
  }

  private send(
    kind: PacketKind,
    payload: Uint8Array,
    sequence = ++this.sequence,
  ): void {
    const socket = kind === "video" ? this.video : this.control;
    if (socket.readyState !== WebSocket.OPEN)
      throw new Error("Runtime bridge is not connected");
    if (
      kind !== "error" &&
      socket === this.control &&
      socket.bufferedAmount > 64_000
    )
      throw new Error("Runtime audio or telemetry is backpressured");
    socket.send(
      encodePacket({ kind, sequence, timeMs: performance.now(), payload }),
    );
  }

  private async command(message: unknown): Promise<void> {
    try {
      if (!(message instanceof ArrayBuffer))
        throw new TypeError("Invalid runtime command");
      const packet = decodePacket(new Uint8Array(message));
      switch (packet.kind) {
        case "hello":
        case "video":
        case "audio":
        case "telemetry":
        case "error":
        case "saved":
          throw new Error("Unsupported runtime command");
        case "input":
          this.pads.set(decodeInput(packet.payload));
          return;
        case "flush": {
          await new Promise<void>((resolve, reject) => {
            gameModule().FS.syncfs(false, (error) => {
              if (error === null || error === undefined) resolve();
              else reject(error);
            });
          });
          this.send("saved", new Uint8Array(), packet.sequence);
          return;
        }
        case "stop":
          this.failed = true;
          return;
        default:
          throw new Error("Unsupported runtime command");
      }
    } catch (error) {
      this.fail(error);
    }
  }
}

async function socketReady(socket: WebSocket): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    socket.addEventListener(
      "open",
      () => {
        resolve();
      },
      { once: true },
    );
    socket.addEventListener(
      "error",
      () => {
        reject(new Error("Runtime bridge could not connect"));
      },
      { once: true },
    );
  });
}

const config = RuntimePageSchema.parse(
  Reflect.get(globalThis, "arcadeRuntimeConfig"),
);
const runtime = new BrowserRuntime(config);
let meleeReady = false;
let connected = false;
let started = false;
function startMelee(): void {
  if (started || !connected || !meleeReady) return;
  started = true;
  if (config.discSize === null)
    throw new Error("Melee disc metadata is missing");
  upstreamCommand({
    type: "start",
    iso: remoteDisc(config.discSize),
    discVerified: true,
    warm: true,
  });
}
window.addEventListener("message", (event) => {
  if (event.source !== globalThis.window || event.origin !== location.origin)
    return;
  const message: unknown = event.data;
  const parsed = UpstreamMessageSchema.safeParse(message);
  if (!parsed.success) return;
  try {
    switch (parsed.data.type) {
      case "bridge-ready":
        meleeReady = true;
        startMelee();
        return;
      case "ready-for-selection": {
        runtime.installMelee();
        upstreamCommand({
          type: "select",
          launch: {
            mode: 1,
            stage: 32,
            level: 1,
            stocks: 4,
            minutes: 8,
            packedPorts: [8, 6, 2, 1],
          },
          renderWidth: config.format.width,
        });
        return;
      }
      case "error":
        runtime.fail(new Error(parsed.data.message ?? "Game runtime failed"));
        return;
      default:
        return;
    }
  } catch (error) {
    runtime.fail(error);
  }
});
await runtime.connect();
connected = true;
if (config.gameId === "mkwii") runtime.installMkw();
else startMelee();
