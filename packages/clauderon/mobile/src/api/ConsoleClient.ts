import { WebSocketError } from "./errors";

/**
 * Message received from the console WebSocket
 */
type ConsoleMessage = {
  type: string;
  data?: string;
};

/**
 * Configuration for ConsoleClient
 */
export type ConsoleClientConfig = {
  /**
   * Base WebSocket URL (without the session ID)
   */
  baseUrl: string;
};

/**
 * WebSocket client for terminal console streaming
 */
export class ConsoleClient {
  private ws: WebSocket | null = null;
  private readonly baseUrl: string;
  private sessionId: string | null = null;

  private listeners: {
    connected: (() => void)[];
    disconnected: (() => void)[];
    data: ((data: string) => void)[];
    error: ((error: Error) => void)[];
  } = {
    connected: [],
    disconnected: [],
    data: [],
    error: [],
  };

  constructor(config: ConsoleClientConfig) {
    this.baseUrl = config.baseUrl;
  }

  /**
   * Connect to a session's console
   */
  connect(sessionId: string): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.disconnect();
    }

    this.sessionId = sessionId;
    const url = `${this.baseUrl}/${encodeURIComponent(sessionId)}`;

    try {
      this.ws = new WebSocket(url);

      this.ws.onopen = () => {
        this.emit("connected");
      };

      this.ws.onclose = () => {
        this.emit("disconnected");
      };

      this.ws.onerror = (event) => {
        this.emit("error", new WebSocketError("WebSocket error occurred", event));
      };

      this.ws.onmessage = (event) => {
        try {
          const message = JSON.parse(
            typeof event.data === "string" ? event.data : ""
          ) as ConsoleMessage;

          if (message.type === "output" && typeof message.data === "string") {
            // Decode base64 data with error handling
            try {
              // Use React Native's atob (available globally)
              const binaryString = atob(message.data);
              // Convert binary string to Uint8Array
              const bytes = Uint8Array.from(binaryString, (char) =>
                char.charCodeAt(0)
              );
              // Decode UTF-8 bytes to proper string
              const decoded = new TextDecoder("utf-8").decode(bytes);
              this.emit("data", decoded);
            } catch (decodeError) {
              this.emit(
                "error",
                new WebSocketError(
                  `Failed to decode base64 data: ${decodeError instanceof Error ? decodeError.message : String(decodeError)}`
                )
              );
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
   * Disconnect from the console
   */
  disconnect(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.sessionId = null;
  }

  /**
   * Write input data to the console
   */
  write(data: string): void {
    if (this.ws?.readyState !== WebSocket.OPEN) {
      throw new WebSocketError("Not connected to console");
    }

    // Encode UTF-8 string to bytes, then to base64
    const encoder = new TextEncoder();
    const bytes = encoder.encode(data);
    const binaryString = Array.from(bytes, (byte) =>
      String.fromCharCode(byte)
    ).join("");
    const encoded = btoa(binaryString);

    const message = {
      type: "input",
      data: encoded,
    };

    this.ws.send(JSON.stringify(message));
  }

  /**
   * Resize the terminal
   */
  resize(rows: number, cols: number): void {
    if (this.ws?.readyState !== WebSocket.OPEN) {
      throw new WebSocketError("Not connected to console");
    }

    const message = {
      type: "resize",
      rows,
      cols,
    };

    this.ws.send(JSON.stringify(message));
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
   * Listen for data from the console
   */
  onData(callback: (data: string) => void): () => void {
    this.listeners.data.push(callback);
    return () => {
      this.listeners.data = this.listeners.data.filter((cb) => cb !== callback);
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

  /**
   * Get the current session ID
   */
  get currentSessionId(): string | null {
    return this.sessionId;
  }

  private emit(event: "connected" | "disconnected"): void;
  private emit(event: "data", data: string): void;
  private emit(event: "error", error: Error): void;
  private emit(
    event: keyof typeof this.listeners,
    arg?: string | Error
  ): void {
    if (event === "connected" || event === "disconnected") {
      for (const listener of this.listeners[event]) {
        listener();
      }
    } else if (event === "data" && typeof arg === "string") {
      for (const listener of this.listeners.data) {
        listener(arg);
      }
    } else if (event === "error" && arg instanceof Error) {
      for (const listener of this.listeners.error) {
        listener(arg);
      }
    }
  }
}
