/**
 * The host side of the in-frame bridge protocol (version 1). It mirrors
 * `src/bridge/bridge.ts`, which the content host injects into every HTML
 * entry; change the two together.
 *
 * The bridge runs inside a sandboxed, opaque-origin iframe, so everything it
 * says is untrusted. The host accepts only these zod-validated, clamped,
 * rate-limited messages, and identifies the sender by the `MessagePort` it
 * was handed, never by anything in a payload.
 *
 * Handshake (window messages):
 *   frame -> host   { ab: 1, t: "hello" }                 from `iframe.contentWindow`, origin "null"
 *   host  -> frame  { ab: 1, t: "init", mode, scale }     targetOrigin "*", transfers one MessagePort
 *
 * After that every message travels over the port.
 *
 *   frame -> host   drawn   { docW, docH }                document size (CSS px) once settled
 *                   scroll  { x, y, docW?, docH? }        document scroll offset
 *                   wheel   { dx, dy, ctrl, x, y }        wheel or trackpad pinch the frame did not keep
 *                   gesture { scale, x, y }               Safari gesture* the frame did not keep
 *                   key     { k: "Escape" | "c" }         the two keys the host needs while the frame has focus
 *                   point   { id, docX, docY }            the answer to a `probe`
 *                   error   { message }                   an uncaught error
 *                   nav     { path }                      location.pathname + search + hash
 *   host  -> frame  probe    { id, x, y }                 what document point is under frame client (x, y)?
 *                   scrollTo { x, y }                     scroll the document (to reveal a pin, or for the wheel overlay)
 *                   mode     { mode }                     "host" makes the frame forward wheel input; anything else keeps it
 */
import { z } from "zod";
import type { Anchor } from "@shepherdjerred/artifacts/contract";
import { clampUnit } from "#client/lib/geometry.ts";

export const BRIDGE_VERSION = 1;

const MAX_DIMENSION = 100_000;
const MAX_COORDINATE = 1_000_000;
const MAX_DELTA = 10_000;
const MAX_TEXT = 2000;

const coordinate = z.number().min(-MAX_COORDINATE).max(MAX_COORDINATE);
const dimension = z.number().min(0).max(MAX_DIMENSION);
const delta = z.number().min(-MAX_DELTA).max(MAX_DELTA);

/** Port messages may carry `ab: 1` (older bridges) or omit it. */
const version = z.literal(BRIDGE_VERSION).optional();

export const FrameMessageSchema = z.discriminatedUnion("t", [
  z.strictObject({
    ab: version,
    t: z.literal("drawn"),
    docW: dimension,
    docH: dimension,
  }),
  z.strictObject({
    ab: version,
    t: z.literal("scroll"),
    x: coordinate,
    y: coordinate,
    docW: dimension.optional(),
    docH: dimension.optional(),
  }),
  z.strictObject({
    ab: version,
    t: z.literal("wheel"),
    dx: delta,
    dy: delta,
    ctrl: z.boolean().default(false),
    x: coordinate,
    y: coordinate,
  }),
  z.strictObject({
    ab: version,
    t: z.literal("gesture"),
    scale: z.number().min(0.01).max(100),
    x: coordinate,
    y: coordinate,
  }),
  z.strictObject({
    ab: version,
    t: z.literal("key"),
    k: z.enum(["Escape", "c"]),
  }),
  z.strictObject({
    ab: version,
    t: z.literal("point"),
    id: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
    docX: coordinate,
    docY: coordinate,
  }),
  z.strictObject({
    ab: version,
    t: z.literal("error"),
    message: z.string().max(MAX_TEXT),
  }),
  z.strictObject({
    ab: version,
    t: z.literal("nav"),
    path: z.string().max(MAX_TEXT),
  }),
]);
export type FrameMessage = z.infer<typeof FrameMessageSchema>;

export const HelloSchema = z.strictObject({
  ab: z.literal(BRIDGE_VERSION),
  t: z.literal("hello"),
});

/** Every message type the host sends over the port; the bridge handles exactly these. */
export const HOST_MESSAGE_TYPES = ["probe", "scrollTo", "mode"] as const;

export type HostMessage =
  | {
      readonly ab: 1;
      readonly t: "probe";
      readonly id: number;
      readonly x: number;
      readonly y: number;
    }
  | { readonly ab: 1; readonly t: "mode"; readonly mode: FrameMode }
  | {
      readonly ab: 1;
      readonly t: "scrollTo";
      readonly x: number;
      readonly y: number;
    }
  | {
      readonly ab: 1;
      readonly t: "scrollBy";
      readonly dx: number;
      readonly dy: number;
    };

export type FrameMode = "node" | "focus" | "inert";

/** Parses one untrusted payload; null when it is not a valid frame message. */
export function parseFrameMessage(data: unknown): FrameMessage | null {
  const result = FrameMessageSchema.safeParse(data);
  return result.success ? result.data : null;
}

export function isHello(data: unknown): boolean {
  return HelloSchema.safeParse(data).success;
}

/**
 * A token bucket. `accept()` is true while the sender stays under `perSecond`
 * on average, with bursts up to `burst`; a flooding frame is simply ignored.
 */
export type RateLimiter = { accept: () => boolean };

export function createRateLimiter(
  options: { readonly perSecond: number; readonly burst: number },
  now: () => number = () => performance.now(),
): RateLimiter {
  let tokens = options.burst;
  let last = now();
  return {
    accept() {
      const current = now();
      tokens = Math.min(
        options.burst,
        tokens + ((current - last) / 1000) * options.perSecond,
      );
      last = current;
      if (tokens < 1) return false;
      tokens -= 1;
      return true;
    },
  };
}

/** Defaults: scroll and wheel arrive at display rate, so allow 90 per second. */
export const BRIDGE_RATE = { perSecond: 90, burst: 120 } as const;

export type BridgeHandlers = {
  readonly onMessage: (message: FrameMessage) => void;
  /** The frame said hello and a port was created. */
  readonly onConnected?: () => void;
};

/** The slice of a window `message` event the host looks at. */
export type HostMessageEvent = {
  readonly source: unknown;
  readonly origin: string;
  readonly data: unknown;
};

export type BridgeHost = {
  /** Handles a window `message` event; true when it belonged to this frame. */
  readonly handleWindowMessage: (event: HostMessageEvent) => boolean;
  readonly send: (message: HostMessage) => void;
  readonly connected: () => boolean;
  readonly dispose: () => void;
};

/** What the host needs of the frame's window: to post the init message and port. */
export type PostTarget = {
  postMessage: (
    message: unknown,
    targetOrigin: string,
    transfer: Transferable[],
  ) => void;
};
type FrameSource = { readonly contentWindow: PostTarget | null };

type Connection = { readonly port: MessagePort; readonly stop: () => void };

/**
 * One bridge per iframe. The frame is accepted only when the event's source is
 * this iframe's window and its origin serializes to "null" (an opaque origin).
 * A second hello replaces the port, which is how a navigation inside the frame
 * reconnects.
 */
export function createBridgeHost(
  frame: FrameSource,
  init: () => { readonly mode: FrameMode; readonly scale: number },
  handlers: BridgeHandlers,
  now: () => number = () => performance.now(),
): BridgeHost {
  let connection: Connection | null = null;

  function close(): void {
    connection?.stop();
    connection = null;
  }

  function connect(target: PostTarget): void {
    close();
    const limiter = createRateLimiter(BRIDGE_RATE, now);
    const channel = new MessageChannel();
    const { port1: port } = channel;
    const onPortMessage = (portEvent: MessageEvent): void => {
      if (!limiter.accept()) return;
      const message = parseFrameMessage(portEvent.data);
      if (message !== null) handlers.onMessage(message);
    };
    port.addEventListener("message", onPortMessage);
    port.start();
    connection = {
      port,
      stop() {
        port.removeEventListener("message", onPortMessage);
        port.close();
      },
    };
    const { mode, scale } = init();
    target.postMessage({ ab: BRIDGE_VERSION, t: "init", mode, scale }, "*", [
      channel.port2,
    ]);
    handlers.onConnected?.();
  }

  return {
    handleWindowMessage(event) {
      const target = frame.contentWindow;
      if (target === null || event.source !== target) return false;
      if (event.origin !== "null" || !isHello(event.data)) return false;
      connect(target);
      return true;
    },
    send(message) {
      connection?.port.postMessage(message);
    },
    connected: () => connection !== null,
    dispose: close,
  };
}

/**
 * The `doc` anchor a `point` answer names. The frame reports document pixels;
 * the document width is the last one it reported with `drawn`, or the
 * viewport's when it has not said.
 */
export function docAnchorFromPoint(
  answer: Extract<FrameMessage, { t: "point" }>,
  doc: { readonly width: number; readonly path: string } | null,
  viewportWidth: number,
): Anchor {
  const width = Math.max(
    1,
    doc !== null && doc.width > 0 ? doc.width : viewportWidth,
  );
  return {
    type: "doc",
    path: doc?.path ?? "",
    x: clampUnit(answer.docX / width),
    y: Math.max(0, answer.docY),
    docWidth: width,
  };
}
