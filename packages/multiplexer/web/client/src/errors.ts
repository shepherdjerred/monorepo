/**
 * Base error class for Mux client errors
 */
export class MuxError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MuxError";
  }
}

/**
 * Error thrown when a network request fails
 */
export class NetworkError extends MuxError {
  constructor(message: string, public override readonly cause?: unknown) {
    super(message);
    this.name = "NetworkError";
  }
}

/**
 * Error thrown when the API returns an error response
 */
export class ApiError extends MuxError {
  constructor(
    message: string,
    public readonly code?: string,
    public readonly statusCode?: number
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/**
 * Error thrown when a session is not found
 */
export class SessionNotFoundError extends ApiError {
  constructor(sessionId: string) {
    super(`Session not found: ${sessionId}`, "SESSION_NOT_FOUND", 404);
    this.name = "SessionNotFoundError";
  }
}

/**
 * Error thrown when a WebSocket connection fails
 */
export class WebSocketError extends MuxError {
  constructor(message: string, public override readonly cause?: unknown) {
    super(message);
    this.name = "WebSocketError";
  }
}
