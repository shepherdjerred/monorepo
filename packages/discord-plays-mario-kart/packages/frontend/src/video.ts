// Driver feed client: WebSocket in, decoded frames out.
//
// Framework-free on purpose — `game-view.tsx` owns the canvas and the React
// state, this owns the socket, the decoder, and the lifetime of every
// `VideoFrame` (a leaked frame stalls the decoder, so exactly one place closes
// them).
//
// Frames are painted the moment the decoder emits them rather than scheduled
// against a clock. That is the whole point of the feed: any presentation buffer
// we added here would give back the latency the transport just saved.

import {
  DRIVER_FEED_HEADER_BYTES,
  DRIVER_FEED_KEYFRAME_FLAG,
  DRIVER_FEED_PATH,
  DriverFeedInitSchema,
  type DriverFeedInit,
  type DriverFeedReady,
} from "@discord-plays-mario-kart/common";

export type DriverFeedStatus =
  | { readonly kind: "unsupported" }
  | { readonly kind: "connecting" }
  /** Connected and configured, waiting for the next keyframe to start decoding. */
  | { readonly kind: "waiting" }
  | { readonly kind: "playing" }
  | { readonly kind: "error"; readonly message: string };

export type DriverFeedCallbacks = {
  readonly onStatus: (status: DriverFeedStatus) => void;
  /**
   * Paint one decoded frame. The frame is closed as soon as this returns, so
   * draw synchronously and do not retain it.
   */
  readonly paint: (frame: VideoFrame) => void;
};

const RECONNECT_BASE_MS = 500;
const RECONNECT_MAX_MS = 5000;
const MAX_DECODE_QUEUE_SIZE = 2;

export type DriverFeedDecodeState = {
  readonly started: boolean;
  readonly isKeyframe: boolean;
  readonly decodeQueueSize: number;
};

export type DriverFeedDecodeDecision = {
  readonly reset: boolean;
  readonly decode: boolean;
  readonly nextStarted: boolean;
};

/** Keep queued decode work bounded; a reset must wait for a fresh entry point. */
export function decideDriverFeedDecode(
  state: DriverFeedDecodeState,
): DriverFeedDecodeDecision {
  const reset = state.decodeQueueSize >= MAX_DECODE_QUEUE_SIZE;
  const decode = state.isKeyframe || (state.started && !reset);
  return {
    reset,
    decode,
    nextStarted: decode,
  };
}

function feedUrl(driverSocketId: string): string {
  const protocol = globalThis.location.protocol === "https:" ? "wss:" : "ws:";
  const query = new URLSearchParams({ driverSocketId });
  return `${protocol}//${globalThis.location.host}${DRIVER_FEED_PATH}?${query.toString()}`;
}

/**
 * Connect, decode, and paint until the returned disposer is called.
 *
 * Reconnects with backoff: the controller page outlives any single game session,
 * so a `/stop` (which drops every client) must not leave a dead canvas behind.
 */
export function connectDriverFeed(
  callbacks: DriverFeedCallbacks,
  driverSocketId: string,
): () => void {
  if (!("VideoDecoder" in globalThis)) {
    callbacks.onStatus({ kind: "unsupported" });
    return () => {
      // Nothing was started.
    };
  }

  let disposed = false;
  let socket: WebSocket | undefined;
  let decoder: VideoDecoder | undefined;
  let decoderConfig: VideoDecoderConfig | undefined;
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  let attempt = 0;
  let unsupported = false;
  // Monotonic, synthesised locally: the decoder only needs increasing
  // timestamps to order chunks, and a client that missed units during a resync
  // must not rewind its own clock.
  let nextTimestampUs = 0;
  let started = false;

  const closeDecoder = () => {
    if (decoder === undefined) return;
    // `close()` throws on an already-closed decoder; state is the documented guard.
    if (decoder.state !== "closed") decoder.close();
    decoder = undefined;
    decoderConfig = undefined;
  };

  const scheduleReconnect = () => {
    if (disposed || unsupported || reconnectTimer !== undefined) return;
    const delay = Math.min(RECONNECT_BASE_MS * 2 ** attempt, RECONNECT_MAX_MS);
    attempt += 1;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = undefined;
      open();
    }, delay);
  };

  const configure = async (
    init: DriverFeedInit,
    ws: WebSocket,
  ): Promise<void> => {
    closeDecoder();
    started = false;
    const created = new VideoDecoder({
      output: (frame) => {
        attempt = 0;
        try {
          callbacks.paint(frame);
        } finally {
          frame.close();
        }
      },
      error: (error: DOMException) => {
        callbacks.onStatus({ kind: "error", message: error.message });
        // A decoder error is terminal for that decoder; drop the socket so the
        // reconnect path rebuilds both and resyncs at the next keyframe.
        socket?.close();
      },
    });
    const config: VideoDecoderConfig = {
      codec: init.codec,
      codedWidth: init.width,
      codedHeight: init.height,
      // No `description`: per the W3C AVC registration, omitting it selects
      // Annex-B, which is what the server sends.
      optimizeForLatency: true,
    };
    try {
      const support = await VideoDecoder.isConfigSupported(config);
      if (disposed || socket !== ws || ws.readyState !== WebSocket.OPEN) {
        created.close();
        return;
      }
      if (support.supported !== true) {
        unsupported = true;
        created.close();
        callbacks.onStatus({ kind: "unsupported" });
        ws.close();
        return;
      }
      created.configure(config);
    } catch {
      unsupported = true;
      created.close();
      callbacks.onStatus({ kind: "unsupported" });
      ws.close();
      return;
    }
    decoder = created;
    decoderConfig = config;
    callbacks.onStatus({ kind: "waiting" });
    const ready: DriverFeedReady = { kind: "ready" };
    ws.send(JSON.stringify(ready));
  };

  const decodeMessage = (buffer: ArrayBuffer) => {
    const active = decoder;
    const config = decoderConfig;
    if (config === undefined || active?.state !== "configured") return;
    if (buffer.byteLength <= DRIVER_FEED_HEADER_BYTES) return;

    const header = new Uint8Array(buffer, 0, DRIVER_FEED_HEADER_BYTES);
    const isKeyframe = (header[0] & DRIVER_FEED_KEYFRAME_FLAG) !== 0;
    const decision = decideDriverFeedDecode({
      started,
      isKeyframe,
      decodeQueueSize: active.decodeQueueSize,
    });
    if (decision.reset) {
      active.reset();
      active.configure(config);
      callbacks.onStatus({ kind: "waiting" });
    }
    const wasStarted = started;
    started = decision.nextStarted;
    if (!decision.decode) return;
    if (!wasStarted || decision.reset) {
      callbacks.onStatus({ kind: "playing" });
    }

    active.decode(
      new EncodedVideoChunk({
        type: isKeyframe ? "key" : "delta",
        timestamp: nextTimestampUs,
        data: new Uint8Array(buffer, DRIVER_FEED_HEADER_BYTES),
      }),
    );
    nextTimestampUs += 1;
  };

  function open(): void {
    if (disposed) return;
    callbacks.onStatus({ kind: "connecting" });
    const ws = new WebSocket(feedUrl(driverSocketId));
    ws.binaryType = "arraybuffer";
    socket = ws;

    ws.addEventListener("message", (event: MessageEvent<unknown>) => {
      const data = event.data;
      if (typeof data === "string") {
        let handshake: unknown;
        try {
          handshake = JSON.parse(data);
        } catch {
          callbacks.onStatus({
            kind: "error",
            message: "driver feed sent malformed handshake data",
          });
          ws.close();
          return;
        }
        const parsed = DriverFeedInitSchema.safeParse(handshake);
        if (!parsed.success) {
          callbacks.onStatus({
            kind: "error",
            message: "driver feed sent an unrecognised handshake",
          });
          ws.close();
          return;
        }
        void configure(parsed.data, ws);
        return;
      }
      if (data instanceof ArrayBuffer) decodeMessage(data);
    });
    ws.addEventListener("close", () => {
      closeDecoder();
      scheduleReconnect();
    });
    ws.addEventListener("error", () => {
      // `close` always follows, and it owns the reconnect.
      callbacks.onStatus({
        kind: "error",
        message: "driver feed disconnected",
      });
    });
  }

  open();

  return () => {
    disposed = true;
    if (reconnectTimer !== undefined) clearTimeout(reconnectTimer);
    closeDecoder();
    socket?.close();
    socket = undefined;
  };
}
