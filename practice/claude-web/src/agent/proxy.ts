import type { ServerWebSocket } from "bun";
import { logger } from "../utils/index.js";
import type { WSData } from "../websocket/connection-manager.js";
import type { ClientMessage, ServerMessage } from "../websocket/types.js";

/**
 * Proxies messages between a WebSocket client and a Docker container
 */
export class AgentProxy {
  private buffer = "";
  private isAttached = false;

  constructor(
    private stream: NodeJS.ReadWriteStream,
    private ws: ServerWebSocket<WSData>,
    private sessionId: string
  ) {}

  /**
   * Start listening to the container stream and proxying messages
   */
  start(): void {
    if (this.isAttached) {
      logger.warn("Already attached to container stream", { sessionId: this.sessionId });
      return;
    }

    this.isAttached = true;
    logger.info("Starting agent proxy", { sessionId: this.sessionId });

    // Handle data from container (NDJSON lines)
    this.stream.on("data", (chunk: Buffer) => {
      this.handleContainerData(chunk);
    });

    this.stream.on("end", () => {
      logger.info("Container stream ended", { sessionId: this.sessionId });
      this.sendToClient({ type: "result", subtype: "success", result: "Session ended" });
      this.stop();
    });

    this.stream.on("error", (error) => {
      logger.error("Container stream error", { sessionId: this.sessionId, error });
      this.sendToClient({ type: "error", message: "Container connection error" });
      this.stop();
    });
  }

  /**
   * Handle incoming data from the container
   * Parses NDJSON lines and forwards to WebSocket
   */
  private handleContainerData(chunk: Buffer): void {
    // Docker multiplexes stdout/stderr with 8-byte header
    // Format: [type (1 byte)][000 (3 bytes)][size (4 bytes BE)][data]
    let data = chunk;

    // Skip docker header if present (starts with 0x01 or 0x02)
    if (chunk.length > 8 && (chunk[0] === 1 || chunk[0] === 2)) {
      data = chunk.slice(8);
    }

    this.buffer += data.toString();

    // Process complete lines
    const lines = this.buffer.split("\n");
    this.buffer = lines.pop() || ""; // Keep incomplete line in buffer

    for (const line of lines) {
      if (!line.trim()) continue;

      try {
        const message = JSON.parse(line);
        logger.debug("Container message", { sessionId: this.sessionId, type: message.type });
        this.sendToClient(message);
      } catch {
        // Not JSON - might be stderr output
        logger.debug("Non-JSON output from container", { line: line.substring(0, 100) });
      }
    }
  }

  /**
   * Send a message to the WebSocket client
   */
  private sendToClient(message: ServerMessage | object): void {
    try {
      this.ws.send(JSON.stringify(message));
    } catch (error) {
      logger.error("Failed to send to WebSocket", { sessionId: this.sessionId, error });
    }
  }

  /**
   * Send a message to the container
   */
  sendToContainer(message: ClientMessage): void {
    if (!this.isAttached) {
      logger.warn("Cannot send to container - not attached", { sessionId: this.sessionId });
      return;
    }

    try {
      const line = JSON.stringify(message) + "\n";
      logger.info("Sending to container", { sessionId: this.sessionId, type: message.type });
      this.stream.write(line);
    } catch (error) {
      logger.error("Failed to send to container", { sessionId: this.sessionId, error });
    }
  }

  /**
   * Handle a message from the WebSocket client
   */
  handleClientMessage(data: string): void {
    try {
      const message = JSON.parse(data) as ClientMessage;

      switch (message.type) {
        case "prompt":
          this.sendToContainer(message);
          break;

        case "interrupt":
          this.sendToContainer(message);
          break;

        case "ping":
          this.sendToClient({ type: "pong" });
          break;

        default:
          logger.warn("Unknown client message type", { type: (message as { type: string }).type });
      }
    } catch (error) {
      logger.error("Failed to parse client message", { data, error });
      this.sendToClient({ type: "error", message: "Invalid message format" });
    }
  }

  /**
   * Stop the proxy and cleanup
   */
  stop(): void {
    if (this.stream) {
      try {
        this.stream.end();
      } catch {
        // Ignore errors on cleanup
      }
    }
    this.isAttached = false;
    this.buffer = "";
    logger.info("Agent proxy stopped", { sessionId: this.sessionId });
  }

  /**
   * Check if attached to container
   */
  get attached(): boolean {
    return this.isAttached;
  }
}
