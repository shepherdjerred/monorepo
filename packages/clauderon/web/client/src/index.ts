/**
 * Clauderon TypeScript Client Library
 *
 * Provides type-safe access to the Clauderon HTTP API and real-time WebSocket connections.
 */

// Re-export types from shared package
export type * from "@clauderon/shared";

// Export main client
export { ClauderonClient, type ClauderonClientConfig } from "./ClauderonClient.js";

// Export WebSocket clients
export { EventsClient, type EventsClientConfig, type SessionEvent } from "./EventsClient.js";
export { ConsoleClient, type ConsoleClientConfig } from "./ConsoleClient.js";

// Export errors
export {
  ClauderonError,
  NetworkError,
  ApiError,
  SessionNotFoundError,
  WebSocketError,
  DecodeError,
} from "./errors.js";
