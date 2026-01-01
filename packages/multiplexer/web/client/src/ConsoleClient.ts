import { WebSocketError } from "./errors.js";

/**
 * Configuration for ConsoleClient
 */
export interface ConsoleClientConfig {
  /**
   * Base WebSocket URL (without the session ID)
   * @default "ws://localhost:3030/ws/console"
   */
  baseUrl?: string;
}

/**
 * WebSocket client for terminal console streaming
 */
export class ConsoleClient {
  private ws: WebSocket | null = null;
  private readonly baseUrl: string;
  private sessionId: string | null = null;

  private listeners: {
    connected: Array<() => void>;
    disconnected: Array<() => void>;
    data: Array<(data: string) => void>;
    error: Array<(error: Error) => void>;
  } = {
    connected: [],
    disconnected: [],
    data: [],
    error: [],
  };

  constructor(config: ConsoleClientConfig = {}) {
    this.baseUrl = config.baseUrl ?? "ws://localhost:3030/ws/console";
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
          const message = JSON.parse(event.data);

          if (message.type === "output" && typeof message.data === "string") {
            // Decode base64 data
            const decoded = atob(message.data);
            this.emit("data", decoded);
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
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new WebSocketError("Not connected to console");
    }

    // Encode data as base64
    const encoded = btoa(data);

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
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
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
      this.listeners.error = this.listeners.error.filter((cb) => cb !== callback);
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
