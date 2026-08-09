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

function feedUrl(): string {
  const protocol = globalThis.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${globalThis.location.host}${DRIVER_FEED_PATH}`;
}

/**
 * Connect, decode, and paint until the returned disposer is called.
 *
 * Reconnects with backoff: the controller page outlives any single game session,
 * so a `/stop` (which drops every client) must not leave a dead canvas behind.
 */
export function connectDriverFeed(callbacks: DriverFeedCallbacks): () => void {
  if (!("VideoDecoder" in globalThis)) {
    callbacks.onStatus({ kind: "unsupported" });
    return () => {
      // Nothing was started.
    };
  }

  let disposed = false;
  let socket: WebSocket | undefined;
  let decoder: VideoDecoder | undefined;
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  let attempt = 0;
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
  };

  const scheduleReconnect = () => {
    if (disposed || reconnectTimer !== undefined) return;
    const delay = Math.min(RECONNECT_BASE_MS * 2 ** attempt, RECONNECT_MAX_MS);
    attempt += 1;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = undefined;
      open();
    }, delay);
  };

  const configure = (init: DriverFeedInit) => {
    closeDecoder();
    started = false;
    const created = new VideoDecoder({
      output: (frame) => {
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
    created.configure({
      codec: init.codec,
      codedWidth: init.width,
      codedHeight: init.height,
      // No `description`: per the W3C AVC registration, omitting it selects
      // Annex-B, which is what the server sends.
      optimizeForLatency: true,
    });
    decoder = created;
    callbacks.onStatus({ kind: "waiting" });
  };

  const decodeMessage = (buffer: ArrayBuffer) => {
    const active = decoder;
    if (active?.state !== "configured") return;
    if (buffer.byteLength <= DRIVER_FEED_HEADER_BYTES) return;

    const header = new Uint8Array(buffer, 0, DRIVER_FEED_HEADER_BYTES);
    const isKeyframe = (header[0] & DRIVER_FEED_KEYFRAME_FLAG) !== 0;
    if (!started) {
      // Feeding a delta to a fresh decoder throws and kills it. The server
      // already withholds deltas until a keyframe, so this only guards against
      // a mid-stream reconnect racing the hub's own bookkeeping.
      if (!isKeyframe) return;
      started = true;
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
    const ws = new WebSocket(feedUrl());
    ws.binaryType = "arraybuffer";
    socket = ws;

    ws.addEventListener("open", () => {
      attempt = 0;
    });
    ws.addEventListener("message", (event: MessageEvent<unknown>) => {
      const data = event.data;
      if (typeof data === "string") {
        const parsed = DriverFeedInitSchema.safeParse(JSON.parse(data));
        if (!parsed.success) {
          callbacks.onStatus({
            kind: "error",
            message: "driver feed sent an unrecognised handshake",
          });
          ws.close();
          return;
        }
        configure(parsed.data);
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
