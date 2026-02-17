import { logger } from "../utils/index.js";

/**
 * Registry to store container streams between HTTP session creation
 * and WebSocket connection
 */
class StreamRegistry {
  private streams: Map<string, NodeJS.ReadWriteStream> = new Map();

  /**
   * Store a stream for a session
   */
  set(sessionId: string, stream: NodeJS.ReadWriteStream): void {
    this.streams.set(sessionId, stream);
    logger.info("Stream registered", { sessionId, total: this.streams.size });
  }

  /**
   * Get and remove a stream for a session
   */
  take(sessionId: string): NodeJS.ReadWriteStream | null {
    const stream = this.streams.get(sessionId);
    if (stream) {
      this.streams.delete(sessionId);
      logger.info("Stream taken from registry", {
        sessionId,
        total: this.streams.size,
      });
      return stream;
    }
    return null;
  }

  /**
   * Check if a stream exists
   */
  has(sessionId: string): boolean {
    return this.streams.has(sessionId);
  }

  /**
   * Remove a stream without returning it
   */
  remove(sessionId: string): void {
    const stream = this.streams.get(sessionId);
    if (stream) {
      try {
        stream.end();
      } catch {
        // Ignore errors
      }
      this.streams.delete(sessionId);
      logger.info("Stream removed from registry", {
        sessionId,
        total: this.streams.size,
      });
    }
  }

  /**
   * Get count of pending streams
   */
  get size(): number {
    return this.streams.size;
  }
}

export const streamRegistry = new StreamRegistry();
