// Driver-feed service: owns the /video WebSocket route for the process lifetime
// and the ffmpeg encoder for the lifetime of one game session.
//
// Split that way because the two have genuinely different lifetimes. Clients may
// sit connected across `/play` and `/stop` (the controller page is long-lived),
// while the encoder only exists while there are frames to encode.

// This must share the existing Node HTTP server with Socket.IO; Bun.serve cannot
// mount on that server or preserve Engine.IO's upgrade behaviour. `ws` provides
// the noServer upgrade path that lets both protocols safely coexist.
import type { Server as HttpServer, IncomingMessage } from "node:http";
import { WebSocketServer, WebSocket, type RawData } from "ws";
import {
  DRIVER_FEED_PATH,
  type DriverFeedInit,
  DriverFeedReadySchema,
} from "@discord-plays-mario-kart/common";
import type { Config } from "#src/config/schema.ts";
import { logger } from "#src/logger.ts";
import {
  driverFeedClientBufferBytes,
  driverFeedClients,
  driverFeedEncoderRunning,
} from "#src/observability/metrics.ts";
import {
  DriverFeedEncoder,
  H264_CODEC_STRING,
  driverFeedOutputSize,
} from "./encoder.ts";
import { DriverFeedHub, type FeedClient } from "./hub.ts";

type DriverFeedConfig = Config["driver_feed"];
type StreamVideoConfig = Config["stream"]["video"];

export type DriverFeedServiceOptions = {
  readonly config: DriverFeedConfig;
  /** Encoder settings shared with the Go-Live path: same GPU, same latency knob. */
  readonly video: Pick<
    StreamVideoConfig,
    "hardware_acceleration" | "vaapi_device" | "encoder_async_depth"
  >;
  readonly frameRate: number;
};

export class DriverFeedService {
  private readonly options: DriverFeedServiceOptions;
  private readonly hub: DriverFeedHub;
  private readonly activeClients = new Map<FeedClient, string>();
  private encoder: DriverFeedEncoder | undefined;
  private isActiveDriver: (socketId: string) => boolean = () => false;

  constructor(options: DriverFeedServiceOptions) {
    this.options = options;
    this.hub = new DriverFeedHub({
      maxClients: options.config.max_clients,
      maxClientBufferBytes: options.config.max_client_buffer_bytes,
    });
  }

  /**
   * The controller's Socket.IO seat is the authority for the capped feed. This
   * is wired after the game driver exists because its SeatManager is per-session.
   */
  setDriverAdmission(isActiveDriver: (socketId: string) => boolean): void {
    this.isActiveDriver = isActiveDriver;
  }

  /**
   * Mount the WebSocket route on the existing HTTP server.
   *
   * `noServer: true` plus a path-guarded listener is load-bearing: in attached
   * mode (`new WebSocketServer({ server })`) the library destroys sockets whose
   * path does not match, which would kill Socket.IO's own upgrades.
   *
   * Engine.io is not quite as polite in the other direction. For an upgrade
   * outside `/socket.io/` it schedules a destroy 1 s later, and only spares the
   * socket if something has written to it by then (`socket.bytesWritten <= 0`
   * in engine.io's `server.js`). `handleUpgrade` writes the 101 response
   * synchronously while the same `upgrade` event is still dispatching, so the
   * feed is always past that check long before the timer fires — but anything
   * added here that defers the handshake would be silently killed after a
   * second. `attach.test.ts` pins this behaviour.
   */
  attach(server: HttpServer): void {
    const wss = new WebSocketServer({ noServer: true });
    server.on("upgrade", (request, socket, head) => {
      if (requestPath(request) !== DRIVER_FEED_PATH) return;
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit("connection", ws, request);
      });
    });
    wss.on("connection", (ws: WebSocket, request: IncomingMessage) => {
      this.onConnection(ws, request);
    });
    logger.info("driver feed websocket attached", { path: DRIVER_FEED_PATH });
  }

  /**
   * Start encoding for a new session.
   *
   * Restarts rather than throws when an encoder is already up: the caller is the
   * streamer's `onEncoderStarted` hook, and a stream that self-heals fires it
   * again. Re-encoding from the new stream is the correct response, and the
   * clients resync at the first keyframe of the new process.
   */
  startSession(): void {
    if (this.encoder !== undefined) {
      logger.info("driver feed restarting encoder for a new stream session");
      this.encoder.stop();
      this.encoder = undefined;
      this.hub.resetAllToKeyframe();
    }
    const encoder = new DriverFeedEncoder(
      {
        outputHeight: this.options.config.height,
        frameRate: this.options.frameRate,
        bitrateKbps: this.options.config.bitrate_kbps,
        bitrateMaxKbps: this.options.config.bitrate_max_kbps,
        keyframeIntervalFrames: this.options.config.keyframe_interval_frames,
        hardwareAcceleration: this.options.video.hardware_acceleration,
        vaapiDevice: this.options.video.vaapi_device,
        encoderAsyncDepth: this.options.video.encoder_async_depth,
      },
      {
        onAccessUnit: (unit) => {
          this.removeInactiveClients();
          this.hub.broadcast(unit);
        },
      },
    );
    this.encoder = encoder;
    encoder.start();
  }

  /** Feed one overlay-composited BGRA frame from the emulator tee. */
  pushFrame(frame: Buffer): void {
    this.encoder?.pushFrame(frame);
  }

  /**
   * Stop encoding and reset the clients to "awaiting keyframe" by disconnecting
   * them, so a stale half-GOP never lingers on a canvas after `/stop`.
   */
  stopSession(): void {
    this.encoder?.stop();
    this.encoder = undefined;
    this.hub.closeAll("session ended");
    this.activeClients.clear();
    resetDriverFeedGauges();
  }

  private onConnection(ws: WebSocket, request: IncomingMessage): void {
    this.removeInactiveClients();
    if (!requestHasSameOrigin(request)) {
      logger.warn("driver feed rejected a cross-origin client");
      ws.close(1008, "same-origin access is required");
      return;
    }
    const socketId = requestUrl(request)?.searchParams.get("driverSocketId");
    if (socketId === null || socketId === undefined) {
      logger.warn("driver feed rejected a client without an active seat");
      ws.close(1008, "an active driver seat is required");
      return;
    }
    if (!this.isActiveDriver(socketId)) {
      logger.warn("driver feed rejected a client without an active seat");
      ws.close(1008, "an active driver seat is required");
      return;
    }
    const out = driverFeedOutputSize(this.options.config.height);
    const init: DriverFeedInit = {
      kind: "init",
      codec: H264_CODEC_STRING,
      width: out.width,
      height: out.height,
      frameRate: this.options.frameRate,
    };
    ws.send(JSON.stringify(init));

    const client: FeedClient = {
      get bufferedBytes() {
        return ws.bufferedAmount;
      },
      send: (payload) => {
        if (ws.readyState !== WebSocket.OPEN) return;
        ws.send(payload, { binary: true });
      },
      close: (reason) => {
        // Close reasons are capped at 123 bytes by the protocol.
        ws.close(1000, reason.slice(0, 123));
      },
    };

    ws.on("close", () => {
      this.removeClient(client);
    });
    ws.on("error", (error) => {
      logger.warn("driver feed client socket error", error);
      this.removeClient(client);
    });
    ws.once("message", (data, isBinary) => {
      if (isBinary) {
        ws.close(1008, "expected driver feed readiness acknowledgement");
        return;
      }
      const text = rawDataText(data);
      if (text === undefined) {
        ws.close(1008, "malformed driver feed readiness acknowledgement");
        return;
      }
      let message: unknown;
      try {
        message = JSON.parse(text);
      } catch {
        ws.close(1008, "malformed driver feed readiness acknowledgement");
        return;
      }
      if (!DriverFeedReadySchema.safeParse(message).success) {
        ws.close(1008, "unrecognised driver feed readiness acknowledgement");
        return;
      }
      if (!this.isActiveDriver(socketId)) {
        ws.close(1008, "driver seat released");
        return;
      }
      if (!this.hub.add(client)) {
        logger.warn("driver feed rejected a client at capacity", {
          maxClients: this.options.config.max_clients,
        });
        ws.close(1013, "driver feed is full");
        return;
      }
      this.activeClients.set(client, socketId);
    });
  }

  private removeClient(client: FeedClient): void {
    this.activeClients.delete(client);
    this.hub.remove(client);
  }

  private removeInactiveClients(): void {
    for (const [client, socketId] of this.activeClients) {
      if (this.isActiveDriver(socketId)) continue;
      client.close("driver seat released");
      this.removeClient(client);
    }
  }
}

/** Zero the feed's gauges so Grafana does not show a phantom feed after `/stop`. */
export function resetDriverFeedGauges(): void {
  driverFeedEncoderRunning.set(0);
  driverFeedClients.set(0);
  driverFeedClientBufferBytes.set(0);
}

function requestUrl(request: IncomingMessage): URL | undefined {
  const url = request.url;
  if (url === undefined) return undefined;
  // A relative request-target needs a base; this only serves its path and query.
  return URL.parse(url, "http://localhost") ?? undefined;
}

function requestPath(request: IncomingMessage): string | undefined {
  return requestUrl(request)?.pathname;
}

function rawDataText(data: RawData): string | undefined {
  if (Buffer.isBuffer(data)) return data.toString("utf8");
  if (data instanceof ArrayBuffer) {
    return Buffer.from(data).toString("utf8");
  }
  if (Array.isArray(data)) return Buffer.concat(data).toString("utf8");
  return undefined;
}

/** Browser clients must originate from the host serving the controller page. */
function requestHasSameOrigin(request: IncomingMessage): boolean {
  const origin = request.headers.origin;
  if (origin === undefined) return true;
  const host = request.headers.host;
  if (host === undefined) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}
