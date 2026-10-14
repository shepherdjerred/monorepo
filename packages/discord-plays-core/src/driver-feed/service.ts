// Driver-feed service: owns the feed's WebSocket route for the process lifetime
// and the ffmpeg encoder for the lifetime of one game session.
//
// Split that way because the two have genuinely different lifetimes. Clients may
// sit connected across `/play` and `/stop` (the controller page is long-lived),
// while the encoder only exists while there are frames to encode.

// This must share the existing Node HTTP server with Socket.IO; Bun.serve cannot
// mount on that server or preserve Engine.IO's upgrade behaviour. `ws` provides
// the noServer upgrade path that lets both protocols safely coexist.
import type { Server as HttpServer, IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocketServer, WebSocket, type RawData } from "ws";
import type { Logger } from "#src/logger.ts";
import type { DriverFeedConfig } from "./config.ts";
import {
  DRIVER_FEED_PATH,
  type DriverFeedInit,
  DriverFeedReadySchema,
} from "./protocol.ts";
import {
  DriverFeedEncoder,
  H264_CODEC_STRING,
  driverFeedOutputSize,
  type DriverFeedOutputSize,
  type DriverFeedSourceFormat,
} from "./encoder.ts";
import { DriverFeedHub, type FeedClient } from "./hub.ts";

/** Encoder settings shared with the Go-Live path: same GPU, same latency knob. */
export type DriverFeedVideoSettings = {
  readonly hardware_acceleration: boolean;
  readonly vaapi_device: string;
  readonly encoder_async_depth: number;
};

/**
 * The game's verdict on one connecting browser. An admitted client is asked
 * again through `isStillAdmitted` before every access unit, so losing the
 * right to watch (a released seat, leaving the voice channel) ends the feed.
 */
export type DriverFeedAdmission =
  | { readonly admitted: true; readonly isStillAdmitted: () => boolean }
  | { readonly admitted: false; readonly reason: string };

export type DriverFeedAudioFormat = {
  readonly sampleRate: number;
  readonly channels: number;
};

/** Decides who may watch. Games own the policy; core only enforces it. */
export type DriverFeedAdmit = (
  request: IncomingMessage,
) => DriverFeedAdmission | Promise<DriverFeedAdmission>;

export type DriverFeedServiceOptions = {
  readonly config: DriverFeedConfig;
  readonly video: DriverFeedVideoSettings;
  /** The game's frames; the feed encodes every one of them. */
  readonly source: DriverFeedSourceFormat;
  /** The game's audio, sent to pages as interleaved s16le PCM via `pushAudio`. */
  readonly audio: DriverFeedAudioFormat;
  /** Width / height of the picture as players should see it, e.g. 4/3 or 3/2. */
  readonly displayAspect: number;
  /** ffmpeg `scale` flags, e.g. `neighbor` for crisp pixel art. */
  readonly scaleFlags?: string;
  readonly logger: Logger;
  /** WebSocket path; defaults to `DRIVER_FEED_PATH`. */
  readonly path?: string;
};

const REJECT_ALL: DriverFeedAdmit = () => ({
  admitted: false,
  reason: "the driver feed is not accepting viewers",
});

export class DriverFeedService {
  private readonly options: DriverFeedServiceOptions;
  private readonly logger: Logger;
  private readonly path: string;
  private readonly output: DriverFeedOutputSize;
  private readonly hub: DriverFeedHub;
  private readonly activeClients = new Map<FeedClient, () => boolean>();
  private encoder: DriverFeedEncoder | undefined;
  private admit: DriverFeedAdmit = REJECT_ALL;

  constructor(options: DriverFeedServiceOptions) {
    this.options = options;
    this.logger = options.logger;
    this.path = options.path ?? DRIVER_FEED_PATH;
    this.output = driverFeedOutputSize(
      options.config.height,
      options.displayAspect,
    );
    this.hub = new DriverFeedHub({
      maxClients: options.config.max_clients,
      maxClientBufferBytes: options.config.max_client_buffer_bytes,
    });
  }

  /**
   * Install the game's admission policy. Until this is called every client is
   * rejected. It is a setter rather than a constructor option because the
   * policy usually depends on per-session state (Mario Kart's SeatManager)
   * that exists only after the game driver is built.
   */
  setAdmission(admit: DriverFeedAdmit): void {
    this.admit = admit;
  }

  /**
   * Mount the WebSocket route on the existing HTTP server.
   *
   * `noServer: true` plus a path-guarded listener is load-bearing: in attached
   * mode (`new WebSocketServer({ server })`) the library destroys sockets whose
   * path does not match, which would kill Socket.IO's own upgrades.
   *
   * Engine.io is not quite as polite in the other direction: by default it
   * ends any upgrade outside `/socket.io/` 1 s later unless the socket reports
   * bytes written, which Bun's upgraded sockets never do. `createGameSocket`
   * (webserver/socket.ts) turns that off and ends unserved upgrades itself.
   * `attach.test.ts` pins both behaviours.
   */
  attach(server: HttpServer): () => void {
    const wss = new WebSocketServer({ noServer: true });
    const upgrade = (
      request: IncomingMessage,
      socket: Duplex,
      head: Buffer,
    ) => {
      if (requestPath(request) !== this.path) return;
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit("connection", ws, request);
      });
    };
    server.on("upgrade", upgrade);
    wss.on("connection", (ws: WebSocket, request: IncomingMessage) => {
      void this.onConnection(ws, request);
    });
    this.logger.info("driver feed websocket attached", { path: this.path });
    return () => {
      this.stopSession();
      server.off("upgrade", upgrade);
      for (const client of wss.clients) client.terminate();
      wss.close();
    };
  }

  /**
   * Start encoding for a new session.
   *
   * Restarts rather than throws when an encoder is already up: a caller such as
   * a streamer's `onEncoderStarted` hook fires again when the stream
   * self-heals. Re-encoding from the new stream is the correct response, and the
   * clients resync at the first keyframe of the new process.
   */
  startSession(): void {
    if (this.encoder !== undefined) {
      this.logger.info(
        "driver feed restarting encoder for a new stream session",
      );
      this.encoder.stop();
      this.encoder = undefined;
      this.hub.resetAllToKeyframe();
    }
    const encoder = new DriverFeedEncoder(
      {
        source: this.options.source,
        output: this.output,
        ...(this.options.scaleFlags === undefined
          ? {}
          : { scaleFlags: this.options.scaleFlags }),
        bitrateKbps: this.options.config.bitrate_kbps,
        bitrateMaxKbps: this.options.config.bitrate_max_kbps,
        keyframeIntervalFrames: this.options.config.keyframe_interval_frames,
        hardwareAcceleration: this.options.video.hardware_acceleration,
        vaapiDevice: this.options.video.vaapi_device,
        encoderAsyncDepth: this.options.video.encoder_async_depth,
      },
      this.logger,
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

  /** Feed one chunk of the game's interleaved s16le audio. */
  pushAudio(pcm: Buffer): void {
    if (this.encoder === undefined) return;
    this.removeInactiveClients();
    this.hub.broadcastAudio(pcm);
  }

  /** Feed one composited frame, in the source pixel format, from the game's frame tee. */
  pushFrame(frame: Buffer, inputReceivedAtMs?: number): void {
    this.encoder?.pushFrame(frame, inputReceivedAtMs);
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
  }

  private async onConnection(
    ws: WebSocket,
    request: IncomingMessage,
  ): Promise<void> {
    this.removeInactiveClients();
    if (!requestHasSameOrigin(request)) {
      this.logger.warn("driver feed rejected a cross-origin client");
      ws.close(1008, "same-origin access is required");
      return;
    }
    let admission: DriverFeedAdmission;
    try {
      admission = await this.admit(request);
    } catch (error) {
      this.logger.error("driver feed admission check failed", error);
      ws.close(1011, "admission check failed");
      return;
    }
    if (!admission.admitted) {
      this.logger.warn("driver feed rejected a client", {
        reason: admission.reason,
      });
      ws.close(1008, admission.reason.slice(0, 123));
      return;
    }
    const { isStillAdmitted } = admission;
    const init: DriverFeedInit = {
      kind: "init",
      codec: H264_CODEC_STRING,
      width: this.output.width,
      height: this.output.height,
      frameRate: this.options.source.fps,
      audioSampleRate: this.options.audio.sampleRate,
      audioChannels: this.options.audio.channels,
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
      this.logger.warn("driver feed client socket error", error);
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
      if (!isStillAdmitted()) {
        ws.close(1008, "no longer admitted to the driver feed");
        return;
      }
      if (!this.hub.add(client)) {
        this.logger.warn("driver feed rejected a client at capacity", {
          maxClients: this.options.config.max_clients,
        });
        ws.close(1013, "driver feed is full");
        return;
      }
      this.activeClients.set(client, isStillAdmitted);
    });
  }

  private removeClient(client: FeedClient): void {
    this.activeClients.delete(client);
    this.hub.remove(client);
  }

  private removeInactiveClients(): void {
    for (const [client, isStillAdmitted] of this.activeClients) {
      if (isStillAdmitted()) continue;
      client.close("no longer admitted to the driver feed");
      this.removeClient(client);
    }
  }
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
  return Array.isArray(data) ? Buffer.concat(data).toString("utf8") : undefined;
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
