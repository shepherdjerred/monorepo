import type { Session } from "@mux/shared";
import { WebSocketError } from "./errors.js";

/**
 * Event types emitted by the events WebSocket
 */
export type SessionEvent =
  | { type: "session_created"; session: Session }
  | { type: "session_updated"; session: Session }
  | { type: "session_deleted"; sessionId: string }
  | { type: "status_changed"; sessionId: string; oldStatus: string; newStatus: string };

/**
 * Configuration for EventsClient
 */
export interface EventsClientConfig {
  /**
   * WebSocket URL for events
   * @default "ws://localhost:3030/ws/events"
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

  private listeners: {
    connected: Array<() => void>;
    disconnected: Array<() => void>;
    event: Array<(event: SessionEvent) => void>;
    error: Array<(error: Error) => void>;
  } = {
    connected: [],
    disconnected: [],
    event: [],
    error: [],
  };

  constructor(config: EventsClientConfig = {}) {
    this.url = config.url ?? "ws://localhost:3030/ws/events";
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

      this.ws.onopen = () => {
        this.emit("connected");
      };

      this.ws.onclose = () => {
        this.emit("disconnected");

        // Auto-reconnect if not intentionally closed
        if (this.autoReconnect && !this.intentionallyClosed) {
          this.scheduleReconnect();
        }
      };

      this.ws.onerror = (event) => {
        this.emit("error", new WebSocketError("WebSocket error occurred", event));
      };

      this.ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);

          // Handle connection acknowledgment
          if (data.type === "connected") {
            return;
          }

          // Handle session events
          if (data.type === "event" && data.event) {
            this.emit("event", data.event as SessionEvent);
          }
        } catch (error) {
          this.emit(
            "error",
            new WebSocketError(`Failed to parse message: ${error instanceof Error ? error.message : String(error)}`)
          );
        }
      };
    } catch (error) {
      this.emit(
        "error",
        new WebSocketError(`Failed to connect: ${error instanceof Error ? error.message : String(error)}`, error)
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
      this.listeners.connected = this.listeners.connected.filter((cb) => cb !== callback);
    };
  }

  /**
   * Listen for disconnection events
   */
  onDisconnected(callback: () => void): () => void {
    this.listeners.disconnected.push(callback);
    return () => {
      this.listeners.disconnected = this.listeners.disconnected.filter((cb) => cb !== callback);
    };
  }

  /**
   * Listen for session events
   */
  onEvent(callback: (event: SessionEvent) => void): () => void {
    this.listeners.event.push(callback);
    return () => {
      this.listeners.event = this.listeners.event.filter((cb) => cb !== callback);
    };
  }

  /**
   * Listen for errors
   */
  onError(callback: (error: Error) => void): () => void {
    this.listeners.error.push(callback);
    return () => {
      this.listeners.error = this.listeners.error.filter((cb) => cb !== callback);
    };
  }

  /**
   * Get current connection state
   */
  get isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
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

  private emit<K extends keyof typeof this.listeners>(
    event: K,
    ...args: Parameters<(typeof this.listeners)[K][number]>
  ): void {
    for (const listener of this.listeners[event]) {
      // @ts-expect-error - TypeScript doesn't understand the spread here
      listener(...args);
    }
  }
}
