import path from "node:path";
import { stat, mkdir } from "node:fs/promises";
import express from "express";
import { createServer } from "node:http";
import { WebSocketServer, WebSocket, type RawData } from "ws";
import { chromium, type BrowserContext } from "playwright-core";
import { encodePacket, type PacketKind } from "@arcade/common/wire.ts";
import { encodeInput } from "@arcade/common/runtime/input.ts";
import {
  neutralController,
  type ControllerState,
} from "@arcade/common/protocol.ts";
import type { RuntimePageConfig } from "@arcade/common/runtime/config.ts";
import { MediaPeer, type RuntimeCallbacks } from "./media-peer.ts";
import { runtimeEnvironment } from "./environment.ts";
import { waitFor } from "./wait.ts";
import type { RuntimeHost } from "./host.ts";
import { verifyAssets } from "./assets.ts";

export class BrowserHost {
  private readonly app = express();
  private readonly server = createServer(this.app);
  private readonly sockets = new Map<string, WebSocket>();
  private readonly endpoints: WebSocketServer[] = [];
  private context: BrowserContext | undefined;
  private stopping = false;
  private stopPromise: Promise<void> | undefined;
  private sequence = 0;
  private readonly saves = new Map<
    number,
    { resolve: () => void; reject: (error: Error) => void }
  >();

  constructor(
    private readonly options: {
      config: RuntimePageConfig;
      assets: string;
      sessionDir: string;
      executable: string;
      port: number;
      startupTimeoutMs: number;
      browserScript: string;
      callbacks: RuntimeCallbacks;
    },
  ) {}

  async start(signal: AbortSignal): Promise<void> {
    signal.throwIfAborted();
    await verifyAssets(
      path.join(this.options.assets, this.options.config.gameId),
      this.options.config.gameId,
      this.options.config.sourceRevision,
    );
    signal.throwIfAborted();
    const peer = new MediaPeer({
      ...this.options.config,
      callbacks: this.options.callbacks,
      saved: (sequence) => {
        this.saves.get(sequence)?.resolve();
      },
    });
    const root = path.join(this.options.assets, this.options.config.gameId);
    this.app.use((_request, response, next) => {
      response.set({
        "Cross-Origin-Opener-Policy": "same-origin",
        "Cross-Origin-Embedder-Policy": "require-corp",
      });
      next();
    });
    this.app.get("/arcade-runtime.js", (_request, response) => {
      response.sendFile(path.resolve(this.options.browserScript));
    });
    if (this.options.config.gameId === "melee") this.meleeRoutes(root);
    else this.app.use(express.static(root, { fallthrough: false }));
    for (const endpoint of ["control", "video"]) this.endpoint(endpoint, peer);
    await new Promise<void>((resolve, reject) => {
      this.server.once("error", reject);
      this.server.listen(this.options.port, "127.0.0.1", () => {
        this.server.off("error", reject);
        resolve();
      });
    });
    signal.throwIfAborted();
    const profile = path.join(this.options.sessionDir, "profile");
    await mkdir(profile, { recursive: true });
    this.context = await chromium.launchPersistentContext(profile, {
      executablePath: this.options.executable,
      headless: true,
      viewport: {
        width: this.options.config.format.width,
        height: this.options.config.format.height,
      },
      env: runtimeEnvironment(),
      args: [
        "--enable-gpu",
        "--enable-unsafe-webgpu",
        "--use-angle=vulkan",
        "--enable-features=Vulkan",
        "--use-vulkan=native",
        "--disable-background-timer-throttling",
        "--disable-renderer-backgrounding",
      ],
    });
    signal.throwIfAborted();
    const context = this.context;
    context.on("close", () => {
      if (!this.stopping)
        this.options.callbacks.fatal(new Error("Headless game browser exited"));
    });
    await context.addInitScript({
      content: `globalThis.arcadeRuntimeConfig=${JSON.stringify(this.options.config)};`,
    });
    const page = await context.newPage();
    page.on("crash", () => {
      this.options.callbacks.fatal(new Error("Game renderer crashed"));
    });
    page.on("pageerror", (error) => {
      if (!this.stopping) this.options.callbacks.fatal(error);
    });
    const origin = `http://127.0.0.1:${String(this.options.port)}`;
    await page.route("**/*", async (route) => {
      const url = new URL(route.request().url());
      if (
        url.origin === origin ||
        url.protocol === "blob:" ||
        url.protocol === "data:"
      )
        await route.continue();
      else await route.abort();
    });
    if (this.options.config.gameId === "mkwii") {
      await page.goto(`${origin}/?res=480`);
      await page.waitForFunction(
        'document.documentElement.dataset.phase === "ready"',
        undefined,
        { timeout: this.options.startupTimeoutMs },
      );
      await page.addScriptTag({
        url: `${origin}/arcade-runtime.js`,
        type: "module",
      });
      await page.click("#btn-start");
    } else await page.goto(`${origin}/melee/engine/index.html`);
    await waitFor(
      peer.ready,
      signal,
      this.options.startupTimeoutMs,
      "Game media startup",
    );
  }

  input(seat: number, state: ControllerState): void {
    this.send("input", encodeInput(seat, state));
  }
  clearInput(seat: number): void {
    if (this.sockets.get("control")?.readyState === WebSocket.OPEN)
      this.send("input", encodeInput(seat, neutralController, true));
  }

  stop(): Promise<void> {
    this.stopPromise ??= this.close();
    return this.stopPromise;
  }

  private async close(): Promise<void> {
    this.stopping = true;
    const failures: unknown[] = [];
    if (this.sockets.get("control")?.readyState === WebSocket.OPEN) {
      try {
        await this.flush();
        this.send("stop", new Uint8Array());
      } catch (error) {
        failures.push(error);
      }
    }
    try {
      await this.context?.close();
    } catch (error) {
      failures.push(error);
    }
    for (const pending of this.saves.values())
      pending.reject(new Error("Runtime stopped during a save flush"));
    this.saves.clear();
    for (const socket of this.sockets.values()) socket.terminate();
    this.sockets.clear();
    for (const endpoint of this.endpoints)
      await new Promise<void>((resolve) => {
        endpoint.close(() => {
          resolve();
        });
      });
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
        "Browser game did not save and close cleanly",
      );
  }

  private async flush(): Promise<void> {
    const sequence = ++this.sequence;
    const saved = Promise.withResolvers<undefined>();
    this.saves.set(sequence, {
      resolve: () => {
        saved.resolve(undefined);
      },
      reject: saved.reject,
    });
    try {
      this.send("flush", new Uint8Array(), sequence);
      await waitFor(
        saved.promise,
        new AbortController().signal,
        15_000,
        "Game save flush",
      );
    } finally {
      this.saves.delete(sequence);
    }
  }

  private send(
    kind: PacketKind,
    payload: Uint8Array,
    sequence = ++this.sequence,
  ): void {
    const socket = this.sockets.get("control");
    if (socket?.readyState !== WebSocket.OPEN)
      throw new Error("Game control bridge is unavailable");
    if (socket.bufferedAmount > 64_000)
      throw new Error("Game controller bridge is backpressured");
    socket.send(
      encodePacket({ kind, sequence, timeMs: performance.now(), payload }),
    );
  }

  private endpoint(name: string, peer: MediaPeer): void {
    const endpoint = new WebSocketServer({
      noServer: true,
      maxPayload:
        name === "video"
          ? this.options.config.format.width *
              this.options.config.format.height *
              4 +
            24
          : 65_560,
    });
    this.endpoints.push(endpoint);
    this.server.on("upgrade", (request, socket, head) => {
      if (request.url !== `/bridge/${name}`) return;
      if (this.sockets.has(name)) {
        socket.destroy();
        return;
      }
      endpoint.handleUpgrade(request, socket, head, (ws) => {
        endpoint.emit("connection", ws);
      });
    });
    endpoint.on("connection", (socket: WebSocket) => {
      this.sockets.set(name, socket);
      socket.on("message", (data: RawData, binary: boolean) => {
        try {
          if (!binary) throw new TypeError("Runtime packet must be binary");
          peer.receive(packetBytes(data));
        } catch (error) {
          this.options.callbacks.fatal(
            error instanceof Error ? error : new Error(String(error)),
          );
        }
      });
      socket.on("error", (error) => {
        if (!this.stopping) this.options.callbacks.fatal(error);
      });
      socket.on("close", () => {
        if (!this.stopping)
          this.options.callbacks.fatal(new Error("Game media bridge closed"));
      });
    });
  }

  private meleeRoutes(root: string): void {
    this.app.get("/melee/engine/index.html", (_request, response) => {
      response
        .type("html")
        .send(
          '<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0;background:black"><canvas id="canvas" width="960" height="720"></canvas><script type="module" src="/arcade-runtime.js"></script><script type="module" src="./runtime.mjs"></script></body></html>',
        );
    });
    this.app.get("/melee/disc.iso", (_request, response) => {
      response.sendFile(path.join(root, "disc.iso"));
    });
    this.app.use(
      "/melee/engine",
      express.static(path.join(root, "engine"), { fallthrough: false }),
    );
  }
}

function packetBytes(data: RawData): Uint8Array {
  if (Array.isArray(data)) return Buffer.concat(data);
  return data instanceof ArrayBuffer ? new Uint8Array(data) : data;
}

export async function meleeDiscSize(assets: string): Promise<number> {
  const file = await stat(path.join(assets, "melee/disc.iso"));
  return file.size;
}

export function browserRuntimeHost(
  options: ConstructorParameters<typeof BrowserHost>[0],
): RuntimeHost {
  let host: BrowserHost | undefined;
  return {
    async start(signal) {
      signal.throwIfAborted();
      const discSize =
        options.config.gameId === "melee"
          ? await meleeDiscSize(options.assets)
          : null;
      signal.throwIfAborted();
      host = new BrowserHost({
        ...options,
        config: { ...options.config, discSize },
      });
      await host.start(signal);
    },
    stop: () => host?.stop() ?? Promise.resolve(),
    input: (seat, state) => {
      if (host === undefined) throw new Error("Browser runtime is not started");
      host.input(seat, state);
    },
    clearInput: (seat) => {
      host?.clearInput(seat);
    },
  };
}
