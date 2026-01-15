import { WebSocketError, DecodeError } from "./errors.js";

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
   * Defaults to deriving from window.location in browser context
   */
  baseUrl?: string;
}

/**
 * Get the default WebSocket base URL based on the current environment.
 * In browser context, derives from window.location.
 * In non-browser context, defaults to localhost:3030.
 */
function getDefaultWsBaseUrl(): string {
  if (typeof window !== "undefined") {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    return `${protocol}//${window.location.host}/ws/console`;
  }
  return "ws://localhost:3030/ws/console";
}

/**
 * Validate base64 string format
 * Returns true if valid, false otherwise
 */
function isValidBase64(str: string): boolean {
  if (!str || str.length === 0) {
    return false;
  }

  // Base64 should only contain A-Z, a-z, 0-9, +, /, and = for padding
  const base64Regex = /^[A-Za-z0-9+/]*={0,2}$/;

  // Check format
  if (!base64Regex.test(str)) {
    return false;
  }

  // Base64 length should be multiple of 4
  if (str.length % 4 !== 0) {
    return false;
  }

  return true;
}

/**
 * Maximum size for a single message (1MB encoded = ~750KB decoded)
 * Prevents memory issues from extremely large chunks
 */
const MAX_MESSAGE_SIZE = 1024 * 1024;

/**
 * WebSocket client for terminal console streaming
 */
export class ConsoleClient {
  private ws: WebSocket | null = null;
  private readonly baseUrl: string;
  private sessionId: string | null = null;
  private decoder: TextDecoder | null = null;

  // Error throttling to prevent UI freezes
  private errorCount: number = 0;
  private lastErrorTime: number = 0;
  private readonly MAX_ERRORS_PER_SECOND = 5;
  private isErrorThrottled: boolean = false;

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

  constructor(config: ConsoleClientConfig = {}) {
    this.baseUrl = config.baseUrl ?? getDefaultWsBaseUrl();
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

      // Create decoder instance with fatal=false for graceful error handling
      this.decoder = new TextDecoder('utf-8', { fatal: false });

      this.ws.onopen = () => {
        this.emit("connected");
      };

      this.ws.onclose = () => {
        this.emit("disconnected");
      };

      this.ws.onerror = (event) => {
        this.emit("error", new WebSocketError("WebSocket error occurred", event));
      };

      this.ws.onmessage = (event: MessageEvent<string>) => {
        try {
          const message = JSON.parse(event.data) as ConsoleMessage;

          if (message.type === "output") {
            // Validate data field exists and is a string
            if (typeof message.data !== "string") {
              console.warn(
                `[ConsoleClient] Invalid output message for session ${this.sessionId}: ` +
                `data field is ${typeof message.data}, expected string`
              );
              return;
            }

            // Check for empty data
            if (message.data.length === 0) {
              console.debug(`[ConsoleClient] Received empty output data for session ${this.sessionId}`);
              // Empty data is valid - just emit empty string
              this.emit("data", "");
              return;
            }

            // Validate base64 format before attempting decode
            if (!isValidBase64(message.data)) {
              if (this.shouldEmitError()) {
                console.error(
                  `[ConsoleClient] Invalid base64 format (stage: validation) for session ${this.sessionId}. ` +
                  `Length: ${message.data.length}, ` +
                  `First 50 chars: ${message.data.substring(0, 50)}`
                );
                this.emit(
                  "error",
                  new DecodeError(
                    `Invalid base64 format received from server`,
                    'validation',
                    {
                      sessionId: this.sessionId,
                      dataLength: message.data.length,
                      dataSample: message.data.substring(0, 100),
                    }
                  )
                );
              }
              return;
            }

            // Check message size to prevent memory issues
            if (message.data.length > MAX_MESSAGE_SIZE) {
              if (this.shouldEmitError()) {
                console.error(
                  `[ConsoleClient] Message size exceeded limit for session ${this.sessionId}. ` +
                  `Size: ${message.data.length} bytes, Max: ${MAX_MESSAGE_SIZE} bytes`
                );
                this.emit(
                  "error",
                  new WebSocketError(
                    `Received message exceeds size limit (${(message.data.length / 1024).toFixed(0)}KB). ` +
                    `Large outputs may be truncated.`
                  )
                );
              }
              return;
            }

            // Decode base64 data with staged error handling for better debugging
            // Stage 1: Decode base64 to binary (atob)
            let bytes: Uint8Array;
            try {
              const binaryString = atob(message.data);
              bytes = Uint8Array.from(binaryString, (char) => char.charCodeAt(0));
            } catch (atobError) {
              if (this.shouldEmitError()) {
                const errorMsg = atobError instanceof Error ? atobError.message : String(atobError);
                console.error(
                  `[ConsoleClient] Base64 decode error (stage: atob) for session ${this.sessionId}: ${errorMsg}. ` +
                  `Data length: ${message.data.length}, ` +
                  `Sample: ${message.data.substring(0, 100)}`
                );
                this.emit(
                  "error",
                  new DecodeError(
                    `Failed to decode base64: ${errorMsg}`,
                    'base64',
                    {
                      sessionId: this.sessionId,
                      dataLength: message.data.length,
                      dataSample: message.data.substring(0, 100),
                    },
                    atobError
                  )
                );
              }
              return;
            }

            // Stage 2: Decode UTF-8 from binary
            try {
              // Use stream mode to handle incomplete UTF-8 sequences at chunk boundaries
              // fatal: false means replace invalid bytes with � instead of throwing
              // stream: true means buffer incomplete sequences for next chunk
              const decoded = this.decoder!.decode(bytes, { stream: true });
              this.emit("data", decoded);
            } catch (utf8Error) {
              if (this.shouldEmitError()) {
                const errorMsg = utf8Error instanceof Error ? utf8Error.message : String(utf8Error);
                // Include hex dump of first 32 bytes for debugging
                const hexSample = Array.from(bytes.slice(0, 32))
                  .map(b => '0x' + b.toString(16).padStart(2, '0'))
                  .join(' ');
                console.error(
                  `[ConsoleClient] UTF-8 decode error (stage: utf8) for session ${this.sessionId}: ${errorMsg}. ` +
                  `Bytes length: ${bytes.length}, ` +
                  `Hex sample: ${hexSample}`
                );
                this.emit(
                  "error",
                  new DecodeError(
                    `Failed to decode UTF-8: ${errorMsg}`,
                    'utf8',
                    {
                      sessionId: this.sessionId,
                      dataLength: bytes.length,
                      dataSample: hexSample,
                    },
                    utf8Error
                  )
                );
              }
              return;
            }
          }
        } catch (error) {
          if (this.shouldEmitError()) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            console.error(
              `[ConsoleClient] Message parse error for session ${this.sessionId}: ${errorMsg}`
            );
            this.emit(
              "error",
              new WebSocketError(
                `Failed to parse message: ${errorMsg}`
              )
            );
          }
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
    this.decoder = null;

    // Reset error tracking
    this.errorCount = 0;
    this.lastErrorTime = 0;
    this.isErrorThrottled = false;
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
    const binaryString = Array.from(bytes, (byte) => String.fromCharCode(byte)).join('');
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

  /**
   * Check if we should emit an error or throttle it
   * Prevents error loops from freezing the UI
   */
  private shouldEmitError(): boolean {
    const now = Date.now();

    // Reset counter if more than 1 second has passed
    if (now - this.lastErrorTime > 1000) {
      this.errorCount = 0;
      this.isErrorThrottled = false;
    }

    this.lastErrorTime = now;
    this.errorCount++;

    // Throttle if too many errors
    if (this.errorCount > this.MAX_ERRORS_PER_SECOND) {
      if (!this.isErrorThrottled) {
        this.isErrorThrottled = true;
        console.error(
          `[ConsoleClient] Error rate exceeded for session ${this.sessionId}. ` +
          `Throttling errors to prevent UI freeze. Check server logs.`
        );
      }
      return false;
    }

    return true;
  }
}
