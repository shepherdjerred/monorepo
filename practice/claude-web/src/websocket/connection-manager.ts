import type { ServerWebSocket } from "bun";
import { logger } from "../utils/index.js";

interface WSData {
  sessionId: string;
  userId: string;
  containerId: string;
}

/**
 * Manages active WebSocket connections
 */
class ConnectionManager {
  private connections: Map<string, ServerWebSocket<WSData>> = new Map();

  /**
   * Add a new connection
   */
  add(sessionId: string, ws: ServerWebSocket<WSData>): void {
    // Close existing connection for this session if any
    const existing = this.connections.get(sessionId);
    if (existing) {
      logger.info("Closing existing connection for session", { sessionId });
      existing.close(1000, "New connection established");
    }

    this.connections.set(sessionId, ws);
    logger.info("WebSocket connection added", {
      sessionId,
      total: this.connections.size,
    });
  }

  /**
   * Remove a connection
   */
  remove(sessionId: string): void {
    this.connections.delete(sessionId);
    logger.info("WebSocket connection removed", {
      sessionId,
      total: this.connections.size,
    });
  }

  /**
   * Get a connection by session ID
   */
  get(sessionId: string): ServerWebSocket<WSData> | undefined {
    return this.connections.get(sessionId);
  }

  /**
   * Check if a connection exists
   */
  has(sessionId: string): boolean {
    return this.connections.has(sessionId);
  }

  /**
   * Send a message to a specific session
   */
  send(sessionId: string, message: object): boolean {
    const ws = this.connections.get(sessionId);
    if (!ws) return false;

    try {
      ws.send(JSON.stringify(message));
      return true;
    } catch (error) {
      logger.error("Failed to send message", { sessionId, error });
      return false;
    }
  }

  /**
   * Get count of active connections
   */
  get size(): number {
    return this.connections.size;
  }

  /**
   * Close all connections
   */
  closeAll(): void {
    for (const [sessionId, ws] of this.connections) {
      ws.close(1001, "Server shutting down");
      logger.info("Closed connection", { sessionId });
    }
    this.connections.clear();
  }
}

export const connectionManager = new ConnectionManager();
export type { WSData };
