import { AppState } from "react-native";
import type { AppStateStatus } from "react-native";
import type { Session, ProgressStep, Event as RustEvent } from "../types/generated";
import { WebSocketError } from "./errors";

/**
 * Event types emitted by the events WebSocket (transformed from Rust Event type)
 */
export type SessionEvent =
  | { type: "session_created"; session: Session }
  | { type: "session_updated"; session: Session }
  | { type: "session_deleted"; sessionId: string }
  | {
      type: "status_changed";
      sessionId: string;
      oldStatus: string;
      newStatus: string;
    }
  | { type: "session_progress"; sessionId: string; progress: ProgressStep }
  | { type: "session_failed"; sessionId: string; error: string };

/**
 * Message received from the events WebSocket
 */
type EventsMessage = {
  type: string;
  event?: RustEvent;
  message?: string;
};

/**
 * Transform Rust Event type to JavaScript SessionEvent type
 */
function transformEvent(event: RustEvent): SessionEvent | null {
  switch (event.type) {
    case "SessionCreated":
      return { type: "session_created", session: event.payload };
    case "SessionUpdated":
      return { type: "session_updated", session: event.payload };
    case "SessionDeleted":
      return { type: "session_deleted", sessionId: event.payload.id };
    case "StatusChanged":
      return {
        type: "status_changed",
        sessionId: event.payload.id,
        oldStatus: event.payload.old,
        newStatus: event.payload.new,
      };
    case "SessionProgress":
      return {
        type: "session_progress",
        sessionId: event.payload.id,
        progress: event.payload.progress,
      };
    case "SessionFailed":
      return {
        type: "session_failed",
        sessionId: event.payload.id,
        error: event.payload.error,
      };
    default:
      return null;
  }
}

/**
 * Configuration for EventsClient
 */
export type EventsClientConfig = {
  /**
   * WebSocket URL for events
   */
  url: string;

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
 * WebSocket client for real-time session events
 */
export class EventsClient {
  private ws: WebSocket | null = null;
  private readonly url: string;
  private readonly autoReconnect: boolean;
  private readonly reconnectDelay: number;
  private reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
  private intentionallyClosed = false;
  private appStateSubscription: ReturnType<
    typeof AppState.addEventListener
  > | null = null;

  private listeners: {
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

  constructor(config: EventsClientConfig) {
    this.url = config.url;
    this.autoReconnect = config.autoReconnect ?? true;
    this.reconnectDelay = config.reconnectDelay ?? 1000;

    // Listen for app state changes to reconnect when app comes to foreground
    this.appStateSubscription = AppState.addEventListener(
      "change",
      this.handleAppStateChange
    );
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
          const data = JSON.parse(
            typeof event.data === "string" ? event.data : ""
          ) as EventsMessage;

          // Handle connection acknowledgment
          if (data.type === "connected") {
            return;
          }

          // Handle session events
          if (data.type === "event" && data.event) {
            const transformedEvent = transformEvent(data.event);
            if (transformedEvent) {
              this.emit("event", transformedEvent);
            }
          }
        } catch (error) {
          this.emit(
            "error",
            new WebSocketError(
              `Failed to parse message: ${error instanceof Error ? error.message : String(error)}`
            )
          );
        }
      };
    } catch (error) {
      this.emit(
        "error",
        new WebSocketError(
          `Failed to connect: ${error instanceof Error ? error.message : String(error)}`,
          error
        )
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
   * Clean up resources
   */
  dispose(): void {
    this.disconnect();
    if (this.appStateSubscription) {
      this.appStateSubscription.remove();
      this.appStateSubscription = null;
    }
  }

  /**
   * Listen for connection events
   */
  onConnected(callback: () => void): () => void {
    this.listeners.connected.push(callback);
    return () => {
      this.listeners.connected = this.listeners.connected.filter(
        (cb) => cb !== callback
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
        (cb) => cb !== callback
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
        (cb) => cb !== callback
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
        (cb) => cb !== callback
      );
    };
  }

  /**
   * Get current connection state
   */
  get isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  private handleAppStateChange = (nextAppState: AppStateStatus): void => {
    // Reconnect when app comes to foreground
    if (nextAppState === "active" && !this.isConnected && !this.intentionallyClosed) {
      this.connect();
    }
  };

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
    arg?: SessionEvent | Error
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
