import type { Event as WsEvent } from "@clauderon/shared";
import { WebSocketError } from "./errors.js";
import { parseJson, resolveJsonValue } from "./json.js";

/**
 * Event types emitted by the events WebSocket.
 * Matches the server-side Event union from @clauderon/shared.
 */
export type SessionEvent = WsEvent & Record<never, never>;

/**
 * Parse a raw WebSocket message, extracting `type` and optional `event`.
 * Returns null if the message is not a valid object with a string `type`.
 * The event payload is typed as `unknown` on the parse boundary.
 */
function parseEventsMessage(raw: string): { type: string; event: unknown } | null {
  const parsed = parseJson(raw);
  if (typeof parsed !== "object" || parsed === null) {
    return null;
  }
  const type: unknown = Reflect.get(parsed, "type");
  if (typeof type !== "string") {
    return null;
  }
  const event: unknown = "event" in parsed ? Reflect.get(parsed, "event") : undefined;
  return { type, event };
}

/**
 * Configuration for EventsClient
 */
export type EventsClientConfig = {
  /**
   * WebSocket URL for events
   * @default Derived from window.location in browser, "ws://localhost:3030/ws/events" otherwise
   */
  url?: string;

  /**
   * Auto-reconnect on connection loss
   * @default true
   */
  autoReconnect?: boolean;

  /**
   * Reconnect delay in milliseconds
   * @default 1000
   */
  reconnectDelay?: number;
};

/**
 * Get the default WebSocket URL based on the current environment.
 * In browser context, derives from window.location.
 * In non-browser context, defaults to localhost:3030.
 */
function getDefaultWebSocketUrl(): string {
  if ("window" in globalThis) {
    const protocol = globalThis.location.protocol === "https:" ? "wss:" : "ws:";
    return `${protocol}//${globalThis.location.host}/ws/events`;
  }
  return "ws://localhost:3030/ws/events";
}

/**
 * WebSocket client for real-time session events
 */
export class EventsClient {
  private ws: WebSocket | null = null;
  private readonly url: string;
  private readonly autoReconnect: boolean;
  private readonly reconnectDelay: number;
  private reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
  private intentionallyClosed = false;

  private readonly listeners: {
    connected: (() => void)[];
    disconnected: (() => void)[];
    event: ((event: SessionEvent) => void)[];
    error: ((error: Error) => void)[];
  } = {
    connected: [],
    disconnected: [],
    event: [],
    error: [],
  };

  constructor(config: EventsClientConfig = {}) {
    this.url = config.url ?? getDefaultWebSocketUrl();
    this.autoReconnect = config.autoReconnect ?? true;
    this.reconnectDelay = config.reconnectDelay ?? 1000;
  }

  /**
   * Connect to the events WebSocket
   */
  connect(): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      return; // Already connected
    }

    this.intentionallyClosed = false;

    try {
      this.ws = new WebSocket(this.url);

      this.ws.addEventListener('open', () => {
        this.emit("connected");
      });

      this.ws.addEventListener('close', () => {
        this.emit("disconnected");

        // Auto-reconnect if not intentionally closed
        if (this.autoReconnect && !this.intentionallyClosed) {
          this.scheduleReconnect();
        }
      });

      this.ws.addEventListener("error", (event) => {
        this.emit(
          "error",
          new WebSocketError("WebSocket error occurred", event),
        );
      });

      this.ws.addEventListener("message", (event: MessageEvent<string>) => {
        try {
          const envelope = parseEventsMessage(event.data);
          if (envelope === null) {
            return;
          }

          // Handle connection acknowledgment
          if (envelope.type === "connected") {
            return;
          }

          // Handle session events (backend sends with type "event" and nested event object)
          if (envelope.type === "event" && envelope.event !== undefined) {
            void this.emitSessionEvent(envelope.event);
          }
        } catch (error) {
          this.emit(
            "error",
            new WebSocketError(
              `Failed to parse message: ${error instanceof Error ? error.message : String(error)}`,
            ),
          );
        }
      });
    } catch (error) {
      this.emit(
        "error",
        new WebSocketError(
          `Failed to connect: ${error instanceof Error ? error.message : String(error)}`,
          error,
        ),
      );
    }
  }

  /**
   * Disconnect from the events WebSocket
   */
  disconnect(): void {
    this.intentionallyClosed = true;

    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  /**
   * Listen for connection events
   */
  onConnected(callback: () => void): () => void {
    this.listeners.connected.push(callback);
    return () => {
      this.listeners.connected = this.listeners.connected.filter(
        (cb) => cb !== callback,
      );
    };
  }

  /**
   * Listen for disconnection events
   */
  onDisconnected(callback: () => void): () => void {
    this.listeners.disconnected.push(callback);
    return () => {
      this.listeners.disconnected = this.listeners.disconnected.filter(
        (cb) => cb !== callback,
      );
    };
  }

  /**
   * Listen for session events
   */
  onEvent(callback: (event: SessionEvent) => void): () => void {
    this.listeners.event.push(callback);
    return () => {
      this.listeners.event = this.listeners.event.filter(
        (cb) => cb !== callback,
      );
    };
  }

  /**
   * Listen for errors
   */
  onError(callback: (error: Error) => void): () => void {
    this.listeners.error.push(callback);
    return () => {
      this.listeners.error = this.listeners.error.filter(
        (cb) => cb !== callback,
      );
    };
  }

  /**
   * Get current connection state
   */
  get isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  private async emitSessionEvent(event: unknown): Promise<void> {
    const sessionEvent = await resolveJsonValue<SessionEvent>(event);
    this.emit("event", sessionEvent);
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimeout) {
      return;
    }

    this.reconnectTimeout = setTimeout(() => {
      this.reconnectTimeout = null;
      this.connect();
    }, this.reconnectDelay);
  }

  private emit(event: "connected" | "disconnected"): void;
  private emit(event: "event", sessionEvent: SessionEvent): void;
  private emit(event: "error", error: Error): void;
  private emit(
    event: keyof typeof this.listeners,
    arg?: SessionEvent | Error,
  ): void {
    if (event === "connected" || event === "disconnected") {
      for (const listener of this.listeners[event]) {
        listener();
      }
    } else if (
      event === "event" &&
      arg &&
      "type" in arg &&
      !(arg instanceof Error)
    ) {
      for (const listener of this.listeners.event) {
        listener(arg);
      }
    } else if (event === "error" && arg instanceof Error) {
      for (const listener of this.listeners.error) {
        listener(arg);
      }
    }
  }
}
