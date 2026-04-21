import { z } from "zod";
import { normalizeBaseUrl } from "#shared/config.ts";
import { HaWebSocketClosedError, HaWebSocketError } from "./errors.ts";

/**
 * Minimal structural shape of the WebSocket API the client consumes. Narrow
 * enough that test doubles (see test/fake-websocket.ts) can satisfy it
 * without type assertions, but wide enough that the DOM `WebSocket` global
 * is structurally assignable.
 */
export type WebSocketLike = {
  readonly readyState: number;
  readonly OPEN: number;
  send: (data: string) => void;
  close: (code?: number, reason?: string) => void;
  addEventListener: (type: string, listener: (event: unknown) => void) => void;
  removeEventListener: (
    type: string,
    listener: (event: unknown) => void,
  ) => void;
};

export type WebSocketLikeCtor = new (url: string) => WebSocketLike;

export function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function waitForOpen(socket: WebSocketLike): Promise<void> {
  return new Promise((resolve, reject) => {
    if (socket.readyState === socket.OPEN) {
      resolve();
      return;
    }
    const onOpen = (): void => {
      cleanup();
      resolve();
    };
    const onError = (): void => {
      cleanup();
      reject(new HaWebSocketError("WebSocket failed to open"));
    };
    const onClose = (): void => {
      // If close() is called (or the server rejects the TCP/WS upgrade)
      // while still CONNECTING, the real WebSocket emits `close` without
      // ever firing `open`. Without this listener the promise would leak.
      cleanup();
      reject(new HaWebSocketClosedError());
    };
    const cleanup = (): void => {
      socket.removeEventListener("open", onOpen);
      socket.removeEventListener("error", onError);
      socket.removeEventListener("close", onClose);
    };
    socket.addEventListener("open", onOpen);
    socket.addEventListener("error", onError);
    socket.addEventListener("close", onClose);
  });
}

export const MessageDataString = z.string();

const WebSocketEventShape = z.looseObject({ data: z.unknown() });

export function extractEventData(event: unknown): unknown {
  const parsed = WebSocketEventShape.safeParse(event);
  return parsed.success ? parsed.data.data : undefined;
}

export function waitForFirstMessage(socket: WebSocketLike): Promise<string> {
  return new Promise((resolve, reject) => {
    const onMessage = (event: unknown): void => {
      cleanup();
      const parsed = MessageDataString.safeParse(extractEventData(event));
      resolve(parsed.success ? parsed.data : "");
    };
    const onClose = (): void => {
      cleanup();
      reject(new HaWebSocketClosedError());
    };
    const cleanup = (): void => {
      socket.removeEventListener("message", onMessage);
      socket.removeEventListener("close", onClose);
    };
    socket.addEventListener("message", onMessage);
    socket.addEventListener("close", onClose);
  });
}

export function buildWsUrl(baseUrl: string): string {
  const normalized = normalizeBaseUrl(baseUrl);
  if (normalized.startsWith("https://")) {
    return `${normalized.replace(/^https:\/\//u, "wss://")}/api/websocket`;
  }
  if (normalized.startsWith("http://")) {
    return `${normalized.replace(/^http:\/\//u, "ws://")}/api/websocket`;
  }
  return `${normalized}/api/websocket`;
}
